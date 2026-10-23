import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeChatGPTDetail } from '../src/l1/parsers/chatgpt/decodeDetail.js';
import { parseChatGPTConversation } from '../src/l1/parsers/chatgpt/parseConversation.js';
import { detailGen } from './fixtures/providers/chatgptDetail.js';

const id = 'source-chatgpt-1';

test('ChatGPT Detail boundary preserves complete, partial, cyclic and empty source evidence', () => {
    const cases = [
        ['C_DETAIL_L1_SOURCE_01', 'complete'],
        ['C_DETAIL_L1_SOURCE_02', 'partial'],
        ['C_DETAIL_L1_SOURCE_03', 'partial'],
        ['C_DETAIL_L1_SOURCE_04', 'unknown'],
        ['C_DETAIL_L1_SOURCE_05', 'complete'],
    ] as const;
    for (const [key, quality] of cases) {
        const original = detailGen(key), before = structuredClone(original);
        const conversation = decodeChatGPTDetail(original, id);
        assert.deepEqual(original, before, 'Boundary must not mutate source evidence');
        assert.equal(conversation.id, id);
        const parsed = parseChatGPTConversation({ conversation, assetsByNode: new Map() });
        assert.equal(parsed.conversation.detail.quality.status, quality, key);
    }
});

test('ChatGPT Detail boundary binds both native IDs and never relabels foreign evidence', () => {
    const original = detailGen('C_DETAIL_L1_SOURCE_01');
    assert.equal(decodeChatGPTDetail({ ...original, id: undefined, conversation_id: id }, id).id, id);
    for (const bad of [
        { ...original, id: 'foreign' },
        { ...original, conversation_id: 'foreign' },
        { ...original, id: undefined, conversation_id: 'foreign' },
        { ...original, id: id, conversation_id: null },
    ]) {
        assert.throws(() => decodeChatGPTDetail(bad, id), /Detail identity mismatch/);
    }
});

test('ChatGPT Detail boundary rejects untrusted mapping and message structures before typed parsing', () => {
    const original = detailGen('C_DETAIL_L1_SOURCE_01');
    const message = original.mapping.answer.message;
    for (const bad of [
        {}, { ...original, mapping: null },
        { ...original, mapping: [] },
        { ...original, mapping: { answer: 'not a node' } },
        { ...original, mapping: { answer: { id: 'wrong', children: [] } } },
        { ...original, mapping: { answer: { id: 'answer', children: 'invalid' } } },
        { ...original, mapping: { answer: { id: 'answer', children: [], parent: 42 } } },
        { ...original, mapping: { answer: { id: 'answer', children: [], message: {} } } },
        { ...original, mapping: { answer: { id: 'answer', children: [], message: { ...message, author: null } } } },
        { ...original, mapping: { answer: { id: 'answer', children: [], message: { ...message, content: { content_type: 'text', parts: [null] } } } } },
        { ...original, mapping: { answer: { id: 'answer', children: [], message: { ...message, content: { content_type: 'multimodal_text', parts: [12] } } } } },
        { ...original, current_node: 22 },
    ]) {
        assert.throws(() => decodeChatGPTDetail(bad, id), TypeError);
    }
});

test('ChatGPT Detail decoder sanitizes optional nested metadata without leaking raw records', () => {
    const original = detailGen('C_DETAIL_L1_SOURCE_01');
    const answer = original.mapping.answer;
    const raw = {
        ...original,
        mapping: {
            ...original.mapping,
            answer: { ...answer, message: { ...answer.message, metadata: {
                model_slug: 'gpt-6',
                attachments: [{ id: 'f1', name: 'file.txt', mime_type: 'text/plain' }, { bad: 1 }],
                citations: [{ metadata: { title: 'Reference', url: 'https://example.com', fake: { nested: true } } }],
                content_references: [{ sources: [{ title: 'Second', url: 'https://second.example', fake: true }] }],
                aggregate_result: { messages: [{ message_type: 'image', image_url: 'https://img.example' }, null] },
                model_dil_v2: {
                    code: 'source', fallbackMarkdown: 'fallback',
                    constants: { good: 'resolved-id', bad: { untrusted: true } },
                    appData: { opGenui: { componentResults: {
                        r: { componentName: 'AsyncImage', status: 'resolved',
                            safe_urls: ['https://images.openai.com/valid', 1],
                            state: { images: [{ content_url: 'https://images.openai.com/valid' }] } },
                    } } },
                },
                strange: { shouldNotEscape: true },
            } } },
        },
    };
    const decoded = decodeChatGPTDetail(raw, id);
    const meta = decoded.mapping.answer.message?.metadata;
    assert.equal(meta?.model_slug, 'gpt-6');
    assert.deepEqual(meta?.attachments?.map(item => item.id), ['f1']);
    assert.deepEqual(meta?.citations, [{ metadata: { title: 'Reference', url: 'https://example.com' } }]);
    assert.deepEqual(meta?.content_references?.[0].sources, [{ title: 'Second', url: 'https://second.example' }]);
    assert.deepEqual(meta?.aggregate_result?.messages, [{ message_type: 'image', image_url: 'https://img.example' }]);
    assert.deepEqual(meta?.model_dil_v2?.constants, { good: 'resolved-id' });
    // A malformed safe_urls list must never be passed to the gallery selector.
    assert.equal(meta?.model_dil_v2?.appData?.opGenui?.componentResults?.r.safe_urls, undefined);
    assert.equal('strange' in (meta ?? {}), false);
});

test('ChatGPT Detail boundary retains unknown content kinds as non-renderable, not guessed prose', () => {
    const original = detailGen('C_DETAIL_L1_SOURCE_01');
    const answer = original.mapping.answer;
    const decoded = decodeChatGPTDetail({
        ...original, mapping: {
            ...original.mapping,
            answer: { ...answer, message: { ...answer.message,
                content: { content_type: 'new_provider_kind', private_value: { body: 'not trustworthy' } } } },
        },
    }, id);
    assert.deepEqual(decoded.mapping.answer.message?.content, { content_type: 'new_provider_kind' });
});

test('ChatGPT manual and live Detail entrypoints both invoke the shared boundary', () => {
    const provider = readFileSync(join(__dirname, '../src/l1/client/chatgpt/chatgptProvider.ts'), 'utf8');
    const capture = readFileSync(join(__dirname, '../src/runtime/content/chatgptContent.ts'), 'utf8');
    assert.match(provider, /decodeChatGPTDetail\(raw, conversationId\)/);
    assert.match(capture, /decodeChatGPTDetail\(raw\.responseBody, key\.conversationId\)/);
    assert.doesNotMatch(provider, /as ChatGPTApiConversationWithId/);
    assert.doesNotMatch(capture, /as ChatGPTApiConversationWithId/);
});
