import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureAccount } from './helpers/domainFixture.js';
import { indexStorage } from './helpers/indexStorage.js';
import type { PageObservation } from '../src/core/domain/pageObservation.js';
import CoverageAdmission from '../src/core/domain/coverageAdmission.js';
import { clearStoredAccountCoverage, getCoverage, putCoverage, updateCoverageAtomically, getIndex,
    putIndexes, getExportRecord, putExportRecord } from '../src/core/storage/storageService.js';

const accountId = fixtureAccount().id;
const otherId = fixtureAccount('chatgpt').id;
const baseline = { range: { head: { id: 'old100', time: 100 }, tail: { id: 'old70', time: 70 } } };
function page(times: number[], requestCursor: string | null, nextCursor: string | null): PageObservation<unknown> {
    return { providerId: 'gemini', accountId, streamId: 'recent', items: [],
        requestCursor, nextCursor, requestedAt: 1, requestKnown: true, valid: true, ordered: true,
        keys: times.map(time => ({ id: 'id' + time, time })) };
}

test('Coverage atomic callback reads the latest row and writes only an explicit next value', async () => {
    const env = indexStorage();
    try {
        assert.equal(await updateCoverageAtomically(accountId, 'recent', current => {
            assert.equal(current, null);
            return { next: baseline, result: 'first' };
        }), 'first');
        assert.deepEqual(await getCoverage(accountId, 'recent'), baseline);
        const beforeNoop = env.writes();
        assert.equal(await updateCoverageAtomically(accountId, 'recent', current => {
            assert.deepEqual(current, baseline);
            return { result: 'no-op' };
        }), 'no-op');
        assert.equal(env.writes(), beforeNoop);
        await assert.rejects(updateCoverageAtomically(accountId, 'recent', () => {
            throw new Error('invalid source evidence');
        }), /invalid source evidence/);
        assert.deepEqual(await getCoverage(accountId, 'recent'), baseline);
    } finally { env.restore(); }
});

test('Coverage clear deletes all Account streams without touching another Account or Index/ExportRecord', async () => {
    const env = indexStorage();
    try {
        const key = { accountId, conversationId: 'unchanged' };
        await putIndexes([{ key, updatedAt: 10 }]);
        await putExportRecord(key, { status: 'ok', format: 'markdown', exportedAt: 10, chatTime: 10 });
        await putCoverage(accountId, 'recent', baseline);
        await putCoverage(accountId, 'pinned', baseline);
        await putCoverage(otherId, 'recent', baseline);
        await clearStoredAccountCoverage(accountId);
        assert.equal(await getCoverage(accountId, 'recent'), null);
        assert.equal(await getCoverage(accountId, 'pinned'), null);
        assert.deepEqual(await getCoverage(otherId, 'recent'), baseline);
        assert.ok(await getIndex(key));
        assert.ok(await getExportRecord(key));
    } finally { env.restore(); }
});

test('Clearing Coverage invalidates previous in-memory page chain; a late terminal cannot revive it', async () => {
    const env = indexStorage();
    try {
        await CoverageAdmission.recordPageCoverage(accountId, page([120, 110], null, 'tail'));
        assert.equal((await getCoverage(accountId, 'recent'))?.range, null);
        await clearStoredAccountCoverage(accountId);
        assert.equal(await getCoverage(accountId, 'recent'), null);
        await CoverageAdmission.recordPageCoverage(accountId, page([90], 'tail', null));
        assert.equal((await getCoverage(accountId, 'recent'))?.range, null,
            'the stale head was invalidated; a fresh head is required');
    } finally { env.restore(); }
});

test('Cleared frozen Coverage cannot authorize early stop or resurrect a deleted range', async () => {
    const env = indexStorage();
    try {
        await putCoverage(accountId, 'recent', baseline);
        const head = page([130, 110], null, 'tail');
        await CoverageAdmission.recordPageCoverage(accountId, head);
        await CoverageAdmission.recordPageCoverage(accountId, page([95], 'tail', 'more'));
        const { providerId: _provider, accountId: _account, items: _items, ...scanHead } = head;
        assert.equal(await CoverageAdmission.hasTrustedBoundary(accountId, baseline, scanHead), true);
        await clearStoredAccountCoverage(accountId);
        assert.equal(await CoverageAdmission.hasTrustedBoundary(accountId, baseline, scanHead), false);
        assert.equal(await getCoverage(accountId, 'recent'), null);
    } finally { env.restore(); }
});

test('Failed Coverage commit does not publish a partial in-memory cursor chain', async () => {
    const env = indexStorage();
    try {
        env.fail('coverage');
        await assert.rejects(CoverageAdmission.recordPageCoverage(accountId, page([120], null, 'tail')), /write failed/);
        env.fail();
        assert.equal(await getCoverage(accountId, 'recent'), null);
        await CoverageAdmission.recordPageCoverage(accountId, page([100], 'tail', null));
        assert.equal((await getCoverage(accountId, 'recent'))?.range, null);
    } finally { env.restore(); }
});
