import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationDetail } from '../src/l2/conversationDetail.js';
import type { PageObservation } from '../src/l2/pageObservation.js';
import {
    ACCOUNT, DEFAULT_ACCOUNT, accounts, indexes, details, calls, indexFor, detailFor, coverageFor,
    resetL2UnitPorts, setInsertResponse, rejectNextWrite,
    getOrCreateAccount, ingestIndexes, ingestDetail, ingestDeletedConversation, recordPageCoverage,
} from './helpers/l2V2UnitHarness.js';

const ABSENT_ACCOUNT = '10000000-0000-4000-8000-000000000009';
const index = (conversationId: string, title = 'One', updatedAt = 100) => ({
    conversationId, fields: { title, titleSource: 'provider' as const, updatedAt },
});
const evidence = (keys: Array<{ id: string; time: number }>, overrides: Partial<Omit<PageObservation<unknown>, 'providerId' | 'accountId' | 'items'>> = {}) => ({
    streamId: 'recent', requestCursor: null as string | null, nextCursor: null as string | null,
    requestedAt: 1700000000000, requestKnown: true, valid: true, ordered: true, keys,
    ...overrides,
} satisfies Omit<PageObservation<unknown>, 'providerId' | 'accountId' | 'items'>);
const body = (savedAt: number, status: ConversationDetail['quality']['status'] = 'complete', messageCount = 1):
    Omit<ConversationDetail, 'key'> => ({
        savedAt, quality: { status }, assets: [],
        messages: Array.from({ length: messageCount }, (_, i) => ({
            id: 'm' + i, role: 'assistant' as const, content: [],
        })),
    });

beforeEach(resetL2UnitPorts);

test('L2 refuses unknown Registry accounts before Index, Detail or deletion writes', async () => {
    await assert.rejects(ingestIndexes(ABSENT_ACCOUNT, [index('c')]), /Index account does not exist/);
    await assert.rejects(ingestDetail(ABSENT_ACCOUNT, 'c', body(100)), /Detail account does not exist/);
    await assert.rejects(ingestDeletedConversation(ABSENT_ACCOUNT, 'c'), /Deletion account does not exist/);
    assert.deepEqual(calls.indexUpdates, []);
    assert.deepEqual(calls.detailUpdates, []);
    assert.deepEqual(calls.deletions, []);
});

test('L2 binds keyless Index rows to the resolved Account and coalesces duplicate source rows', async () => {
    await ingestIndexes(ACCOUNT.id, [
        { conversationId: 'c', fields: { title: 'Derived', titleSource: 'derived', updatedAt: 100 } },
        { conversationId: 'c', fields: { title: 'Provider', titleSource: 'provider', updatedAt: 90 } },
        index('another', 'Other', 80),
    ]);
    assert.equal(calls.indexUpdates.length, 1);
    assert.deepEqual(calls.indexUpdates[0], [
        { accountId: ACCOUNT.id, conversationId: 'c' },
        { accountId: ACCOUNT.id, conversationId: 'another' },
    ]);
    assert.equal(indexFor('c')?.title, 'Provider');
    assert.equal(indexFor('c')?.updatedAt, 100);
    assert.equal(indexFor('another')?.key.accountId, ACCOUNT.id);
    assert.equal(indexes.size, 2);
});

test('L2 forwards committed page evidence only after the Index decision and binds Registry identity', async () => {
    await ingestIndexes(ACCOUNT.id, [index('c')], evidence([{ id: 'c', time: 100 }]));
    assert.equal(calls.indexUpdates.length, 1);
    assert.deepEqual(calls.coverageUpdates, [{ accountId: ACCOUNT.id, streamId: 'recent' }]);
    assert.deepEqual(coverageFor('recent'), { range: { head: { id: 'c', time: 100 }, tail: { id: 'c', time: 100 } } });
});

test('L2 never grants Coverage for mismatched page identities or default Takeout-only Accounts', async () => {
    await ingestIndexes(ACCOUNT.id, [index('c')], evidence([{ id: 'not-c', time: 100 }]));
    assert.equal(coverageFor('recent'), undefined);
    await ingestIndexes(DEFAULT_ACCOUNT.id, [index('c')], evidence([{ id: 'c', time: 100 }]));
    assert.equal(calls.coverageUpdates.length, 1);
});

test('L2 commits empty trusted terminal lists through the Coverage port', async () => {
    await ingestIndexes(ACCOUNT.id, [], evidence([]));
    assert.deepEqual(calls.indexUpdates, [[]]);
    assert.deepEqual(calls.coverageUpdates, [{ accountId: ACCOUNT.id, streamId: 'recent' }]);
    assert.deepEqual(coverageFor('recent'), { range: null });
});

