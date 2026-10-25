import test from 'node:test';
import assert from 'node:assert/strict';
import { liveCoordinatorHost } from './helpers/liveCoordinatorHost.js';
import { executeLiveSave, cleanup, init } from '../src/runtime/content/liveSaveCoordinator.js';

test('Live Save sends only the accepted ConversationKey to the unified worker and displays its result', async t => {
    const host = await liveCoordinatorHost(t);
    assert.deepEqual(await executeLiveSave(host.key), host.result);
    assert.deepEqual(host.sent, [{ action: 'runLiveSave', key: host.key }]);
    assert.deepEqual(host.feedback, [host.result]);
});
test('disabled Live Save response produces neither success feedback nor a download fallback', async t => {
    const host = await liveCoordinatorHost(t);
    host.reply(async () => ({ ok: true, result: null }));
    assert.equal(await executeLiveSave(host.key), null);
    assert.deepEqual(host.feedback, []);
    assert.deepEqual(host.sent, [{ action: 'runLiveSave', key: host.key }]);
});
for (const error of ['no_dir_handle', 'dir_not_found', 'NotFoundError', 'permission_denied']) {
    test(`Live Save reports ${error} and leaves recovery to the configured folder capability`, async t => {
        const host = await liveCoordinatorHost(t);
        host.reply(async () => ({ ok: false, error }));
        await assert.rejects(executeLiveSave(host.key), new RegExp(error));
        assert.deepEqual(host.errors, [host.key.accountId]);
        assert.deepEqual(host.feedback, []);
        assert.equal(host.sent.length, 1);
    });
}
test('partial Live Save feedback retains the actual result instead of claiming full success', async t => {
    const host = await liveCoordinatorHost(t);
    const partial = { ...host.result, partial: 1 };
    host.reply(async () => ({ ok: true, result: partial }));
    assert.deepEqual(await executeLiveSave(host.key), partial);
    assert.deepEqual(host.feedback, [partial]);
});
test('reinitialization and cleanup suppress feedback from an old pending request', async t => {
    const host = await liveCoordinatorHost(t);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    host.reply(async () => { await gate; return { ok: true, result: host.result }; });
    const pending = executeLiveSave(host.key);
    cleanup(); init({ badge: host.badge }); release();
    await pending;
    assert.deepEqual(host.feedback, []);
    cleanup();
    assert.equal(await executeLiveSave(host.key), null);
    assert.equal(host.sent.length, 1);
});

test('completed reply forwards the refresh requirement to the authenticated worker', async t => {
    const host = await liveCoordinatorHost(t);
    await executeLiveSave(host.key, true);
    assert.deepEqual(host.sent, [{ action: 'runLiveSave', key: host.key, refreshDetail: true }]);
});

test('Live Save validates optional diagnostics and failed keys before reporting feedback', async t => {
    const host = await liveCoordinatorHost(t);
    const result = { ...host.result, failed: [host.key], expiredConversations: 1, otherPartial: 2,
        attachmentIssues: [{ resourceId: 'image', name: 'photo', code: 'expired', sourceUrl: 'https://example.com/image', httpStatus: 403 }] };
    host.reply(async () => ({ ok: true, result }));
    assert.deepEqual(await executeLiveSave(host.key), result);
    assert.deepEqual(host.feedback, [result]);
});

test('malformed worker replies cannot produce Live Save success feedback', async t => {
    const host = await liveCoordinatorHost(t);
    const invalidResults: unknown[] = [undefined, {}, [], 'saved',
        { ...host.result, exported: '1' }, { ...host.result, skipped: -1 },
        { ...host.result, partial: 0.5 }, { ...host.result, aborted: 'false' },
        { ...host.result, failed: [{}] }, { ...host.result, failed: [null] },
        { ...host.result, expiredConversations: Infinity }, { ...host.result, otherPartial: -1 },
        { ...host.result, attachmentIssues: {} },
        { ...host.result, attachmentIssues: [{ resourceId: 'a', name: 'b' }] },
        { ...host.result, attachmentIssues: [{ resourceId: 'a', name: 'b', code: 'c', sourceUrl: 7 }] },
        { ...host.result, attachmentIssues: [{ resourceId: 'a', name: 'b', code: 'c', httpStatus: '403' }] }];
    for (const result of invalidResults) {
        host.reply(async () => ({ ok: true, result }));
        await assert.rejects(executeLiveSave(host.key), /Invalid/);
    }
    host.reply(async () => ({ ok: false, error: { message: 'untrusted' } }));
    await assert.rejects(executeLiveSave(host.key), /Live Save unavailable/);
    assert.equal(host.errors.length, invalidResults.length + 1);
    assert.deepEqual(host.feedback, []);
});
