import { installClaudeHook } from '../src/l1/sniffer/claude/hook.js';
import { claudeRequest, activeClaudeOrganization } from '../src/l1/sniffer/claude/observation.js';
import { claudeFileId } from '../src/l1/client/claude/fileAssets.js';
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

test('Claude modern Write → Artifact preserves exact source as escaped code and the published link', () => {
    const code = '<h1>Backup checklist</h1>\n<script>window.example = "inert source";</script>';
    const parsed = parseClaudeConversation(detail([message(root, null, 'human', 'Create a checklist'),
        { ...message(leaf, root, 'assistant', ''), content: [
            { type: 'tool_use', name: 'Skill', input: { skill: 'artifact-design' } },
            { type: 'tool_result', name: 'Skill', content: [{ type: 'text', text: 'internal skill setup' }] },
            { type: 'tool_use', name: 'Write', input: { file_path: '/home/claude/checklist.html', content: code } },
            { type: 'tool_result', name: 'Write', content: [{ type: 'text', text: 'File created successfully' }] },
            { type: 'tool_use', name: 'Artifact', input: { file_path: '/home/claude/checklist.html', description: 'Four backup steps' } },
            { type: 'tool_result', name: 'Artifact', content: [{ type: 'text', text: 'Published at https://claude.ai/artifact/example-123 (Version 1). Internal publication instructions.' }] },
        ] }]), c1);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    const sourceCode = parsed.conversation.detail.messages[1].content.filter(b => b.type === 'code');
    assert.deepEqual(sourceCode.map(b => b.code), [code]);
    const compose = contentComposer(new Map(), id => ({ id, label: id }));
    const doc = { title: 'Artifact', metadata: { id: c1, provider: 'claude' },
        messages: parsed.conversation.detail.messages.map(m => ({ role: m.role, blocks: compose(m.content) })) };
    const md = renderDocumentMarkdown(doc, {}), html = renderDocumentHtml(doc, {}).html;
    assert.ok(md.includes(code));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('<script>window.example'));
    for (const result of [md, html]) {
        assert.ok(result.includes('Artifact: checklist.html'));
        assert.ok(result.includes('https://claude.ai/artifact/example-123'));
        assert.ok(result.includes('Four backup steps'));
        assert.ok(!result.includes('internal skill setup'));
        assert.ok(!result.includes('Internal publication instructions'));
    }
});

test('Claude memory read and append do not leak stored profile bodies or internal versions', () => {
    for (const operation of ['read', 'append']) {
        const parsed = parseClaudeConversation(detail([message(root, null, 'human', 'Q'),
            { ...message(leaf, root, 'assistant', 'A'), content: [
                { type: 'tool_use', name: 'mcp__memory__memory_' + operation, input: { content: 'private memory input' } },
                { type: 'tool_result', name: 'memory_' + operation, content: [{ type: 'text', text: 'private memory body and version token' }] },
            ] }]), c1);
        assert.equal(parsed.conversation.detail.quality.status, 'complete');
        assert.ok(!JSON.stringify(parsed.conversation.detail).includes('private memory'));
    }
});

