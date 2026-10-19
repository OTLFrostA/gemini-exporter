import { getCoverage, getIndex, getDetail, updateIndexesAtomically } from '../src/core/storage/storageService.js';
import { admitFixture } from './helpers/admitFixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { ingestIndexes, ingestDetail } from '../src/core/domain/ingestion.js';
import { storageIdentity } from './helpers/admitFixture.js';
import { readFixture } from './helpers/admitFixture.js';
import { listIndexes as getConversations } from '../src/core/storage/storageService.js';
import type { DomainFixture } from './helpers/domainFixture.js';

const account = fixtureAccount();
function snapshot(text: string, status: 'complete' | 'partial' | 'unknown', savedAt?: number, image = false): DomainFixture {
    const key = fixtureKey('admission-storage');
    return { account, diagnostics: [], resourceHints: {}, acquisitionHints: image ? { image: { dataBase64: 'AQID' } } : {},
        conversation: validateParserDomain({ index: { key, title: 'Source title', titleSource: 'provider' }, detail: {
            key, ...(savedAt !== undefined ? { savedAt } : {}), quality: { status },
            assets: image ? [{ id: 'image', kind: 'image' }] : [],
            messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text }] },
                ...(image ? [{ type: 'image' as const, assetId: 'image' }] : [])] }],
        } }) };
}

test('admission replaces complete body and assets together, preserves complete against partial, and keeps bytes outside Domain', async () => {
    const env = indexStorage(), identity = storageIdentity('gemini', account.id, 'admission-storage');
    try {
        const original = snapshot('A B C D', 'complete', 10, true);
        await admitFixture(account.id, original);
        assert.ok(!JSON.stringify((await readFixture(identity))!.conversation).includes('dataBase64'));
        await ingestIndexes(account.id, [{ conversationId: original.conversation.index.key.conversationId, fields: { title: 'Renamed', titleSource: 'user', updatedAt: 30 } }]);
        assert.equal((await readFixture(identity))!.conversation.detail.savedAt, 10, 'Index-only observation cannot advance the body version');
        const partial = { ...snapshot('C D E', 'partial', 30, true), acquisitionHints: { image: { dataBase64: 'BAUG' } } };
        const rejected = await admitFixture(account.id, partial);
        assert.deepEqual(rejected.conversation.detail, original.conversation.detail);
        assert.equal(rejected.conversation.index.title, 'Renamed');
        const next = snapshot('A B edited', 'complete', 20);
        await admitFixture(account.id, next);
        assert.deepEqual((await readFixture(identity))!.conversation.detail, next.conversation.detail);
        await admitFixture(account.id, snapshot('stale longer complete body', 'complete', 15));
        assert.deepEqual((await readFixture(identity))!.conversation.detail, next.conversation.detail);
    } finally { env.restore(); }
});

test('admission replaces incomplete snapshots by order and rejects mismatched ownership and failed catalog commits', async () => {
    const env = indexStorage(), identity = storageIdentity('gemini', account.id, 'admission-storage');
    try {
        await admitFixture(account.id, snapshot('long unknown body', 'unknown'));
        const next = snapshot('short', 'partial', 20);
        await admitFixture(account.id, next);
        assert.deepEqual((await readFixture(identity))!.conversation.detail, next.conversation.detail);
        await assert.rejects(admitFixture('10000000-0000-4000-8000-000000000002', next), /account\/provider mismatch/);
        assert.equal((await getConversations('10000000-0000-4000-8000-000000000002')).length, 0);
        env.fail(`conversations_${account.id}`);
        const failed = snapshot('uncommitted catalog', 'complete', 30); failed.conversation.index.updatedAt = 30;
        await assert.rejects(admitFixture(account.id, failed), /write failed/);
        env.fail();
        assert.equal((await getConversations(account.id))[0].key.accountId, account.id);
    } finally { env.restore(); }
});

test('canonical detail entry binds Registry UUID and shares Index and body admission rules', async () => {
    const env = indexStorage(), key = fixtureKey('canonical-detail');
    try {
        const incoming = snapshot('complete body', 'complete', 10);
        const { key: _, ...detail } = incoming.conversation.detail;
        await ingestDetail(account.id, key.conversationId, detail, { title: 'Explicit title', titleSource: 'user', updatedAt: 10 });
        await ingestDetail(account.id, key.conversationId, { ...detail, quality: { status: 'partial' }, savedAt: 20 },
            { title: 'Provider title', titleSource: 'provider', updatedAt: 20 });
        const stored = await readFixture(storageIdentity('gemini', account.id, key.conversationId));
        assert.deepEqual(stored!.conversation.detail, { ...detail, key });
        const index = (await getConversations(account.id)).find(row => row.key.conversationId === key.conversationId)!;
        assert.equal(index.title, 'Explicit title');
        assert.equal(index.updatedAt, 20);
        await assert.rejects(ingestDetail('10000000-0000-4000-8000-000000000099', key.conversationId, detail), /account does not exist/);
    } finally { env.restore(); }
});


