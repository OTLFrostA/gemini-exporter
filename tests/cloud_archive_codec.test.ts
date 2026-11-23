import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreCloudConversationsToLocal } from '../src/application/vault/cloudArchiveCodec.js';
import { ingestIndexes } from '../src/l2/ingestion.js';
import { getIndex } from '../src/l3a/storageService.js';
import { getOrCreateAccount } from '../src/runtime/api/accountRegistry.js';
import { CLOUD_CONVERSATION_SCHEMA, type PortableCloudConversation } from '../src/l2/cloudPayload.js';
import { indexStorage } from './helpers/indexStorage.js';

test('index-only cloud restore counts partial updates and equal facts while rejecting unchanged stale rows', async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const account = await getOrCreateAccount('gemini', 'restore-index-account');
        const entry = (conversationId: string, updatedAt: number): PortableCloudConversation => ({
            schema: CLOUD_CONVERSATION_SCHEMA, version: 1,
            account: { providerId: account.providerId, providerAccountId: account.providerAccountId },
            conversationId, index: { title: 'Same title', titleSource: 'provider', updatedAt },
        });
        await ingestIndexes(account.id, ['stale', 'equal', 'newer', 'partial-title', 'partial-time', 'sparse'].map(conversationId => ({
            conversationId, fields: entry(conversationId, 200).index,
        })));
        const summary = await restoreCloudConversationsToLocal([
            entry('stale', 100), entry('equal', 200), entry('newer', 300), entry('new', 100),
            { ...entry('partial-title', 100), index: { ...entry('partial-title', 100).index, title: 'Incoming title' } },
            { ...entry('partial-time', 300), index: { title: 'Derived title', titleSource: 'derived', updatedAt: 300 } },
            { ...entry('sparse', 200), index: { updatedAt: 200 } },
        ]);
        assert.deepEqual(summary, { accepted: 6, rejected: 1, changed: 4, touchedAccountIds: [account.id] });
        const partialTime = await getIndex({ accountId: account.id, conversationId: 'partial-time' });
        assert.equal(partialTime?.title, 'Same title');
        assert.equal(partialTime?.updatedAt, 300);
        assert.equal((await getIndex({ accountId: account.id, conversationId: 'stale' }))?.updatedAt, 200);
        assert.deepEqual(await restoreCloudConversationsToLocal([]), { accepted: 0, rejected: 0, changed: 0, touchedAccountIds: [] });
        await assert.rejects(restoreCloudConversationsToLocal([
            { ...entry('invalid', 100), index: { updatedAt: NaN } },
        ]), /Invalid conversation index schema/);
    } finally { env.restore(); }
});
