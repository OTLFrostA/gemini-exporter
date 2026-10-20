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