test('default retains source Index facts without establishing trusted account coverage', async () => {
    const env = indexStorage(), accountId = '10000000-0000-4000-8000-000000000003';
    const key = { accountId, conversationId: 'default-fact' };
    try {
        await ingestIndexes(accountId, [{ conversationId: key.conversationId, fields: { updatedAt: 100 } }], {
            streamId: 'recent', requestCursor: null, nextCursor: null,
            requestedAt: 1, requestKnown: true, valid: true, ordered: true, keys: [{ id: key.conversationId, time: 100 }],
        });
        assert.deepEqual(await getConversations(accountId), [{ key, updatedAt: 100 }]);
        assert.equal(await getCoverage(accountId, 'recent'), null);
    } finally { env.restore(); }
});

test('ingestDetail changed reports only committed messages/assets/quality differences', async () => {
    const env = indexStorage(), key = fixtureKey('changed-semantics');
    try {
        const body = { ...snapshot('first', 'complete', 10).conversation.detail };
        const { key: _unused, ...facts } = body;
        assert.equal(await ingestDetail(account.id, key.conversationId, facts), true);
        assert.equal(await ingestDetail(account.id, key.conversationId, { ...facts }), false);
        assert.equal(await ingestDetail(account.id, key.conversationId, { ...facts, savedAt: 11 }), false);
        assert.equal((await readFixture(storageIdentity('gemini', account.id, key.conversationId)))!.conversation.detail.savedAt, 11);
        assert.equal(await ingestDetail(account.id, key.conversationId, { ...facts, quality: { status: 'partial' }, savedAt: 12 },
            { title: 'New index', titleSource: 'provider' }), false);
        assert.equal(await ingestDetail(account.id, key.conversationId, { ...facts, savedAt: 12,
            messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'edited' }] }] }] }), true);
    } finally { env.restore(); }
});

test('one failed Detail write rolls back its freshly created Index', async () => {
    const env = indexStorage(), key = fixtureKey('atomic-rollback');
    try {
        env.fail('details');
        const { key: _unused, ...facts } = snapshot('new body', 'complete', 10).conversation.detail;
        await assert.rejects(ingestDetail(account.id, key.conversationId, facts), /write failed/);
        env.fail();
        assert.equal(await getIndex(key), null);
        assert.equal(await getDetail(key), null);
        assert.equal(await ingestDetail(account.id, key.conversationId, facts), true);
        assert.ok(await getIndex(key));
        assert.ok(await getDetail(key));
    } finally { env.restore(); }
});

test('concurrent Index admissions preserve the highest trusted updatedAt', async () => {
    const env = indexStorage(), key = fixtureKey('atomic-index');
    try {
        await Promise.all(Array.from({ length: 20 }, (_, updatedAt) =>
            ingestIndexes(account.id, [{ conversationId: key.conversationId, fields: { updatedAt } }])));
        assert.equal((await getIndex(key))?.updatedAt, 19);
    } finally { env.restore(); }
});

test('Index atomic update accepts only changed subset and zero-write no-op admissions', async () => {
    const env = indexStorage(), one = fixtureKey('subset-one'), two = fixtureKey('subset-two');
    try {
        await ingestIndexes(account.id, [
            { conversationId: one.conversationId, fields: { updatedAt: 10 } },
            { conversationId: two.conversationId, fields: { updatedAt: 20 } },
        ]);
        const beforeNoop = env.writes();
        await ingestIndexes(account.id, [
            { conversationId: one.conversationId, fields: { updatedAt: 10 } },
            { conversationId: two.conversationId, fields: { updatedAt: 20 } },
        ]);
        assert.equal(env.writes(), beforeNoop, 'L2 chooses an empty write subset');
        await updateIndexesAtomically([one, two], rows => {
            assert.equal(rows[0]?.updatedAt, 10);
            assert.equal(rows[1]?.updatedAt, 20);
            return [{ ...rows[1]!, updatedAt: 30 }];
        });
        assert.equal((await getIndex(one))?.updatedAt, 10);
        assert.equal((await getIndex(two))?.updatedAt, 30);
    } finally { env.restore(); }
});

test('Index atomic update rejects duplicate/foreign decision keys and rolls back partial writes', async () => {
    const env = indexStorage(), one = fixtureKey('subset-first'), two = fixtureKey('subset-second');
    try {
        await ingestIndexes(account.id, [
            { conversationId: one.conversationId, fields: { updatedAt: 10 } },
            { conversationId: two.conversationId, fields: { updatedAt: 20 } },
        ]);
        await assert.rejects(updateIndexesAtomically([one, one], () => []), /Duplicate Index admission key/);
        await assert.rejects(updateIndexesAtomically([one, two], old => [
            { ...old[0]!, updatedAt: 999 },
            { key: fixtureKey('foreign'), updatedAt: 300 },
        ]), /Index decision key mismatch/);
        assert.equal((await getIndex(one))?.updatedAt, 10);
        await assert.rejects(updateIndexesAtomically([one, two], old => [
            { ...old[0]!, updatedAt: 999 }, { ...old[0]!, updatedAt: 888 },
        ]), /Duplicate Index decision key/);
        assert.equal((await getIndex(one))?.updatedAt, 10);
        assert.equal((await getIndex(two))?.updatedAt, 20);
    } finally { env.restore(); }
});
