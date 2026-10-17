import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { ingestConversation, ingestIndexes, ingestDetail } from '../src/core/domain/ingestion.js';
import { getStoredDomain, getDomainResource, storageIdentity } from '../src/core/storage/domain/domainStore.js';
import { getConversations } from '../src/core/storage/conversationCatalogStore.js';
import type { ResourceConversationParseResult } from '../src/core/parsers/parsingResult.js';

const account = fixtureAccount();
function snapshot(text: string, status: 'complete' | 'partial' | 'unknown', savedAt?: number, image = false): ResourceConversationParseResult {
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
        await ingestConversation(account.id, original);
        assert.deepEqual(await getDomainResource(identity, 'image'), new Uint8Array([1, 2, 3]));
        assert.ok(!JSON.stringify((await getStoredDomain(identity))!.conversation).includes('dataBase64'));
        await ingestIndexes(account.id, [{ key: original.conversation.index.key, title: 'Renamed', titleSource: 'user', updatedAt: 30 }]);
        assert.equal((await getStoredDomain(identity))!.conversation.detail.savedAt, 10, 'Index-only observation cannot advance the body version');
        const partial = { ...snapshot('C D E', 'partial', 30, true), acquisitionHints: { image: { dataBase64: 'BAUG' } } };
        const rejected = await ingestConversation(account.id, partial);
        assert.deepEqual(rejected.conversation.detail, original.conversation.detail);
        assert.equal(rejected.conversation.index.title, 'Renamed');
        assert.deepEqual(await getDomainResource(identity, 'image'), new Uint8Array([1, 2, 3]));
        const next = snapshot('A B edited', 'complete', 20);
        await ingestConversation(account.id, next);
        assert.deepEqual((await getStoredDomain(identity))!.conversation.detail, next.conversation.detail);
        assert.equal(await getDomainResource(identity, 'image'), null, 'removed assets cannot remain referenced by the current snapshot');
        await ingestConversation(account.id, snapshot('stale longer complete body', 'complete', 15));
        assert.deepEqual((await getStoredDomain(identity))!.conversation.detail, next.conversation.detail);
    } finally { env.restore(); }
});

test('admission replaces incomplete snapshots by order and rejects mismatched ownership and failed catalog commits', async () => {
    const env = indexStorage(), identity = storageIdentity('gemini', account.id, 'admission-storage');
    try {
        await ingestConversation(account.id, snapshot('long unknown body', 'unknown'));
        const next = snapshot('short', 'partial', 20);
        await ingestConversation(account.id, next);
        assert.deepEqual((await getStoredDomain(identity))!.conversation.detail, next.conversation.detail);
        await assert.rejects(ingestConversation('10000000-0000-4000-8000-000000000002', next), /account\/provider mismatch/);
        assert.equal((await getConversations('10000000-0000-4000-8000-000000000002')).length, 0);
        env.fail(`conversations_${account.id}`);
        await assert.rejects(ingestConversation(account.id, snapshot('uncommitted catalog', 'complete', 30)), /write failed/);
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
        const stored = await getStoredDomain(storageIdentity('gemini', account.id, key.conversationId));
        assert.deepEqual(stored!.conversation.detail, { ...detail, key });
        const index = (await getConversations(account.id)).find(row => row.key.conversationId === key.conversationId)!;
        assert.equal(index.title, 'Explicit title');
        assert.equal(index.updatedAt, 20);
        await assert.rejects(ingestDetail('10000000-0000-4000-8000-000000000099', key.conversationId, detail), /account does not exist/);
    } finally { env.restore(); }
});

test('partial source may supply independently matched bytes without changing the complete body or asset graph', async () => {
    const env = indexStorage(), identity = storageIdentity('gemini', account.id, 'admission-storage');
    try {
        const complete = { ...snapshot('complete body', 'complete', 10, true), acquisitionHints: {} };
        await ingestConversation(account.id, complete);
        assert.equal(await getDomainResource(identity, 'image'), null);
        await ingestConversation(account.id, snapshot('partial body', 'partial', 20, true));
        assert.deepEqual((await getStoredDomain(identity))!.conversation.detail, complete.conversation.detail);
        assert.deepEqual(await getDomainResource(identity, 'image'), new Uint8Array([1, 2, 3]));
    } finally { env.restore(); }
});

test('default retains source Index facts without establishing trusted account coverage', async () => {
    const env = indexStorage(), accountId = '10000000-0000-4000-8000-000000000003';
    const key = { accountId, conversationId: 'default-fact' };
    try {
        await ingestIndexes(accountId, [{ key, updatedAt: 100 }], { page: {
            providerId: 'gemini', accountId, streamId: 'recent', items: [{}], requestCursor: null, nextCursor: null,
            requestedAt: 1, requestKnown: true, valid: true, ordered: true, keys: [{ id: key.conversationId, time: 100 }],
        } });
        assert.deepEqual(await getConversations(accountId), [{ key, updatedAt: 100 }]);
        assert.equal(env.local['scan_coverage_' + accountId], undefined);
    } finally { env.restore(); }
});
