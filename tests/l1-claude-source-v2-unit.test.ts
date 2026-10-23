import { contentComposer } from '../src/l3b/compose/composeContent.js';
import { renderDocumentMarkdown } from '../src/l4/format/markdown/renderMarkdown.js';
import { renderDocumentHtml } from '../src/l4/format/html/renderHtml.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeList } from '../src/l1/parsers/claude/parseList.js';
import { parseClaudeConversation } from '../src/l1/parsers/claude/parseConversation.js';
import { readClaudeSource } from '../src/l1/client/claude/claudeSource.js';

test('Claude discovery injection omits absent optional arguments for Chrome serialization', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const calls: unknown[][] = [];
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        permissions: { contains: async () => true },
        tabs: { query: async () => [{ id: 1 }] },
        scripting: { executeScript: async (injection: { args: unknown[] }) => {
            assert.ok(injection.args.every(value => value !== undefined), 'Chrome rejects undefined arguments');
            calls.push(injection.args);
            return [{ result: [] }];
        } },
    } });
    try {
        await readClaudeSource('/api/organizations');
        const organization = '11111111-1111-4111-8111-111111111111';
        await readClaudeSource(`/api/organizations/${organization}/chat_conversations`, organization);
        assert.deepEqual(calls, [['/api/organizations'],
            [`/api/organizations/${organization}/chat_conversations`, organization]]);
    } finally {
        if (original) Object.defineProperty(globalThis, 'chrome', original);
        else Reflect.deleteProperty(globalThis, 'chrome');
    }
});

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

test('Claude sentinel root closes a real branch without hiding missing ancestors or cycles', () => {
    const sentinel = '00000000-0000-4000-8000-000000000000';
    const parsed = parseClaudeConversation(detail([message(root, sentinel, 'human', 'Q'),
        message(leaf, root, 'assistant', 'A')]), c1);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.equal(parsed.diagnostics.length, 0);
    for (const messages of [[message(leaf, branch, 'assistant', 'Missing')],
        [message(root, leaf, 'human', 'Q'), message(leaf, root, 'assistant', 'Cycle')]]) {
        const broken = parseClaudeConversation(detail(messages), c1);
        assert.equal(broken.conversation.detail.quality.status, 'partial');
        assert.ok(broken.diagnostics.some(d => d.code === 'claude.branch.partial'));
    }
});

test('Claude native questionnaire, selected answers, sources and connectors survive physical renderers', async () => {
    const blocks = [
        { type: 'tool_use', id: 'question', name: 'AskUserQuestion', input: { questions: [
            { header: 'Work', question: 'Which role?', multiSelect: false,
                options: [{ label: 'Engineer', description: 'Build software' }, { label: 'Researcher', description: 'Study systems' }] },
            { header: 'Tools', question: 'Which tools?', multiSelect: true,
                options: [{ label: 'Editor', description: 'Write code' }, { label: 'Calendar', description: 'Plan time' }] },
        ] } },
        { type: 'tool_result', tool_use_id: 'question', name: 'AskUserQuestion',
            content: [{ type: 'text', text: 'Selected: Engineer, Editor, Calendar' }] },
        { type: 'tool_use', id: 'search', name: 'web_search', input: { query: 'Export documentation' } },
        { type: 'tool_result', tool_use_id: 'search', name: 'web_search', content: [
            { type: 'knowledge', title: 'Source article', url: 'https://example.com/article', is_missing: false },
        ] },
        { type: 'tool_use', id: 'connector', name: 'SuggestConnectors', input: { uuids: ['internal-id'] } },
        { type: 'tool_result', tool_use_id: 'connector', name: 'suggest_connectors', content: [{ type: 'text',
            text: JSON.stringify([{ name: 'Example connector', description: 'Read calendar entries', url: 'https://example.com/connect' }]) }] },
    ];
    const parsed = parseClaudeConversation(detail([message(root, null, 'human', 'Help'),
        { ...message(leaf, root, 'assistant', ''), content: blocks }]), c1);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    const compose = contentComposer(new Map(), id => ({ id, label: id }));
    const doc = { title: 'Widgets', metadata: { id: c1, provider: 'claude' }, messages: parsed.conversation.detail.messages.map(m =>
        ({ role: m.role, blocks: compose(m.content) })) };
    const md = renderDocumentMarkdown(doc, {}), html = renderDocumentHtml(doc, {}).html;
    for (const expected of ['Which role?', 'Which tools?', 'Engineer', 'Researcher', 'Build software',
        'Study systems', 'Editor', 'Calendar', 'Write code', 'Plan time', 'Multiple selections allowed',
        'Selected: Engineer, Editor, Calendar', 'Source article', 'https://example.com/article',
        'Example connector', 'Read calendar entries', 'https://example.com/connect']) {
        assert.ok(md.includes(expected), `Markdown missing ${expected}`);
        assert.ok(html.includes(expected), `HTML missing ${expected}`);
    }
    assert.ok(!md.includes('internal-id'));
});

test('Claude memory operations never become Artifacts; real artifacts still preserve code', () => {
    const parsed = parseClaudeConversation(detail([message(root, null, 'human', 'Hello'),
        { ...message(leaf, root, 'assistant', ''), content: [
            { type: 'tool_use', name: 'mcp__memory__memory_write', input: { path: '/profile.md', content: 'internal profile body' } },
            { type: 'tool_result', name: 'memory_write', content: [{ type: 'text', text: 'internal version token' }],
                structured_content: { parsed: { body: 'internal profile body' } } },
            { type: 'tool_use', name: 'artifacts', input: { title: 'App', content: 'const answer = 42;', language: 'javascript' } },
        ] }]), c1);
    const serialized = JSON.stringify(parsed.conversation.detail.messages);
    assert.ok(!serialized.includes('internal profile body'));
    assert.ok(!serialized.includes('internal version token'));
    assert.ok(!serialized.includes('Artifact: mcp'));
    assert.ok(serialized.includes('const answer = 42;'));
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
});

test('Claude incomplete widgets, unsupported result blocks and missing binary content explain partial status', () => {
    for (const bad of [
        { type: 'tool_use', name: 'AskUserQuestion', input: { questions: [{ question: 'Which?', options: [{}] }] } },
        { type: 'tool_use', name: 'future_widget', input: {} },
        { type: 'tool_result', name: 'future_widget', content: [{ type: 'image', data: 'unavailable' }] },
        { type: 'tool_result', name: 'web_search', content: [{ type: 'knowledge', title: 'Missing', is_missing: true }] },
        { type: 'tool_result', name: 'suggest_connectors', content: [{ type: 'text', text: '{broken' }] },
    ]) {
        const parsed = parseClaudeConversation(detail([message(root, null, 'human', 'Q'),
            { ...message(leaf, root, 'assistant', ''), content: [bad] }]), c1);
        assert.equal(parsed.conversation.detail.quality.status, 'partial');
        assert.ok(parsed.diagnostics.some(d => d.sourceRef?.providerMessageId === leaf));
    }
});