test('Claude never invents published Artifact bytes from missing files or unparsed edits', () => {
    for (const middle of [[], [{ type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/app.html', old_string: 'before', new_string: 'after' } }]]) {
        const content = middle.length ? [
            { type: 'tool_use', name: 'Write', input: { file_path: '/tmp/app.html', content: 'old source must not be reused' } },
            ...middle,
        ] : [];
        const parsed = parseClaudeConversation(detail([message(root, null, 'human', 'Q'),
            { ...message(leaf, root, 'assistant', ''), content: [...content,
                { type: 'tool_use', name: 'Artifact', input: { file_path: '/tmp/app.html' } }] }]), c1);
        assert.equal(parsed.conversation.detail.quality.status, 'partial');
        assert.ok(parsed.diagnostics.some(d => d.message.includes('artifact content is unavailable')));
        assert.ok(!JSON.stringify(parsed.conversation.detail).includes('old source must not be reused'));
    }
});

test('Claude generated Artifact file cards require unique captured path and matching UTF-8 bytes', () => {
    const code = '<h1>中文清单</h1>', path = '/home/claude/checklist.html';
    const file = { success: true, file_kind: 'blob', download_source: 'files-api', file_name: 'checklist.html',
        size_bytes: new TextEncoder().encode(code).byteLength };
    const publish = { type: 'tool_use', name: 'Artifact', input: { file_path: path } };
    const write = { type: 'tool_use', name: 'Write', input: { file_path: path, content: code } };
    for (const variant of ['matching', 'wrong-size', 'unrelated', 'uploaded', 'ambiguous'] as const) {
        const metadata = variant === 'wrong-size' ? { ...file, size_bytes: code.length }
            : variant === 'unrelated' ? { ...file, file_name: 'other.html' } : file;
        const assistant = { ...message(leaf, root, 'assistant', ''), content: [write, publish,
            ...(variant === 'ambiguous' ? [{ ...publish, input: { file_path: '/tmp/checklist.html' } }] : [])],
            ...(variant === 'uploaded' ? { attachments: [metadata] } : { files: [metadata] }) };
        const parsed = parseClaudeConversation(detail([message(root, null, 'human', 'Q'), assistant]), c1);
        assert.equal(parsed.conversation.detail.quality.status, variant === 'matching' ? 'complete' : 'partial', variant);
        assert.equal(parsed.diagnostics.some(d => d.code === 'claude.attachment.unavailable'), variant !== 'matching', variant);
    }
});

test('Claude native widgets, execution output and Docs edits preserve authored source', () => {
    const blocks = [
        { type: 'tool_use', name: 'visualize:read_me', input: { modules: ['diagram'] } },
        { type: 'tool_result', name: 'visualize:read_me', content: [{ type: 'text', text: 'PRIVATE SETUP' }] },
        { type: 'tool_use', name: 'visualize:show_widget', input: { title: 'Cutaway', widget_code: '<svg><title>Resonator</title></svg>' } },
        { type: 'tool_use', name: 'TaskCreate', input: { subject: 'Compute', description: 'Validate units' } },
        { type: 'tool_use', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'python3 demo.py' } },
        { type: 'tool_result', name: 'Bash', content: [{ type: 'text', text: '  f = 149.44\n' }] },
        { type: 'tool_use', name: 'mcp__Claude_Docs__update', input: { engine: 'prose', payload: { ops: [
            { op: 'replace', with: { as: 'markdown', from: { kind: 'inline', content: '## Derivation\n\n**Full** derivation.' } } },
        ] } } },
        { type: 'tool_result', name: 'mcp__Claude_Docs__update', content: [{ type: 'text', text: '{"verdict":"allow","xml":"<doc>…</doc>"}\nInternal setup instructions.' }] },
        { type: 'tool_use', name: 'mcp__Claude_Docs__create', input: { object: 'utterance', payload: { value: { body: 'Confirm the chosen units?' } } } },
        { type: 'tool_use', name: 'Artifact', input: { action: 'open', url: 'https://claude.ai/artifact/example' } },
        { type: 'tool_use', name: 'SendUserFile', input: { files: ['/home/claude/result.py'], caption: 'Runnable result' } },
        { type: 'tool_result', name: 'SendUserFile', content: [{ type: 'text', text: 'file_uuid: PRIVATE-FILE-ID. INTERNAL FILE CARD INSTRUCTIONS' }] },
    ];
    const parsed = parseClaudeConversation(detail([{ ...message(leaf, null, 'assistant', ''), content: blocks }]), c1);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    const output = JSON.stringify(parsed.conversation.detail.messages);
    for (const text of ['<svg>', 'Validate units', 'completed', 'python3 demo.py', '  f = 149.44', 'derivation.', 'Confirm the chosen units?']) assert.ok(output.includes(text), text);
    assert.ok(!output.includes('PRIVATE-FILE-ID'));
    assert.ok(!output.includes('INTERNAL FILE CARD INSTRUCTIONS'));
    assert.ok(!output.includes('PRIVATE SETUP'));
    assert.ok(!output.includes('Internal setup instructions'));
    const bad: Record<string, unknown>[] = structuredClone(blocks);
    bad.push({ type: 'tool_use', name: 'mcp__Claude_Docs__update', input: { engine: 'unsupported' } });
    assert.equal(parseClaudeConversation(detail([{ ...message(leaf, null, 'assistant', ''), content: bad }]), c1).conversation.detail.quality.status, 'partial');
});

test('Claude delivers generated files by stable file identity, never inventing bytes from Write', () => {
    const file = { success: true, file_kind: 'blob', download_source: 'files-api', file_uuid: c2,
        file_name: 'result.py', size_bytes: 8 };
    const parsed = parseClaudeConversation(detail([{ ...message(leaf, null, 'assistant', 'Done'), files: [file] }]), c1);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.deepEqual(parsed.conversation.detail.assets, [{ id: 'claude-file:' + c2, kind: 'file',
        sourceUri: 'claude-file:' + c2, name: 'result.py', byteLength: 8 }]);
    assert.equal(parsed.conversation.detail.messages[0].content.at(-1)?.type, 'file');
    assert.deepEqual(parsed.acquisitionHints, {});
    const invalid = parseClaudeConversation(detail([{ ...message(leaf, null, 'assistant', 'Done'),
        files: [{ ...file, file_uuid: 'https://evil.example/file' }] }]), c1);
    assert.equal(invalid.conversation.detail.quality.status, 'partial');
    assert.deepEqual(invalid.conversation.detail.assets, []);
});


test('Claude passive request routing binds exact origin, organization and native endpoint', () => {
    const base = `https://claude.ai/api/organizations/${c1}/chat_conversations`;
    for (const endpoint of ['completion', 'completion2', 'retry_completion', 'retry_completion2'])
        assert.equal(claudeRequest(`${base}/${c2}/${endpoint}`, 'POST')?.kind, 'stream');
    assert.equal(claudeRequest(`${base}/${c2}`, 'DELETE')?.conversationId, c2);
    assert.equal(claudeRequest(`${base}_v2?offset=0`, 'GET')?.kind, 'list');
    for (const url of [`${base}/${c2}/unknown`, base.replace('claude.ai', 'evil.example'), `${base}/not-a-uuid`])
        assert.equal(claudeRequest(url, 'GET'), null);
    assert.equal(activeClaudeOrganization(`other=x; lastActiveOrg=${c1}`), c1);
    assert.equal(activeClaudeOrganization('lastActiveOrg=%XX'), null);
    assert.equal(claudeFileId('claude-file:' + c2), c2);
    assert.equal(claudeFileId('https://evil.example/file'), null);
});


test('Claude preserves quota-interrupted output but never labels it complete', () => {
    for (const reason of ['error', 'max_tokens', 'tool_use', 'user_canceled']) {
        const parsed = parseClaudeConversation(detail([{ ...message(leaf, null, 'assistant', 'Partial code explanation'), stop_reason: reason }]), c1);
        assert.equal(parsed.conversation.detail.quality.status, 'partial', reason);
        assert.ok(JSON.stringify(parsed.conversation.detail.messages).includes('Partial code explanation'));
    }
});


test('Claude passive hook uses only native traffic and suppresses cross-organization or failed responses', async () => {
    const saved = new Map(['window', 'document', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    let cookie = 'lastActiveOrg=' + c1, status = 200, calls = 0;
    const events: { payload: { kind: string; conversationId?: string } }[] = [];
    const host = { fetch: async (_input: unknown, _init?: unknown): Promise<Response> => {
        calls++;
        return new Response(status === 204 ? null : 'data: {"type":"message_stop"}\n\n', { status });
    }, postMessage: (event: typeof events[number]) => events.push(event) };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: host });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { get cookie() { return cookie; } } });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://claude.ai', href: 'https://claude.ai/new' } });
    const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
    try {
        installClaudeHook();
        const base = `https://claude.ai/api/organizations/${c1}/chat_conversations/${c2}`;
        await host.fetch(base + '/completion2', { method: 'POST' });
        await flush();
        assert.equal(events[0]?.payload.kind, 'stream');
        assert.equal(events[0]?.payload.conversationId, c2);
        status = 204;
        await host.fetch(base, { method: 'DELETE' });
        await flush();
        assert.equal(events[1]?.payload.kind, 'delete');
        status = 403;
        await host.fetch(base, { method: 'DELETE' });
        cookie = 'lastActiveOrg=' + c2;
        await host.fetch(base, { method: 'GET' });
        await flush();
        assert.equal(events.length, 2);
        assert.equal(calls, 4, 'capture must never issue extra identity or source API requests');
    } finally {
        for (const [key, descriptor] of saved) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});


test('Claude Docs template references render in document order without internal markers', () => {
    const batch = { type: 'tool_use', name: 'mcp__Claude_Docs__batch', input: { batch: [], container: { create: { doc: {
        markdown: '# Report\n\n<?claude block date?>\n\n<?claude block section?>',
        blocks: { date: { type: 'date', value: '2026-10-22' }, section: { type: 'pending', intent: 'Explain uncertainty' } },
    } } } } };
    const parsed = parseClaudeConversation(detail([{ ...message(leaf, null, 'assistant', ''), content: [batch] }]), c1);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    const output = JSON.stringify(parsed.conversation.detail.messages);
    assert.ok(output.includes('2026-10-22'));
    assert.ok(output.includes('Planned section: Explain uncertainty'));
    assert.ok(!output.includes('<?claude'));
});


test('Claude shell operations invalidate retained Artifact bytes and duplicate message IDs are rejected', () => {
    const content = [
        { type: 'tool_use', name: 'Write', input: { file_path: '/home/claude/test.txt', content: 'old' } },
        { type: 'tool_use', name: 'Bash', input: { command: "printf new > /home/claude/test.txt" } },
        { type: 'tool_use', name: 'Artifact', input: { file_path: '/home/claude/test.txt' } },
    ];
    assert.equal(parseClaudeConversation(detail([{ ...message(leaf, null, 'assistant', ''), content }]), c1).conversation.detail.quality.status, 'partial');
    assert.throws(() => parseClaudeConversation(detail([message(leaf, null, 'assistant', 'One'), message(leaf, null, 'assistant', 'Two')]), c1), /Duplicate/);
});
