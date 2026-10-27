import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatGPTConversation } from '../src/l1/parsers/chatgpt/parseConversation.js';
import { parseChatGPTList } from '../src/l1/parsers/chatgpt/parseList.js';
import { listGen as chatgptListGen } from './fixtures/providers/chatgpt.js';
import { detailGen as chatgptDetailGen } from './fixtures/providers/chatgptDetail.js';
import { decodeChatGPTDetail } from '../src/l1/parsers/chatgpt/decodeDetail.js';
import { restoreDomainDetail } from '../src/l2/runtimeValidation.js';

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

test('ChatGPT Detail rejects empty attachment identities before exposing typed metadata', () => {
    const raw = chatgptDetailGen('C_DETAIL_L1_SOURCE_01');
    const message = raw.mapping.question?.message;
    assert.ok(message);
    message.metadata = { attachments: [
        { id: '', name: 'missing-id.txt', size: 12 },
        { id: 'missing-name', name: '', size: 13 },
        { id: 'notes', name: 'notes.txt', size: 14 },
        { id: 'picture', name: 'image.png', mime_type: 'image/png' },
    ] };
    const source = structuredClone(raw.mapping.question);
    const decoded = decodeChatGPTDetail(raw, raw.id);
    assert.deepEqual(decoded.mapping.get('question')?.message?.metadata?.attachments, [
        { id: 'notes', name: 'notes.txt', size: 14 },
        { id: 'picture', name: 'image.png', mime_type: 'image/png' },
    ]);
    const parsed = parseChatGPTConversation({ conversation: decoded, assetsByNode: new Map() });
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.deepEqual(parsed.conversation.detail.assets.map(a => [a.id, a.name, a.byteLength]),
        [['file-notes', 'notes.txt', 14]]);
    assert.deepEqual(raw.mapping.question, source, 'the provider source must remain unchanged');
});

test('ChatGPT Detail only admits safe nonnegative attachment byte counts to L2', () => {
    for (const [size, expected] of [
        [-1, undefined], [1.5, undefined], [Number.MAX_SAFE_INTEGER + 1, undefined],
        [NaN, undefined], [Infinity, undefined], ['12', undefined], [null, undefined],
        [0, 0], [12, 12], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ] as const) {
        const raw = chatgptDetailGen('C_DETAIL_L1_SOURCE_01');
        const message = raw.mapping.question?.message;
        assert.ok(message);
        message.metadata = { attachments: [{ id: 'file-size', name: 'data.bin' }] };
        const file = message.metadata.attachments?.[0];
        assert.ok(file);
        Object.assign(file, { size });

        const decoded = decodeChatGPTDetail(raw, raw.id);
        assert.equal(decoded.mapping.get('question')?.message?.metadata?.attachments?.[0]?.size, expected, String(size));
        const parsed = parseChatGPTConversation({ conversation: decoded, assetsByNode: new Map() });
        assert.equal(parsed.conversation.detail.assets.length, 1, String(size));
        assert.equal(parsed.conversation.detail.assets[0]?.byteLength, expected, String(size));
        assert.equal(parsed.conversation.detail.quality.status, 'complete', String(size));
        assert.doesNotThrow(() => restoreDomainDetail({ ...parsed.conversation.detail,
            key: { accountId: '00000000-0000-4000-8000-000000000001', conversationId: raw.id } }), String(size));
    }
});

test('ChatGPT Detail discards negative reasoning durations without losing valid fractional seconds', () => {
    for (const [duration, expected] of [
        [-1, undefined], [-0.25, undefined], [NaN, undefined], [Infinity, undefined],
        ['3', undefined], [0, 0], [1.25, 1.25],
    ] as const) {
        const raw = chatgptDetailGen('C_DETAIL_L1_SOURCE_01');
        const message = raw.mapping.answer?.message;
        assert.ok(message);
        message.metadata = { finished_duration_sec: 0 };
        Object.assign(message.metadata, { finished_duration_sec: duration });
        assert.equal(decodeChatGPTDetail(raw, raw.id).mapping.get('answer')?.message?.metadata?.finished_duration_sec,
            expected, String(duration));
    }
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
