import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreConversationIndex } from '../src/core/domain/conversationIndex.js';
import { parseChatGPTList } from '../src/core/parsers/chatgpt/parseList.js';
import { ChatGPTProvider } from '../src/core/provider/chatgpt/chatgptProvider.js';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import { geminiListObservation } from '../src/core/provider/gemini/listObservation.js';
import { GeminiProvider } from '../src/core/provider/gemini/geminiProvider.js';
import { ACCOUNT_UUID } from './helpers/accountRuntime.js';
import { getOrCreateAccount } from '../src/core/api/accountRegistry.js';
import { sourceDetail } from './helpers/l1SourceFixture.js';
import { getConversations } from '../src/core/storage/conversationCatalogStore.js';
import { parseGeminiDomList, parseGeminiDomIndex } from '../src/core/parsers/gemini/dom/parseIndex.js';

test('ChatGPT lists emit exact Domain indexes with source times and no invented fallback facts', () => {
    const page = parseChatGPTList({ items: [
        { id: 'api-chat', title: '  Source title  ', create_time: 1700000000.125, update_time: '2023-11-14T22:14:20Z',
            timestamp: 999, titles: { user: 'Injected title' }, source: 'takeout', messageCount: 100 },
        { id: 'untitled', title: '', create_time: null, update_time: 'invalid' },
        { id: 'millis', title: 'A', create_time: 1700000000123, update_time: Infinity },
    ], total: 3, cursor: 'next' });
    assert.deepEqual(page.conversations[0], { id: 'api-chat', title: 'Source title',
        titleSource: 'provider', createdAt: 1700000000125, updatedAt: 1700000060000 });
    const empty = page.conversations[1];
    assert.equal(empty.title, undefined);
    assert.equal(empty.titleSource, undefined);
    assert.equal(Object.hasOwn(empty, 'updatedAt'), false);
    assert.equal(Object.hasOwn(empty, 'createdAt'), false);
    assert.equal(page.conversations[2].createdAt, 1700000000123);
    assert.equal(Object.hasOwn(page.conversations[2], 'updatedAt'), false);
    for (const index of page.conversations) assert.equal(Object.hasOwn(index, 'key'), false);
    assert.equal(page.total, 3);
    assert.equal(page.nextCursor, 'next');
});

test('malformed ChatGPT pages cannot masquerade as empty exhausted history', async () => {
    for (const value of [{}, { items: {} }, { items: [null] }, { items: [{ id: '' }] },
        { items: [], total: -1 }, { items: [], cursor: 3 }]) {
        assert.throws(() => parseChatGPTList(value), TypeError);
    }
    const account = await getOrCreateAccount('chatgpt', 'default');
    let progress = 0;
    const provider = new ChatGPTProvider({ fetchFn: async url => new Response(JSON.stringify(
        url.includes('/api/auth/session') ? { accessToken: 'test-token' } : { items: 'schema drift' }
    )) });
    await assert.rejects(provider.listConversations({ accountId: account.id, streamId: 'recent', onPageCommitted: async () => { progress++; return false; } }), TypeError);
    assert.equal(progress, 0);
});

test('provider commits indexes before progress and exposes control facts only', async () => {
    const provider = new ChatGPTProvider({ fetchFn: async url => new Response(JSON.stringify(
        url.includes('/api/auth/session') ? { accessToken: 'test-token' }
            : { items: [{ id: 'listed', title: 'Listed chat', update_time: 1700000060 }], total: 1 }
    )) });
    const account = await getOrCreateAccount('chatgpt', 'default');
    let observed: unknown;
    const result = await provider.listConversations({ accountId: account.id, streamId: 'recent', onPageCommitted: async info => {
        observed = info; assert.equal((await getConversations(account.id)).length, 1); return false;
    } });
    assert.equal(result, 'source_end'); assert.deepEqual(observed, { page: 1, totalObserved: 1 });

});

test('Gemini observations and pagination consume parsed evidence without reading decoded payloads', async () => {
    const parsed = parseList(JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [
        ['c_boundary123', 'Source title', null, null, null, [1700000060, 0]],
    ]])]]));
    Object.defineProperty(parsed, '_raw', { get() { throw new Error('downstream interpreted raw source'); } });
    const observation = geminiListObservation(parsed, { streamId: 'recent', requestCursor: null }, 'account');
    assert.equal(observation.valid, true);
    assert.equal(observation.ordered, true);
    assert.deepEqual(observation.keys, [{ id: 'boundary123', time: 1700000060000 }]);
    const provider = new GeminiProvider({ getConversationList: async () => parsed, getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    assert.equal(await provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'recent' }), 'source_end');
    assert.equal((await getConversations(ACCOUNT_UUID))[0].updatedAt, 1700000060000);
});

test('Gemini parser rejects incomplete row coverage and unknown layouts as exhaustion evidence', () => {
    for (const inner of [[null, null, [null]], [null, { unexpected: true }],
        [null, 'tC_cursor', []], [null, null, [['c_unknown', 'Invalid identity']]],
        [null, null, [['c_settings', 'Reserved route']]]]) {
        const parsed = parseList(JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify(inner)]]));
        assert.equal(parsed.pageEvidence.valid, false, JSON.stringify(inner));
        assert.equal(parsed.pageEvidence.ordered, false);
    }
});

test('DOM metadata preserves title precedence and keeps UI labels and observation clocks out of Domain', () => {
    const header = { textContent: 'Header title' };
    const sidebar = { textContent: 'Google Gemini', href: 'https://gemini.google.com/app/boundary123',
        querySelector: () => null };
    const query = { textContent: 'First user question' };
    const doc = { title: 'Google Gemini',
        querySelectorAll: (selector: string) => selector.includes('a[href') ? [sidebar]
            : selector.includes('conversation-title') ? [header] : [],
        querySelector: (selector: string) => selector.startsWith('user-query') ? query : null,
    } as unknown as Document;
    const [index] = parseGeminiDomList(doc);
    assert.equal(index.title, '');
    assert.equal(index.titleSource, 'dom');
    assert.equal(Reflect.get(index ?? {}, 'cloudAvailability'), undefined);
    assert.equal(Object.hasOwn(index, 'key'), false);
    assert.equal(parseGeminiDomIndex(doc, 'boundary123').title, 'Header title');
    header.textContent = 'Google Gemini';
    const fallback = parseGeminiDomIndex(doc, 'boundary123');
    assert.equal(fallback.title, 'First user question');
    assert.equal(fallback.titleSource, 'sniff');
    assert.equal(Object.hasOwn(fallback, 'updatedAt'), false);
    assert.equal(Object.hasOwn(fallback, 'createdAt'), false);
});
