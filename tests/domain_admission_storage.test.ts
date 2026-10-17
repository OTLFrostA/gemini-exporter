import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { ingestConversation, ingestIndexes } from '../src/core/storage/conversationIngest.js';
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
        const rejected = await ingestConversation(account.id, snapshot('C D E', 'partial', 30));
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
