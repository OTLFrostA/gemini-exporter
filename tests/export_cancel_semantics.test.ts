import test from 'node:test';
import assert from 'node:assert/strict';
import { runExport } from '../src/application/export/runExport.js';
import { getExportRecord } from '../src/l3a/storageService.js';
import { handleHttp429 } from '../src/l1/client/gemini/api/retryPolicy.js';
import { v2ExportHost, exportKey, exportRequest, seedExportConversation } from './helpers/v2ExportHost.js';

/**
 * V2 cancellation ownership:
 * - Application uses one AbortSignal, not an ExportOrchestrator session.
 * - Staged browser ZIP files have no delivery or records before commit.
 * - Real delivery errors fail keys without being mistaken for user abort.
 * - Once delivery is accepted, cancellation cannot retroactively erase Records.
 */

test('user cancellation while staging two v2 conversations delivers nothing and writes no ExportRecords', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('cancel-first');
    await seedExportConversation('cancel-second');
    const controller = new AbortController();
    const progress: number[] = [];

    const result = await runExport(exportRequest(['cancel-first', 'cancel-second']), {
        signal: controller.signal,
        onProgress: item => {
            progress.push(item.current);
            if (item.current === 2) controller.abort();
        },
    });

    assert.deepEqual(progress, [1, 2]);
    assert.equal(result.aborted, true);
    assert.equal(result.exported, 0);
    assert.equal(result.partial, 0);
    assert.deepEqual(result.failed, []);
    assert.equal(host.clicks(), 0, 'staged bodies are not delivered on cancel');
    assert.equal(host.blobs.length, 0);
    assert.equal(await getExportRecord(exportKey('cancel-first')), null);
    assert.equal(await getExportRecord(exportKey('cancel-second')), null);
});

test('host permission revocation fails the delivered key, not the v2 AbortSignal', async t => {
    const host = v2ExportHost(t, () => {
        throw new DOMException('Download permission was revoked', 'NotAllowedError');
    });
    await seedExportConversation('permission-revoked');
    const result = await runExport(exportRequest(['permission-revoked']));

    assert.equal(host.clicks(), 1);
    assert.equal(result.aborted, false, 'a host error is not a user cancellation');
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, [exportKey('permission-revoked')]);
    assert.equal(await getExportRecord(exportKey('permission-revoked')), null);
});

test('real L1 429 backoff obeys the same AbortSignal and never waits out 30 seconds', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = handleHttp429({
        resp: { status: 429, headers: { get: () => '30' } },
        retryAfterMs: 30_000,
        signal: controller.signal,
    });
    controller.abort();

    const response = await pending;
    assert.deepEqual(response, { shouldRetry: false, aborted: true });
    assert.ok(Date.now() - started < 1500, 'abort must interrupt rate-limit backoff immediately');
});

test('cancel during confirmed browser delivery cannot roll back the v2 ExportRecord', async t => {
    const controller = new AbortController();
    const host = v2ExportHost(t, () => controller.abort());
    await seedExportConversation('already-delivered');

    const result = await runExport(exportRequest(['already-delivered']), { signal: controller.signal });

    assert.equal(host.clicks(), 1);
    assert.equal(result.exported, 1, 'L4 delivery preceded and committed the v2 record');
    assert.deepEqual(result.failed, []);
    assert.equal(result.aborted, true, 'the caller signal still reports its final state');
    assert.equal((await getExportRecord(exportKey('already-delivered')))?.status, 'ok');
    assert.match(await host.blobs[0].text(), /Answer for already-delivered/);

    // The next task owns a fresh AbortSignal. No stale cancellation/session state.
    const retry = await runExport(exportRequest(['already-delivered'], { skipUnchanged: true }));
    assert.equal(retry.aborted, false);
    assert.equal(retry.skipped, 1);
    assert.equal(retry.exported, 0);
    assert.equal(host.clicks(), 1);
});

test('cancel requested by a new task does not erase previous committed v2 records', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('committed');
    await seedExportConversation('new-pending');
    const first = await runExport(exportRequest(['committed']));
    assert.equal(first.exported, 1);
    assert.equal(host.clicks(), 1);

    const controller = new AbortController();
    const second = await runExport(exportRequest(['new-pending']), {
        signal: controller.signal, onProgress: () => controller.abort(),
    });
    assert.equal(second.aborted, true);
    assert.equal(second.exported, 0);
    assert.deepEqual(second.failed, []);
    assert.equal(host.clicks(), 1);
    assert.equal(await getExportRecord(exportKey('new-pending')), null);
    assert.equal((await getExportRecord(exportKey('committed')))?.status, 'ok');
});
