import test from 'node:test';
import assert from 'node:assert/strict';
import { useIndexStorage } from './helpers/indexStorage.js';
import { ACCOUNT_UUID, OTHER_ACCOUNT_UUID } from './helpers/accountRuntime.js';
import { sourceDetail, sourceList } from './helpers/l1SourceFixture.js';
import { GeminiProvider } from '../src/core/provider/gemini/geminiProvider.js';
import credentials from '../src/core/api/client/credentialManager.js';
import { getConversations } from '../src/core/storage/conversationCatalogStore.js';
import { getStoredDomain } from '../src/core/storage/domain/domainStore.js';
useIndexStorage();

test('adapter submits source Detail and returns completion without a Domain/transport payload', async () => {
    const parsed = sourceDetail();
    parsed.transport.decodedPayload = { source: 'wire' };
    const before = structuredClone(parsed);
    let request: unknown;
    const provider = new GeminiProvider({ getConversationList: async () => sourceList(),
        getConversationDetail: async (...args) => { request = args; return parsed; } }, async () => 'u1');
    const controller = new AbortController();
    assert.equal(await provider.fetchConversationDetail(ACCOUNT_UUID, parsed.conversationId, controller.signal), undefined);
    assert.equal((request as unknown[])[1], 'u1');
    assert.equal((request as unknown[])[3], controller.signal);
    assert.deepEqual(parsed, before);
    const stored = await getStoredDomain({ providerId: 'gemini', accountId: ACCOUNT_UUID, conversationId: parsed.conversationId });
    assert.ok(stored); assert.equal(stored.conversation.detail.messages.length, 1);
    assert.equal(Reflect.get(stored.conversation.detail, 'transport'), undefined);
    assert.equal((await getConversations(OTHER_ACCOUNT_UUID)).length, 0);
});
test('adapter commits a natural empty terminal before callback and exposes no aggregate fields', async () => {
    const provider = new GeminiProvider({ getConversationList: async () => sourceList(), getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    let progress: unknown;
    assert.equal(await provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'recent', onPageCommitted: async info => { progress = info; return false; } }), 'source_end');
    assert.deepEqual(Object.keys(progress as object).sort(), ['page', 'scanHead', 'totalObserved']);
});
test('adapter readiness is account-bound and reports credential failures without manufacturing account names', async () => {
    const original = credentials.resolveCred;
    try {
        const provider = new GeminiProvider(undefined, async () => 'u0');
        credentials.resolveCred = async () => { throw new Error('credential failure'); };
        assert.deepEqual(await provider.checkReadiness(ACCOUNT_UUID), { ready: false, error: 'credential failure' });
        credentials.resolveCred = async () => { throw 'unknown failure'; };
        assert.deepEqual(await provider.checkReadiness(ACCOUNT_UUID), { ready: false, error: 'Gemini unavailable' });
        assert.equal((await provider.checkReadiness('u0')).ready, false);
    } finally { credentials.resolveCred = original; }
});
