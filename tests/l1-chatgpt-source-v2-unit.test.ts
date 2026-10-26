import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatGPTConversation } from '../src/l1/parsers/chatgpt/parseConversation.js';
import { parseChatGPTList } from '../src/l1/parsers/chatgpt/parseList.js';
import { listGen as chatgptListGen } from './fixtures/providers/chatgpt.js';
import { detailGen as chatgptDetailGen } from './fixtures/providers/chatgptDetail.js';
import { decodeChatGPTDetail } from '../src/l1/parsers/chatgpt/decodeDetail.js';

const parse = (raw: { id: string }) => parseChatGPTConversation({
    conversation: decodeChatGPTDetail(raw, raw.id), assetsByNode: new Map(),
});

test('ChatGPT source branch to root yields keyless complete Detail and millisecond source times', () => {
    const raw = chatgptDetailGen('C_DETAIL_L1_SOURCE_01');
    const original = structuredClone(raw.mapping);
    const result = parse(raw);
    assert.equal(result.conversationId, 'source-chatgpt-1');
    assert.equal(result.conversation.detail.quality.status, 'complete');
    assert.equal(result.conversation.detail.savedAt, 1700000010000);
    assert.equal(result.conversation.index.updatedAt, 1700000010000);
    assert.equal(result.conversation.index.titleSource, 'provider');
    assert.equal('key' in result.conversation.index, false);
    assert.equal('key' in result.conversation.detail, false);
    assert.deepEqual(result.conversation.detail.messages.map(message => message.role), ['user', 'assistant']);
    assert.deepEqual(raw.mapping, original);
});

test('ChatGPT missing ancestors, cycles and unknown current node never fabricate full coverage', () => {
    const missing = parse(chatgptDetailGen('C_DETAIL_L1_SOURCE_02'));
    assert.equal(missing.conversation.detail.quality.status, 'partial');
    const cycle = parse(chatgptDetailGen('C_DETAIL_L1_SOURCE_03'));
    assert.equal(cycle.conversation.detail.quality.status, 'partial');
    const unknown = parse(chatgptDetailGen('C_DETAIL_L1_SOURCE_04'));
    assert.equal(unknown.conversation.detail.quality.status, 'unknown');
});

test('ChatGPT missing image bytes does not become missing body evidence', () => {
    const result = parse(chatgptDetailGen('C_DETAIL_L1_SOURCE_05'));
    assert.equal(result.conversation.detail.quality.status, 'complete');
    assert.equal(result.conversation.detail.assets.length, 1);
    assert.ok(result.diagnostics.some(d => d.code === 'CHATGPT_IMAGE_ASSET_UNAVAILABLE'));
    assert.equal(result.conversation.detail.messages[0].attachmentIds, undefined);
    assert.deepEqual(result.conversation.detail.messages[0].content.filter(b => b.type === 'image').map(b => b.assetId), [result.conversation.detail.assets[0].id]);
});

test('ChatGPT source-native paging fields remain evidence, not Domain Index fields', () => {
    const parsed = parseChatGPTList(chatgptListGen('C_L1_CHATGPT_SOURCE_V2_UNIT_01'));
    assert.equal(parsed.total, 1);
    assert.equal(parsed.offset, 0);
    assert.equal(parsed.limit, 100);
    assert.equal(parsed.hasMissingConversations, false);
    assert.deepEqual(parsed.conversations, [{ id: 'chat-1', title: 'Title', titleSource: 'provider',
        createdAt: 1700000000000, updatedAt: 1700000010000 }]);
    assert.equal('total' in parsed.conversations[0], false);
    assert.throws(() => parseChatGPTList(chatgptListGen('C_L1_CHATGPT_SOURCE_V2_UNIT_02')), TypeError);
});

test('ChatGPT optional legacy missing flag preserves absence and rejects malformed values', () => {
    const page = chatgptListGen('C_L1_CHATGPT_SOURCE_V2_UNIT_03');
    assert.equal(parseChatGPTList(page).hasMissingConversations, undefined);
    assert.equal(parseChatGPTList(chatgptListGen('C_L1_CHATGPT_SOURCE_V2_UNIT_04')).hasMissingConversations, true);
    for (const key of ['C_L1_CHATGPT_SOURCE_V2_UNIT_05_0', 'C_L1_CHATGPT_SOURCE_V2_UNIT_05_1', 'C_L1_CHATGPT_SOURCE_V2_UNIT_05_2', 'C_L1_CHATGPT_SOURCE_V2_UNIT_05_3'] as const) {
        const malformed = chatgptListGen(key);
        assert.throws(() => parseChatGPTList(malformed), TypeError);
    }
});