test('L2 selection returns accepted/changed only after the v2 Storage decision', async () => {
    assert.deepEqual(await ingestDetail(ACCOUNT.id, 'c', body(100), { title: 'Chat', titleSource: 'provider' }),
        { accepted: true, changed: true });
    assert.equal(indexFor('c')?.title, 'Chat');
    assert.equal(detailFor('c')?.messages.length, 1);
    assert.deepEqual(calls.detailUpdates, [{ accountId: ACCOUNT.id, conversationId: 'c' }]);
});

test('L2 recognizes unchanged material facts even with a newer source version', async () => {
    await ingestDetail(ACCOUNT.id, 'c', body(100));
    assert.deepEqual(await ingestDetail(ACCOUNT.id, 'c', body(200)), { accepted: true, changed: false });
    assert.equal(detailFor('c')?.savedAt, 200);
});

test('L2 rejects inferior incomplete Detail without replacing an existing complete snapshot', async () => {
    await ingestDetail(ACCOUNT.id, 'c', body(100, 'complete', 1));
    assert.deepEqual(await ingestDetail(ACCOUNT.id, 'c', body(200, 'partial', 2)),
        { accepted: false, changed: false });
    assert.equal(detailFor('c')?.quality.status, 'complete');
    assert.equal(detailFor('c')?.messages.length, 1);
});

test('L2 reports a genuine changed Detail without inventing a Storage receipt', async () => {
    await ingestDetail(ACCOUNT.id, 'c', body(100, 'partial', 1));
    assert.deepEqual(await ingestDetail(ACCOUNT.id, 'c', body(200, 'complete', 2)),
        { accepted: true, changed: true });
    assert.equal(detailFor('c')?.messages.length, 2);
});

test('L2 forwards source-verified deletion by full ConversationKey', async () => {
    await ingestDeletedConversation(ACCOUNT.id, 'one');
    await ingestDeletedConversation(DEFAULT_ACCOUNT.id, 'two');
    assert.deepEqual(calls.deletions, [
        { accountId: ACCOUNT.id, conversationId: 'one' },
        { accountId: DEFAULT_ACCOUNT.id, conversationId: 'two' },
    ]);
});

test('L2 Account creation delegates the unique insert, preserving the Storage-provided UUID', async () => {
    const previous = { ...ACCOUNT, email: 'old@example.com' };
    setInsertResponse(previous);
    const updated = await getOrCreateAccount('gemini', ACCOUNT.providerAccountId, 'new@example.com', 'New name');
    assert.equal(calls.insertions.length, 1);
    assert.equal(calls.insertions[0].providerAccountId, ACCOUNT.providerAccountId);
    assert.equal(updated.id, previous.id);
    assert.equal(updated.email, 'new@example.com');
    assert.equal(updated.displayName, 'New name');
    assert.deepEqual(calls.accountWrites, [updated]);
});

test('L2 Account creation avoids an unnecessary profile write and strips default profile metadata', async () => {
    const value = await getOrCreateAccount('gemini', 'default', 'x@example.com', 'Display');
    assert.equal(value.providerAccountId, 'default');
    assert.equal(value.email, undefined);
    assert.equal(calls.insertions[0].email, undefined);
    assert.deepEqual(calls.accountWrites, []);
});

test('L2 validates Account parameters before calling v2 Storage', async () => {
    await assert.rejects(getOrCreateAccount('gemini', ''), /Invalid account parameters/);
    assert.equal(calls.insertions.length, 0);
});

test('L2 propagates Storage failures without fabricating success decisions', async () => {
    rejectNextWrite(new Error('database unavailable'));
    await assert.rejects(ingestDetail(ACCOUNT.id, 'c', body(100)), /database unavailable/);
    assert.equal(detailFor('c'), undefined);
    assert.deepEqual(calls.detailUpdates, []);
});

test('L2 Coverage refuses mismatched Registry identity without touching Storage', async () => {
    await assert.rejects(recordPageCoverage(ACCOUNT.id, {
        ...evidence([{ id: 'c', time: 10 }]), accountId: ABSENT_ACCOUNT, providerId: 'gemini', items: [],
    }), /Coverage requires its Registry UUID/);
    assert.deepEqual(calls.coverageUpdates, []);
});

test('L2 Coverage aborts a cancelled page decision without persisting a boundary', async () => {
    await assert.rejects(recordPageCoverage(ACCOUNT.id, {
        ...evidence([{ id: 'c', time: 10 }]), accountId: ACCOUNT.id, providerId: 'gemini', items: [],
    }, () => false), /cancelled/);
    assert.equal(coverageFor('recent'), undefined);
});

// The mock surface is intentionally only a scripted API port; these fixtures
// never assert IndexedDB implementation, durability, locking, or rollback.
void accounts;
void details;
