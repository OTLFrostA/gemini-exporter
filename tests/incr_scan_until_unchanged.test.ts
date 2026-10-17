import test from 'node:test';
import assert from 'node:assert/strict';
import { useIndexStorage } from './helpers/indexStorage.js';
import { ACCOUNT_UUID } from './helpers/accountRuntime.js';
import { sourceDetail, sourceList } from './helpers/l1SourceFixture.js';
import { GeminiProvider } from '../src/core/provider/gemini/geminiProvider.js';
import { listIndexes as getConversations } from '../src/core/storage/storageService.js';
useIndexStorage();
test('without a caller stop the Client commits all three pages and reports source_end', async () => {
    let calls = 0;
    const provider = new GeminiProvider({ getConversationList: async () => {
        const page = calls++;
        return sourceList(Array.from({ length: 50 }, (_, i) => `chat${page * 50 + i}`), page < 2 ? 'tC_' + page : null);
    }, getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    const counts: number[] = [];
    assert.equal(await provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'recent', onPageCommitted: async info => { counts.push(info.totalObserved); return false; } }), 'source_end');
    assert.equal(calls, 3); assert.deepEqual(counts, [50, 100, 150]);
    assert.equal((await getConversations(ACCOUNT_UUID)).length, 150);
});
