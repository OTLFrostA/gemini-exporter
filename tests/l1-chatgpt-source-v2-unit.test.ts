import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatGPTConversation } from '../src/l1/parsers/chatgpt/parseConversation.js';
import { parseChatGPTList } from '../src/l1/parsers/chatgpt/parseList.js';
import type { ChatGPTApiConversationWithId, ChatGPTConversationNode } from '../src/l1/parsers/chatgpt/chatgptTypes.js';

const textNode = (id: string, parent: string, role: 'assistant' | 'user', content: string): ChatGPTConversationNode => ({
    id, parent, children: [],
    message: { id: 'message-' + id, author: { role, metadata: {} }, recipient: 'all',
        status: 'finished_successfully', weight: 1, content: { content_type: 'text', parts: [content] } },
});
function conversation(mapping: Record<string, ChatGPTConversationNode>, current_node = 'answer'): ChatGPTApiConversationWithId {
    return { id: 'source-chatgpt-1', title: 'Authored title', create_time: 1700000000,
        update_time: 1700000010, current_node, mapping, is_archived: false };
}
const parse = (raw: ChatGPTApiConversationWithId) => parseChatGPTConversation({
    conversation: raw, assetsByNode: new Map(),
});

test('ChatGPT source branch to root yields keyless complete Detail and millisecond source times', () => {
    const mapping = {
        root: { id: 'root', children: ['question'] },
        question: textNode('question', 'root', 'user', 'Question'),
        answer: textNode('answer', 'question', 'assistant', 'Answer'),
    };
    const original = structuredClone(mapping);
    const result = parse(conversation(mapping));
    assert.equal(result.conversationId, 'source-chatgpt-1');
    assert.equal(result.conversation.detail.quality.status, 'complete');
    assert.equal(result.conversation.detail.savedAt, 1700000010000);
    assert.equal(result.conversation.index.updatedAt, 1700000010000);
    assert.equal(result.conversation.index.titleSource, 'provider');
    assert.equal('key' in result.conversation.index, false);
    assert.equal('key' in result.conversation.detail, false);
    assert.deepEqual(result.conversation.detail.messages.map(message => message.role), ['user', 'assistant']);
    assert.deepEqual(mapping, original);
});

test('ChatGPT missing ancestors, cycles and unknown current node never fabricate full coverage', () => {
    const missing = parse(conversation({ answer: textNode('answer', 'missing', 'assistant', 'Answer') }));
    assert.equal(missing.conversation.detail.quality.status, 'partial');
    const cycle = parse(conversation({
        answer: textNode('answer', 'question', 'assistant', 'Answer'),
        question: textNode('question', 'answer', 'user', 'Question'),
    }));
    assert.equal(cycle.conversation.detail.quality.status, 'partial');
    const unknown = parse(conversation({}, ''));
    assert.equal(unknown.conversation.detail.quality.status, 'unknown');
});

test('ChatGPT missing image bytes does not become missing body evidence', () => {
    const mapping: Record<string, ChatGPTConversationNode> = {
        root: { id: 'root', children: ['answer'] },
        answer: {
            id: 'answer', parent: 'root', children: [],
            message: { id: 'message-image', author: { role: 'assistant', metadata: {} },
                recipient: 'all', status: 'finished_successfully', weight: 1,
                content: { content_type: 'multimodal_text',
                    parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://photo-1' }] } },
        },
    };
    const result = parse(conversation(mapping));
    assert.equal(result.conversation.detail.quality.status, 'complete');
    assert.equal(result.conversation.detail.assets.length, 1);
    assert.ok(result.diagnostics.some(d => d.code === 'CHATGPT_IMAGE_ASSET_UNAVAILABLE'));
    assert.deepEqual(result.conversation.detail.messages[0].attachmentIds, [result.conversation.detail.assets[0].id]);
});

test('ChatGPT source-native paging fields remain evidence, not Domain Index fields', () => {
    const parsed = parseChatGPTList({
        items: [{ id: 'chat-1', title: 'Title', create_time: 1700000000, update_time: 1700000010 }],
        total: 1, offset: 0, limit: 100, has_missing_conversations: false,
    });
    assert.equal(parsed.total, 1);
    assert.equal(parsed.offset, 0);
    assert.equal(parsed.limit, 100);
    assert.equal(parsed.hasMissingConversations, false);
    assert.deepEqual(parsed.conversations, [{ id: 'chat-1', title: 'Title', titleSource: 'provider',
        createdAt: 1700000000000, updatedAt: 1700000010000 }]);
    assert.equal('total' in parsed.conversations[0], false);
    assert.throws(() => parseChatGPTList({ items: [], total: 0, offset: -1, limit: 100 }), TypeError);
});

test('ChatGPT optional legacy missing flag preserves absence and rejects malformed values', () => {
    const page = { items: [], total: 0, offset: 0, limit: 100 };
    assert.equal(parseChatGPTList(page).hasMissingConversations, undefined);
    assert.equal(parseChatGPTList({ ...page, has_missing_conversations: true }).hasMissingConversations, true);
    for (const value of [null, 'false', 0, {}]) {
        assert.throws(() => parseChatGPTList({ ...page, has_missing_conversations: value }), TypeError);
    }
});
