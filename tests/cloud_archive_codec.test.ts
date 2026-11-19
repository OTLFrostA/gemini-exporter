import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreCloudConversationsToLocal } from '../src/application/cloud/cloudArchiveCodec.js';
import { ingestIndexes } from '../src/l2/ingestion.js';
import { getIndex } from '../src/l3a/storageService.js';
import { getOrCreateAccount } from '../src/runtime/api/accountRegistry.js';
import { CLOUD_CONVERSATION_SCHEMA, type PortableCloudConversation } from '../src/l2/cloudPayload.js';
import { indexStorage } from './helpers/indexStorage.js';

test('index-only cloud restore counts selected and equal facts, not stale or partially losing rows', async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const account = await getOrCreateAccount('gemini', 'restore-index-account');
        const entry = (conversationId: string, updatedAt: number): PortableCloudConversation => ({
            schema: CLOUD_CONVERSATION_SCHEMA, version: 1,
            account: { providerId: account.providerId, providerAccountId: account.providerAccountId },
            conversationId, index: { title: 'Same title', titleSource: 'provider', updatedAt },
        });
        await ingestIndexes(account.id, ['stale', 'equal', 'newer', 'partial'].map(conversationId => ({
            conversationId, fields: entry(conversationId, 200).index,
        })));
        const summary = await restoreCloudConversationsToLocal([
            entry('stale', 100), entry('equal', 200), entry('newer', 300), entry('new', 100),
            { ...entry('partial', 100), index: { ...entry('partial', 100).index, title: 'Incoming title' } },
        ]);
        assert.deepEqual(summary, { accepted: 3, rejected: 2, changed: 3, touchedAccountIds: [account.id] });
        assert.equal((await getIndex({ accountId: account.id, conversationId: 'stale' }))?.updatedAt, 200);
        assert.deepEqual(await restoreCloudConversationsToLocal([]), { accepted: 0, rejected: 0, changed: 0, touchedAccountIds: [] });
        await assert.rejects(restoreCloudConversationsToLocal([
            { ...entry('invalid', 100), index: { updatedAt: NaN } },
        ]), /Invalid conversation index schema/);
    } finally { env.restore(); }
});
