import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeList } from '../src/l1/parsers/claude/parseList.js';
import { parseClaudeConversation } from '../src/l1/parsers/claude/parseConversation.js';

const c1 = '11111111-1111-4111-8111-111111111111';
const c2 = '22222222-2222-4222-8222-222222222222';
const root = '33333333-3333-4333-8333-333333333333';
const branch = '44444444-4444-4444-8444-444444444444';
const leaf = '55555555-5555-4555-8555-555555555555';
function message(uuid: string, parent: string | null, sender: string, text: string) {
    return { uuid, parent_message_uuid: parent, sender,
        content: [{ type: 'text', text }], created_at: '2026-10-01T00:00:00.000Z' };
}
function detail(messages: unknown[], current_leaf_message_uuid: string | null = leaf) {
    return { uuid: c1, name: 'Claude authored title', created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-02T00:00:00Z', chat_messages: messages,
        current_leaf_message_uuid };
}

test('Claude collection returns sorted Domain list facts with source timestamps', () => {
    const result = parseClaudeList([
        { uuid: c1, name: 'Older', updated_at: '2026-10-02T00:00:00Z' },
        { uuid: c2, name: 'Newer', updated_at: '2026-10-03T00:00:00Z' },
    ]);
    assert.deepEqual(result.conversations.map(c => c.id), [c2, c1]);
    assert.equal(result.keys[0].time, Date.parse('2026-10-03T00:00:00Z'));
    assert.equal(result.conversations[0].titleSource, 'provider');
    assert.equal('key' in result.conversations[0], false);
    assert.throws(() => parseClaudeList([{ uuid: c1, updated_at: '2026-10-02T00:00:00Z' },
        { uuid: c1, updated_at: '2026-10-02T00:00:00Z' }]), /duplicate/);
    assert.throws(() => parseClaudeList({ items: [] }), /Invalid Claude list/);
    assert.throws(() => parseClaudeList([{ uuid: c1 }]), /activity time/);
});

test('Claude detail follows the current leaf, excluding regenerated branches', () => {
    const messages = [message(root, null, 'human', 'Question'),
        message(branch, root, 'assistant', 'Abandoned answer'),
        message(leaf, root, 'assistant', 'Selected **answer**')];
    const clone = structuredClone(messages);
    const parsed = parseClaudeConversation(detail(messages), c1);
    assert.equal(parsed.conversationId, c1);
    assert.equal(parsed.conversation.index.title, 'Claude authored title');
    assert.equal(parsed.conversation.index.titleSource, 'provider');
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.equal(parsed.conversation.detail.messages.length, 2);
    assert.deepEqual(parsed.conversation.detail.messages.map(m => m.id), [root, leaf]);
    assert.equal(parsed.conversation.detail.savedAt, Date.parse('2026-10-02T00:00:00Z'));
    assert.equal('key' in parsed.conversation.detail, false);
    assert.deepEqual(messages, clone);
});

test('Claude missing parent and missing leaf never claim complete source coverage', () => {
    const broken = parseClaudeConversation(detail([message(leaf, root, 'assistant', 'Answer')]), c1);
    assert.equal(broken.conversation.detail.quality.status, 'partial');
    const unknown = parseClaudeConversation(detail([message(root, null, 'human', 'Question')], null), c1);
    assert.equal(unknown.conversation.detail.quality.status, 'unknown');
    assert.throws(() => parseClaudeConversation(detail([]), c2), /identity mismatch/);
    assert.throws(() => parseClaudeConversation({ uuid: c1 }, c1), /chat_messages/);
});

test('Claude preserves source Markdown, reasoning and text-bearing tool artifacts without claiming binary bytes', () => {
    const messages = [message(root, null, 'human', 'Hello'),
        { uuid: leaf, parent_message_uuid: root, sender: 'assistant',
            content: [{ type: 'thinking', thinking: 'Consider the task' },
                { type: 'text', text: 'Answer with \\(x^2\\)' },
                { type: 'tool_use', name: 'artifacts', input: { title: 'app.ts', language: 'typescript', content: 'export const n = 42;' } }],
            attachments: [{ file_name: 'notes.txt', extracted_content: 'document text' }] }];
    const parsed = parseClaudeConversation(detail(messages), c1);
    const assistant = parsed.conversation.detail.messages[1];
    assert.ok(assistant.reasoning?.length);
    assert.ok(assistant.content.some(b => b.type === 'code' && b.code.includes('const n')));
    assert.equal(parsed.conversation.detail.assets.length, 0);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    const partial = parseClaudeConversation(detail([message(root, null, 'human', 'Hi'), {
        ...message(leaf, root, 'assistant', 'Answer'),
        files: [{ name: 'unavailable.pdf' }],
    }]), c1);
    assert.equal(partial.conversation.detail.quality.status, 'partial');
});
