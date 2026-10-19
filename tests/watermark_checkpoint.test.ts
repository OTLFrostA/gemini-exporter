import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { fixtureAccount } from './helpers/domainFixture.js';
import { getCoverage, recordPageCoverage, hasTrustedBoundary } from '../src/core/domain/coverageAdmission.js';
import { beginScanCoverage, finishScanCoverage, isScanCoverageCurrent } from '../src/core/application/sync/scanLifecycle.js';
import type { PageObservation } from '../src/core/domain/pageObservation.js';
const accountId = fixtureAccount().id;
let time = 0;
function page(cursor: string | null = null, next: string | null = null, values = [100, 70]): PageObservation<unknown> {
    return { accountId, providerId: 'gemini', streamId: 'recent', items: [], requestCursor: cursor, nextCursor: next,
        requestedAt: ++time, requestKnown: true, valid: true, ordered: true, keys: values.map(t => ({ id: 'id' + t, time: t })) };
}
test('runtime scan lifecycle freezes only committed stream coverage and never persists run state', async () => {
    const env = indexStorage();
    try {
        const empty = await beginScanCoverage(accountId, accountId);
        assert.equal(empty.previous, null); assert.deepEqual(env.local, {});
        await recordPageCoverage(accountId, page());
        const before = structuredClone(env.local);
        const run = await beginScanCoverage(accountId, accountId);
        assert.equal(await isScanCoverageCurrent(accountId, empty.runId), false);
        assert.equal(await finishScanCoverage(accountId, empty.runId, 'error'), false);
        assert.equal(await finishScanCoverage(accountId, run.runId, 'partial_limit'), true);
        assert.deepEqual(env.local, before);
        assert.deepEqual(Object.keys((await getCoverage(accountId, 'recent'))!), ['range']);
    } finally { env.restore(); }
});
test('a fresh partial chain cannot establish range, terminal proof can, and retries preserve prior range', async () => {
    const env = indexStorage();
    try {
        await recordPageCoverage(accountId, page(null, 'limit'));
        assert.deepEqual(await getCoverage(accountId, 'recent'), { range: null });
        await recordPageCoverage(accountId, { ...page('limit', null, []), terminal: 'provider_limit' });
        const frozen = (await getCoverage(accountId, 'recent'))!;
        assert.equal(frozen.range?.head.time, 100);
        const head = page(null, 'bridge', [120, 110]);
        await recordPageCoverage(accountId, head);
        assert.deepEqual(await getCoverage(accountId, 'recent'), frozen);
        assert.equal(await hasTrustedBoundary(accountId, frozen, head), false);
        await recordPageCoverage(accountId, page('bridge', 'unread', [105, 85]));
        assert.equal(await hasTrustedBoundary(accountId, frozen, head), true);
        assert.equal((await getCoverage(accountId, 'recent'))?.range?.head.time, 120);
        assert.equal(frozen.range?.head.time, 100, 'frozen baseline is detached');
        assert.equal(JSON.stringify(env.local).includes('unread'), false);
    } finally { env.restore(); }
});
test('coverage storage is isolated by account and stream and propagates commit failures', async () => {
    const env = indexStorage();
    try {
        await recordPageCoverage(accountId, { ...page(), streamId: 'pinned' });
        assert.equal(await getCoverage(accountId, 'recent'), null);
        assert.equal(await getCoverage('10000000-0000-4000-8000-000000000002', 'pinned'), null);
        env.fail('scan_coverage_' + accountId);
        await assert.rejects(recordPageCoverage(accountId, page()), /write failed/);
        assert.equal(await getCoverage(accountId, 'recent'), null);
        await assert.rejects(recordPageCoverage(accountId, { ...page(), accountId: null }), /Registry UUID/);
        await assert.rejects(recordPageCoverage(accountId, page(), () => false), /cancelled/);
    } finally { env.restore(); }
});

test('failed terminal commit cannot become reusable proof in a later partial observation', async () => {
    const env = indexStorage();
    try {
        await recordPageCoverage(accountId, page(null, 'end'));
        env.fail('scan_coverage_' + accountId);
        await assert.rejects(recordPageCoverage(accountId, page('end', null, [60, 50])), /write failed/);
        env.fail();
        await recordPageCoverage(accountId, page('unrelated', 'unseen', [40, 30]));
        assert.deepEqual(await getCoverage(accountId, 'recent'), { range: null });
        await recordPageCoverage(accountId, page('end', null, [60, 50]));
        assert.equal((await getCoverage(accountId, 'recent'))!.range!.tail.time, 50);
    } finally { env.restore(); }
});
