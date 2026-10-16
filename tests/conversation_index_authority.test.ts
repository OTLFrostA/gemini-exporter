import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeConversationIndex } from '../src/core/domain/conversationIndex.js';
import { TITLE_AUTHORITY_RANK, hasProviderTitleEvidence, type TitleSource } from '../src/core/domain/titleAuthority.js';
import { resolveTitle } from '../src/core/utils/titleUtils.js';
import { parseGeminiRpcConversation } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import { parseGeminiTakeoutConversation } from '../src/core/parsers/gemini/takeout/parseConversation.js';
import { parseChatGPTList } from '../src/core/parsers/chatgpt/parseList.js';
import { parseChatGPTConversation } from '../src/core/parsers/chatgpt/parseConversation.js';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import { ingestConversation, StorageService } from '../src/core/storage/storageService.js';
import { getDomainConversationResult } from '../src/core/storage/domain/nativePersistence.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { indexFixture } from './helpers/indexFixture.js';
import { indexStorage } from './helpers/indexStorage.js';

const id = 'evidence12345678';
const wire = (inner: unknown, metadata?: unknown) => JSON.stringify([
    ['wrb.fr', 'hNvQHb', JSON.stringify(inner)],
    ...(metadata ? [['wrb.fr', 'MaZiqc', JSON.stringify(metadata)]] : []),
]);
const turn = [[`c_${id}`, 'r_request'], [1700000000, 0], [['Explain evidence provenance']], [[['rc_answer', [['An answer']]]]]];

test('only explicit list fields establish RPC title authority beside a detail response', () => {
    // A live detail envelope has turns at [0], with no characterized title scalar.
    for (const inner of [[[turn], null, 'Plausible but uncharacterized string'],
        [[turn], 'Another string', null, 'Broad scan bait']]) {
        const parsed = parseGeminiRpcConversation(wire(inner), { providerId: 'gemini', targetConvId: id });
        assert.equal(parsed.conversation.index.titleSource, 'sniff');
        assert.notEqual(parsed.conversation.index.title, 'Plausible but uncharacterized string');
        const withList = parseGeminiRpcConversation(wire(inner, [null, null, [
            ['c_other12345678', 'Unrelated title'], [`c_${id}`, 'Official list title', null, null, null, [1700000000, 0]],
        ]]), { providerId: 'gemini', targetConvId: id });
        assert.equal(withList.conversation.index.title, 'Official list title');
        assert.equal(withList.conversation.index.titleSource, 'rpc');
    }
    const metadata = parseGeminiRpcConversation(wire([null, null, [
        ['c_other12345678', 'Other title'], [`c_${id}`, 'Metadata-only title'],
    ]]), { providerId: 'gemini', targetConvId: id });
    assert.equal(metadata.conversation.index.id, id);
    assert.equal(metadata.conversation.index.title, 'Metadata-only title');
    assert.equal(metadata.conversation.index.titleSource, 'rpc');
});

test('the complete source ranking is shared by L2 and compatibility presentation', () => {
    const sources = Object.keys(TITLE_AUTHORITY_RANK) as TitleSource[];
    for (const strong of sources.filter(source => source !== 'default')) {
        const authority = indexFixture({ id, title: 'Authority title', titleSource: strong });
        for (const weak of sources.filter(source => TITLE_AUTHORITY_RANK[source] < TITLE_AUTHORITY_RANK[strong])) {
            const fallback = indexFixture({ id, title: weak === 'default' ? '' : 'Fallback title', titleSource: weak });
            for (const pair of [[authority, fallback], [fallback, authority]]) {
                assert.equal(mergeConversationIndex(pair[0], pair[1]).title, authority.title);
                assert.deepEqual(resolveTitle({ ...pair[0], titles: { [pair[1].titleSource]: pair[1].title } }),
                    { title: authority.title, source: strong });
            }
        }
        assert.equal(hasProviderTitleEvidence(authority), TITLE_AUTHORITY_RANK[strong] >= 50);
    }
});

test('an absent Takeout prompt remains untitled while its response survives', () => {
    const parsed = parseGeminiTakeoutConversation({ htmlText: `<html><body><div class="outer-cell">
        <a href="https://gemini.google.com/app/${id}">Conversation</a>
        <div class="content-cell mdl-typography--body-1">Takeout conversation<br><p>Saved answer</p></div>
        </div></body></html>` }, { providerId: 'gemini' });
    assert.equal(parsed.conversation.index.title, '');
    assert.equal(parsed.conversation.index.titleSource, 'default');
    assert.equal(parsed.conversation.index.hasTakeoutImport, true);
    assert.ok(parsed.conversation.detail.messages.some(message => message.role === 'assistant'));
});

test('ChatGPT list and detail agree on placeholder titles without changing their current source tier', () => {
    for (const title of ['New chat', 'Untitled conversation', '未命名对话', '', 'Source title']) {
        const list = parseChatGPTList({ items: [{ id, title }] }).conversations[0];
        const detail = parseChatGPTConversation({ conversation: { id, title, mapping: { root: { id: 'root', children: [] } }, current_node: 'root', create_time: 1700000000, update_time: 1700000000, is_archived: false }, assetsByNode: new Map() }).conversation.index;
        assert.equal(list.title, detail.title, title);
        assert.equal(list.titleSource, detail.titleSource, title);
        assert.equal(list.titleSource, title === 'Source title' ? 'provider' : 'default');
    }
});

test('detail, Takeout and index-only admission share title authority without modifying the stored body', async () => {
    const env = indexStorage();
    try {
        const body = historicalFixture({ id, title: 'Prompt fallback', titleSource: 'takeout',
            messages: [{ role: 'user', content: 'Question' }, { role: 'model', content: 'Archived answer' }] });
        await ingestConversation('u0', body, [], 'takeout');
        const before = await getDomainConversationResult('u0', id);
        const official = parseList(JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [
            [`c_${id}`, 'Official title', null, null, null, [1700000000, 0]],
        ]])]])).conversations[0];
        await StorageService.transactConversations('u0', existing => ({
            list: existing.map(row => mergeConversationIndex(row, official)), changed: 1,
        }));
        assert.deepEqual(await getDomainConversationResult('u0', id), before, 'Index-only admission never writes Detail');
        const accepted = await ingestConversation('u0', body, [], 'takeout');
        assert.equal(accepted.conversation.index.title, 'Official title');
        assert.equal(accepted.conversation.index.titleSource, 'rpc');
        assert.equal((await StorageService.getConversations('u0'))[0].hasTakeoutImport, true);
        assert.deepEqual(accepted.conversation.detail, before?.conversation.detail);
    } finally { env.restore(); }
});
