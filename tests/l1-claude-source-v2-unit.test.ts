import { describe as __suiteDescribe } from 'node:test';
import { claudeRequest } from "../src/l1/sniffer/claude/observation.js";
import { activeClaudeOrganization } from "../src/l1/sniffer/claude/observation.js";
import { claudeFileId } from "../src/l1/client/claude/fileAssets.js";
import { contentComposer } from "../src/l3b/compose/composeContent.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import test from "node:test";
import assert from "node:assert/strict";
import { parseClaudeList } from "../src/l1/parsers/claude/parseList.js";
import { parseClaudeConversation } from "../src/l1/parsers/claude/parseConversation.js";
import { decodeClaudeDetail } from "../src/l1/parsers/claude/decodeDetail.js";
import { parseNativeTool } from "../src/l1/parsers/claude/parseNativeTools.js";
import { parseToolUse } from "../src/l1/parsers/claude/parseTools.js";
import { readClaudeSource } from "../src/l1/client/claude/claudeSource.js";
import { organizationsGen as claudeOrganizationsGen } from "./fixtures/providers/claudeOrganizations.js";
import { listGen as claudeListGen } from "./fixtures/providers/claudeList.js";
import { detailGen as claudeDetailGen } from "./fixtures/providers/claudeDetail.js";
import { streamGen as claudeStreamGen } from "./fixtures/providers/claudeStream.js";
import { deleteGen as claudeDeleteGen } from "./fixtures/providers/claudeDelete.js";
import { organizationsGen } from "./fixtures/providers/claudeOrganizations.js";
import { observeClaudeAccount } from "../src/l1/client/claude/accountObservation.js";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { relative } from "node:path";
import { createClaudeVisitSave } from "../src/runtime/content/claudeVisitSave.js";
import { type GlobalSettings } from "../src/application/settings/index.js";

__suiteDescribe("l1-claude-source-v2-unit", () => {
test('Claude discovery injection omits absent optional arguments for Chrome serialization', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const calls: unknown[][] = [];
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        permissions: { contains: async () => true },
        tabs: { query: async () => [{ id: 1 }] },
        scripting: { executeScript: async (injection: { args: unknown[] }) => {
            assert.ok(injection.args.every(value => value !== undefined), 'Chrome rejects undefined arguments');
            calls.push(injection.args);
            return [{ result: { ok: true, value: injection.args[0] === '/api/organizations'
                ? claudeOrganizationsGen('CL_SOURCE_DISCOVERY_ORGANIZATIONS_01')
                : claudeListGen('CL_L1_SOURCE_PARSE_SORTED_01') } }];
        } },
    } });
    try {
        await readClaudeSource('/api/organizations');
        const organization = '11111111-1111-4111-8111-111111111111';
        await readClaudeSource(`/api/organizations/${organization}/chat_conversations`, organization);
        const paginated = `/api/organizations/${organization}/chat_conversations_v2?limit=100&offset=0&consistency=strong`;
        await readClaudeSource(paginated, organization);
        assert.deepEqual(calls, [['/api/organizations'],
            [`/api/organizations/${organization}/chat_conversations`, organization],
            [paginated, organization]]);
    } finally {
        if (original) Object.defineProperty(globalThis, 'chrome', original);
        else Reflect.deleteProperty(globalThis, 'chrome');
    }
});

test('Claude source rejects malformed UUIDs in paths and account binding before any tab access', async () => {
    const valid = '11111111-1111-4111-8111-111111111111';
    for (const malformed of ['-'.repeat(36), '111111111-111-4111-8111-111111111111']) {
        const paths = [
            `/api/organizations/${malformed}/chat_conversations`,
            `/api/organizations/${malformed}/chat_conversations_v2?limit=100&offset=0&consistency=strong`,
            `/api/organizations/${valid}/chat_conversations/${malformed}?tree=true&rendering_mode=messages&render_all_tools=true`,
        ];
        for (const path of paths) {
            await assert.rejects(readClaudeSource(path, valid), /Invalid Claude API request/, path);
        }
        await assert.rejects(readClaudeSource('/api/organizations', malformed), /Invalid Claude API request/);
    }
});

const c1 = '11111111-1111-4111-8111-111111111111';
const c2 = '22222222-2222-4222-8222-222222222222';
const root = '33333333-3333-4333-8333-333333333333';
const leaf = '55555555-5555-4555-8555-555555555555';

test('Claude collection returns sorted Domain list facts with source timestamps', () => {
    const result = parseClaudeList(claudeListGen('CL_L1_SOURCE_PARSE_SORTED_01').data);
    assert.deepEqual(result.conversations.map(c => c.id), [c2, c1]);
    assert.deepEqual(result.keys.map(key => key.id), [c1, c2]); // unsorted source order
    assert.equal(result.keys[0].time, Date.parse('2026-10-02T00:00:00Z'));
    assert.equal(result.conversations[0].titleSource, 'provider');
    assert.equal('key' in result.conversations[0], false);
    assert.throws(() => parseClaudeList(claudeListGen('CL_L1_SOURCE_PARSE_DUPLICATE_01').data), /duplicate/);
    assert.throws(() => parseClaudeList(claudeListGen('CL_L1_SOURCE_PARSE_INVALID_ITEMS_01').data), /Invalid Claude list/);
    assert.throws(() => parseClaudeList(claudeListGen('CL_L1_SOURCE_PARSE_MISSING_TIME_01').data), /activity time/);
});

test('Claude detail follows the current leaf, excluding regenerated branches', () => {
    const source = claudeDetailGen('CL_L1_SOURCE_SELECTED_BRANCH_01');
    const clone = structuredClone(source);
    const parsed = parseClaudeConversation(source, c1);
    assert.equal(parsed.conversationId, c1);
    assert.equal(parsed.conversation.index.title, 'Claude authored title');
    assert.equal(parsed.conversation.index.titleSource, 'provider');
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.equal(parsed.conversation.detail.messages.length, 2);
    assert.deepEqual(parsed.conversation.detail.messages.map(m => m.id), [root, leaf]);
    assert.equal(parsed.conversation.detail.savedAt, Date.parse('2026-10-02T00:00:00Z'));
    assert.equal('key' in parsed.conversation.detail, false);
    assert.deepEqual(source, clone);
});

test('Claude Detail ingress normalizes selected branch, content and files once', () => {
    const raw = claudeDetailGen('CL_L1_SOURCE_MARKDOWN_ARTIFACTS_01');
    const original = structuredClone(raw);
    const evidence = decodeClaudeDetail(raw, c1);
    assert.equal(evidence.currentLeafId, leaf);
    assert.equal(evidence.updatedAt, Date.parse('2026-10-02T00:00:00Z'));
    const model = evidence.messages.find(message => message.uuid === leaf);
    assert.ok(model);
    assert.equal(model.parentId, root);
    assert.deepEqual(model.content?.map(block => block.kind), ['thinking', 'text', 'tool_use']);
    assert.equal(model.attachments[0]?.name, 'notes.txt');
    assert.equal(model.attachments[0]?.extractedContent, 'document text');
    assert.equal('parent_message_uuid' in model, false);
    assert.equal('extracted_content' in (model.attachments[0] ?? {}), false);
    assert.deepEqual(raw, original, 'wire payload remains untouched');
});

test('Claude Detail ingress preserves malformed block diagnostics and invalid parents', () => {
    const raw = claudeDetailGen('CL_L1_SOURCE_SELECTED_BRANCH_01');
    if (!('chat_messages' in raw) || !Array.isArray(raw.chat_messages)) throw new Error('Missing fixture messages');
    raw.chat_messages = raw.chat_messages.map((value: unknown) => value && typeof value === 'object'
        && 'uuid' in value && value.uuid === leaf ? {
            ...value, content: [null, { type: 'text', text: 42 }, { type: 'thinking', thinking: 'still readable' }],
            files: [null, { name: 'missing.pdf' }],
        } : value);
    const parsed = parseClaudeConversation(raw, c1);
    assert.equal(parsed.conversation.detail.quality.status, 'partial');
    for (const code of ['claude.content.invalid', 'claude.content.unsupported',
        'claude.attachment.invalid', 'claude.attachment.unavailable']) {
        assert.ok(parsed.diagnostics.some(d => d.code === code), code);
    }
    const badParent = claudeDetailGen('CL_L1_SOURCE_SELECTED_BRANCH_01');
    if (!('chat_messages' in badParent) || !Array.isArray(badParent.chat_messages)) throw new Error('Missing fixture messages');
    badParent.chat_messages = badParent.chat_messages.map((value: unknown) => value && typeof value === 'object'
        && 'uuid' in value && value.uuid === leaf ? { ...value, parent_message_uuid: { invalid: true } } : value);
    const branch = parseClaudeConversation(badParent, c1);
    assert.equal(branch.conversation.detail.quality.status, 'partial');
    assert.ok(branch.diagnostics.some(d => d.code === 'claude.branch.partial'));
});

test('Claude missing parent and missing leaf never claim complete source coverage', () => {
    const broken = parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_MISSING_PARENT_01'), c1);
    assert.equal(broken.conversation.detail.quality.status, 'partial');
    const unknown = parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_MISSING_LEAF_01'), c1);
    assert.equal(unknown.conversation.detail.quality.status, 'unknown');
    assert.throws(() => parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_FOREIGN_CONVERSATION_01'), c2), /identity mismatch/);
    assert.throws(() => parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_MISSING_MESSAGES_01'), c1), /chat_messages/);
});

test('Claude preserves source Markdown, reasoning and text-bearing tool artifacts without claiming binary bytes', () => {
    const parsed = parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_MARKDOWN_ARTIFACTS_01'), c1);
    const assistant = parsed.conversation.detail.messages[1];
    assert.ok(assistant.reasoning?.length);
    assert.ok(assistant.content.some(b => b.type === 'code' && b.code.includes('const n')));
    assert.equal(parsed.conversation.detail.assets.length, 0);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    const partial = parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_MISSING_BINARY_FILE_01'), c1);
    assert.equal(partial.conversation.detail.quality.status, 'partial');
});

test('Claude sentinel root closes a real branch without hiding missing ancestors or cycles', () => {
    const parsed = parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_SENTINEL_ROOT_01'), c1);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.equal(parsed.diagnostics.length, 0);
    for (const key of ['CL_L1_SOURCE_UNRESOLVED_PARENT_01', 'CL_L1_SOURCE_CYCLIC_BRANCH_01'] as const) {
        const broken = parseClaudeConversation(claudeDetailGen(key), c1);
        assert.equal(broken.conversation.detail.quality.status, 'partial');
        assert.ok(broken.diagnostics.some(d => d.code === 'claude.branch.partial'));
    }
});

test('Claude native questionnaire, selected answers, sources and connectors survive physical renderers', async () => {
    const parsed = parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_QUESTIONNAIRE_FULL_01'), c1);
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
    const parsed = parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_MEMORY_WRITE_01'), c1);
    const serialized = JSON.stringify(parsed.conversation.detail.messages);
    assert.ok(!serialized.includes('internal profile body'));
    assert.ok(!serialized.includes('internal version token'));
    assert.ok(!serialized.includes('Artifact: mcp'));
    assert.ok(serialized.includes('const answer = 42;'));
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
});

test('Claude incomplete widgets, unsupported result blocks and missing binary content explain partial status', () => {
    for (const key of [
        'CL_L1_SOURCE_BAD_WIDGET_01',
        'CL_L1_SOURCE_BAD_WIDGET_02',
        'CL_L1_SOURCE_BAD_WIDGET_03',
        'CL_L1_SOURCE_BAD_WIDGET_04',
        'CL_L1_SOURCE_BAD_WIDGET_05',
    ] as const) {
        const parsed = parseClaudeConversation(claudeDetailGen(key), c1);
        assert.equal(parsed.conversation.detail.quality.status, 'partial');
        assert.ok(parsed.diagnostics.some(d => d.sourceRef?.providerMessageId === leaf));
    }
});

test('Claude modern Write → Artifact preserves exact source as escaped code and the published link', () => {
    const code = '<h1>Backup checklist</h1>\n<script>window.example = "inert source";</script>';
    const parsed = parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_WRITE_ARTIFACT_01'), c1);
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
    for (const key of ['CL_L1_SOURCE_MEMORY_READ_01', 'CL_L1_SOURCE_MEMORY_APPEND_01'] as const) {
        const parsed = parseClaudeConversation(claudeDetailGen(key), c1);
        assert.equal(parsed.conversation.detail.quality.status, 'complete');
        assert.ok(!JSON.stringify(parsed.conversation.detail).includes('private memory'));
    }
});

test('Claude never invents published Artifact bytes from missing files or unparsed edits', () => {
    for (const key of [
        'CL_L1_SOURCE_UNAVAILABLE_ARTIFACT_01', 'CL_L1_SOURCE_UNPARSED_ARTIFACT_EDIT_01',
    ] as const) {
        const parsed = parseClaudeConversation(claudeDetailGen(key), c1);
        assert.equal(parsed.conversation.detail.quality.status, 'partial');
        assert.ok(parsed.diagnostics.some(d => d.message.includes('artifact content is unavailable')));
        assert.ok(!JSON.stringify(parsed.conversation.detail).includes('old source must not be reused'));
    }
});

test('Claude generated Artifact file cards require unique captured path and matching UTF-8 bytes', () => {
    for (const [variant, key] of [
        ['matching', 'CL_L1_SOURCE_FILE_CARD_MATCHING_01'],
        ['wrong-size', 'CL_L1_SOURCE_FILE_CARD_WRONG_SIZE_01'],
        ['unrelated', 'CL_L1_SOURCE_FILE_CARD_UNRELATED_01'],
        ['uploaded', 'CL_L1_SOURCE_FILE_CARD_UPLOADED_01'],
        ['ambiguous', 'CL_L1_SOURCE_FILE_CARD_AMBIGUOUS_01'],
    ] as const) {
        const parsed = parseClaudeConversation(claudeDetailGen(key), c1);
        assert.equal(parsed.conversation.detail.quality.status, variant === 'matching' ? 'complete' : 'partial', variant);
        assert.equal(parsed.diagnostics.some(d => d.code === 'claude.attachment.unavailable'), variant !== 'matching', variant);
    }
});

test('Claude native widgets, execution output and Docs edits preserve authored source', () => {
    const parsed = parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_WIDGETS_COMPLETE_01'), c1);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    const output = JSON.stringify(parsed.conversation.detail.messages);
    for (const text of ['<svg>', 'Validate units', 'completed', 'python3 demo.py', '  f = 149.44', 'derivation.', 'Confirm the chosen units?']) assert.ok(output.includes(text), text);
    assert.ok(!output.includes('PRIVATE-FILE-ID'));
    assert.ok(!output.includes('INTERNAL FILE CARD INSTRUCTIONS'));
    assert.ok(!output.includes('PRIVATE SETUP'));
    assert.ok(!output.includes('Internal setup instructions'));
    assert.equal(parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_WIDGETS_UNSUPPORTED_ENGINE_01'), c1)
        .conversation.detail.quality.status, 'partial');
});

test('Claude delivers generated files by stable file identity, never inventing bytes from Write', () => {
    const parsed = parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_GENERATED_FILE_01'), c1);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.deepEqual(parsed.conversation.detail.assets, [{ id: 'claude-file:' + c2, kind: 'file',
        sourceUri: 'claude-file:' + c2, name: 'result.py', byteLength: 8 }]);
    assert.equal(parsed.conversation.detail.messages[0].content.at(-1)?.type, 'file');
    assert.deepEqual(parsed.acquisitionHints, {});
    const invalid = parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_GENERATED_FILE_INVALID_ID_01'), c1);
    assert.equal(invalid.conversation.detail.quality.status, 'partial');
    assert.deepEqual(invalid.conversation.detail.assets, []);
});


test('Claude Detail decodes only safe nonnegative file sizes before rendering', () => {
    for (const [size, expected] of [
        [-1, undefined], [1.5, undefined], [Number.MAX_SAFE_INTEGER + 1, undefined],
        [NaN, undefined], [Infinity, undefined], ['8', undefined], [null, undefined],
        [0, 0], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ] as const) {
        const raw = claudeDetailGen('CL_L1_SOURCE_GENERATED_FILE_01');
        if (!('chat_messages' in raw) || !Array.isArray(raw.chat_messages))
            throw new Error('Missing Claude conversation messages fixture');
        const sourceMessage: unknown = raw.chat_messages[0];
        if (!sourceMessage || typeof sourceMessage !== 'object' || !('files' in sourceMessage))
            throw new Error('Missing Claude file fixture');
        const entries: unknown = sourceMessage.files;
        if (!Array.isArray(entries)) throw new Error('Invalid Claude files fixture');
        const file: unknown = entries[0];
        if (!file || typeof file !== 'object' || Array.isArray(file))
            throw new Error('Invalid Claude file fixture');
        Object.assign(file, { size_bytes: size });

        const decoded = decodeClaudeDetail(raw, c1).messages[0]?.files[0];
        assert.ok(decoded);
        assert.equal(decoded.sizeBytes, expected, String(size));

        const parsed = parseClaudeConversation(raw, c1);
        const assetId = 'claude-file:' + c2;
        assert.deepEqual(parsed.conversation.detail.assets, [{ id: assetId, kind: 'file', name: 'result.py',
            sourceUri: assetId, ...(expected !== undefined ? { byteLength: expected } : {}) }], String(size));
        assert.equal(parsed.conversation.detail.messages[0]?.content.at(-1)?.type, 'file', String(size));
        assert.equal(parsed.conversation.detail.quality.status, 'complete', String(size));
    }
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
    for (const [reason, key] of [
        ['error', 'CL_L1_SOURCE_QUOTA_ERROR_01'],
        ['max_tokens', 'CL_L1_SOURCE_QUOTA_MAX_TOKENS_01'],
        ['tool_use', 'CL_L1_SOURCE_QUOTA_TOOL_USE_01'],
        ['user_canceled', 'CL_L1_SOURCE_QUOTA_USER_CANCELED_01'],
    ] as const) {
        const parsed = parseClaudeConversation(claudeDetailGen(key), c1);
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
        return new Response(status === 204
            ? claudeDeleteGen('CL_L1_SOURCE_HOOK_DELETE_204_01')
            : claudeStreamGen('CL_L1_SOURCE_HOOK_COMPLETION_01'), { status });
    }, postMessage: (event: typeof events[number]) => events.push(event) };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: host });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { get cookie() { return cookie; } } });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://claude.ai', href: 'https://claude.ai/new' } });
    const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
    try {
        // The browser entry auto-installs when loaded, after the mocked Window exists.
        const entry = require.resolve('../src/l1/sniffer/claude/hook.js');
        delete require.cache[entry];
        require(entry);
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
    const parsed = parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_DOCS_TEMPLATE_01'), c1);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    const output = JSON.stringify(parsed.conversation.detail.messages);
    assert.ok(output.includes('2026-10-22'));
    assert.ok(output.includes('Planned section: Explain uncertainty'));
    assert.ok(!output.includes('<?claude'));
});


test('Claude shell operations invalidate retained Artifact bytes and duplicate message IDs are rejected', () => {
    assert.equal(parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_SHELL_INVALIDATES_ARTIFACT_01'), c1)
        .conversation.detail.quality.status, 'partial');
    assert.throws(() => parseClaudeConversation(claudeDetailGen('CL_L1_SOURCE_DUPLICATE_MESSAGE_UUID_01'), c1), /Duplicate/);
});

test('Claude tool file paths stay narrow through delivery and Artifact publication', () => {
    const valid = parseNativeTool('senduserfile', { files: ['/home/claude/result.py'] }, () => []);
    assert.deepEqual(valid?.issues, []);
    assert.ok(JSON.stringify(valid?.blocks).includes('Delivered file: result.py'));
    const invalid = parseNativeTool('senduserfile', { files: ['/home/claude/result.py', 7] }, () => []);
    assert.deepEqual(invalid?.issues, ['Missing delivered file paths']);

    const state = { files: new Map([['/home/claude/result.py', 'print(1)']]), artifactPaths: new Set<string>() };
    const published = parseToolUse({ name: 'Artifact', input: { file_path: '/home/claude/result.py' } }, state);
    assert.deepEqual(published.issues, []);
    assert.ok(published.blocks.some(block => block.type === 'code' && block.code === 'print(1)'));
    const denied = parseToolUse({ name: 'Artifact', input: { file_path: '/home/claude/result.py', edits: [] } }, state);
    assert.deepEqual(denied.issues, ['Published artifact content is unavailable or uses unsupported edits']);
    assert.equal(state.files.has('/home/claude/result.py'), false);
});

test('Claude tab execution caches organization verification per Cookie snapshot and invalidates immediately on Cookie switch', async () => {
    const savedChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const savedDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const savedFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    Reflect.deleteProperty(globalThis, '__gemExporterClaudeOrgsCache');
    Reflect.deleteProperty(globalThis, '__gemExporterClaudeOrgsInflight');
    let cookie = 'sessionKey=abc; lastActiveOrg=' + c1;
    let orgCalls = 0;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { get cookie() { return cookie; } } });
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async (input: string) => {
            if (input === '/api/organizations') {
                orgCalls++;
                return Response.json(claudeOrganizationsGen('CL_ACCOUNT_MIXED_ROWS_01'));
            }
            return Response.json(claudeListGen('CL_L1_SOURCE_PARSE_SORTED_01'));
        },
    });
    Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        value: {
            permissions: { contains: async () => true },
            tabs: { query: async () => [{ id: 1, active: true, url: 'https://claude.ai/chats' }], get: async () => ({ id: 1, url: 'https://claude.ai/chats' }) },
            scripting: {
                executeScript: async (injection: { func: (...args: unknown[]) => Promise<unknown>; args: unknown[] }) => [{
                    result: await injection.func(...injection.args),
                }],
            },
        },
    });
    try {
        const listPath = `/api/organizations/${c1}/chat_conversations`;
        await readClaudeSource(listPath, c1);
        await readClaudeSource(listPath, c1);
        await readClaudeSource(listPath, c1);
        assert.equal(orgCalls, 1, 'unchanged Cookie snapshot must reuse verified organization membership');

        cookie = 'sessionKey=switched; lastActiveOrg=' + c2;
        await assert.rejects(readClaudeSource(listPath, c1), /differs from selected account/);
    } finally {
        Reflect.deleteProperty(globalThis, '__gemExporterClaudeOrgsCache');
        Reflect.deleteProperty(globalThis, '__gemExporterClaudeOrgsInflight');
        if (savedChrome) Object.defineProperty(globalThis, 'chrome', savedChrome); else Reflect.deleteProperty(globalThis, 'chrome');
        if (savedDoc) Object.defineProperty(globalThis, 'document', savedDoc); else Reflect.deleteProperty(globalThis, 'document');
        if (savedFetch) Object.defineProperty(globalThis, 'fetch', savedFetch); else Reflect.deleteProperty(globalThis, 'fetch');
    }
});
});

__suiteDescribe("claude-account-observation", () => {
test('Claude account observation validates organization JSON before caching typed data', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const foreign = '22222222-2222-4222-8222-222222222222';
    const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const savedFetch = globalThis.fetch;
    const savedNow = Date.now;
    let now = 1_700_000_000_000;
    let cookie = `lastActiveOrg=${id}`;
    let payload: unknown = organizationsGen('CL_ACCOUNT_MIXED_ROWS_01');
    let status = 200, calls = 0;
    try {
        Object.defineProperty(globalThis, 'document', { configurable: true, value: { get cookie() { return cookie; } } });
        Date.now = () => now;
        globalThis.fetch = async (url, init) => {
            assert.equal(url, '/api/organizations');
            assert.equal(init?.credentials, 'include');
            calls++;
            return new Response(JSON.stringify(payload), { status });
        };
        assert.deepEqual(await observeClaudeAccount(), {
            providerId: 'claude', providerAccountId: id, displayName: 'Team A',
        });
        payload = organizationsGen('CL_ACCOUNT_CACHED_CHANGE_01');
        assert.equal((await observeClaudeAccount())?.displayName, 'Team A');
        assert.equal(calls, 1, 'verified data is cached');

        cookie = `lastActiveOrg=${foreign}`;
        assert.equal(await observeClaudeAccount(), null, 'new cookie cannot reuse old account');
        cookie = `lastActiveOrg=${id}`;

        now += 30_001;
        payload = organizationsGen('CL_ACCOUNT_NUMBER_NAME_01');
        assert.deepEqual(await observeClaudeAccount(), { providerId: 'claude', providerAccountId: id });
        now += 30_001;
        payload = organizationsGen('CL_ACCOUNT_BLANK_NAME_01');
        assert.deepEqual(await observeClaudeAccount(), { providerId: 'claude', providerAccountId: id });

        now += 30_001;
        payload = organizationsGen('CL_ACCOUNT_INVALID_ENVELOPE_01');
        assert.equal(await observeClaudeAccount(), null, 'invalid responses do not create accounts');
        now += 30_001;
        payload = organizationsGen('CL_ACCOUNT_HTTP_FAILURE_01');
        status = 403;
        assert.equal(await observeClaudeAccount(), null, 'HTTP failure clears cached organizations');
        assert.equal(calls, 5);
    } finally {
        Date.now = savedNow;
        globalThis.fetch = savedFetch;
        if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument);
        else Reflect.deleteProperty(globalThis, 'document');
    }
});
});

__suiteDescribe("claude_rpc_fixture_closure", () => {
/** Fixed Claude source responses belong to endpoint-specific Gen(key) fixtures.
 * Parser assertions, transport statuses and request routing stay in their tests.
 */
const root = join(__dirname);

function testSources(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'live' || entry.name === 'node_modules') continue;
            files.push(...testSources(file));
        } else if (entry.isFile() && file.endsWith('.ts')) {
            files.push(file);
        }
    }
    return files;
}

test('Claude native response mocks use fixed endpoint Gen(key) samples', () => {
    const violations: string[] = [];
    const inlineMocks = [
        /\bpayload\s*(?::\s*unknown\s*)?=\s*(?:\[\s*(?:null|\{)|\{\s*error\s*:)/g,
        /parseClaudeList\(\s*(?:\[|\{\s*items\s*:)/g,
        /parseClaudeConversation\(\s*(?:detail\s*\(|\{\s*uuid\s*:)/g,
        /new\s+Response\(\s*(?:['"]data:|status\s*===\s*204\s*\?\s*null)/g,
        /return\s+\[\{\s*result\s*:\s*\[\s*\]\s*\}\]/g,
        /apiGet\s*:\s*async\s*[^=]{0,100}=>\s*(?:\{\s*return\s+)?\{\s*data\s*:/g,
    ];
    for (const file of testSources(root)) {
        const path = relative(root, file).replaceAll('\\', '/');
        if (path.startsWith('fixtures/providers/') || path === 'claude_rpc_fixture_closure.test.ts') continue;
        const source = readFileSync(file, 'utf8');
        if (!/\b(?:ClaudeProvider|parseClaudeConversation|parseClaudeList|installClaudeHook|readClaudeSource|observeClaudeAccount)\b/.test(source)) continue;
        for (const pattern of inlineMocks) {
            for (const match of source.matchAll(pattern)) {
                const line = source.slice(0, match.index).split('\n').length;
                violations.push(path + ':' + line + ' creates a native Claude response outside Gen(key)');
            }
        }
    }
    assert.deepEqual(violations, []);
});
});

__suiteDescribe("claude_visit_save", () => {
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const enabled: GlobalSettings = { enabledDisk: true, exportDelivery: 'folderWriter', defaultFormat: 'markdown',
    skipExported: true, includeAssets: true, developerMode: false };

test('Claude SSR visit save requires effective opt-in and coalesces repeated initialization', async () => {
    let settings = { ...enabled, enabledDisk: false };
    let identities = 0, saves = 0;
    const controller = createClaudeVisitSave({ path: () => '/chat/' + first,
        settings: async () => settings, account: async () => { identities++; return { id: 'account' }; },
        save: async (key, refresh) => { saves++; assert.equal(key.conversationId, first); assert.equal(refresh, true); } });
    await controller.save();
    assert.equal(identities, 0, 'disabled Live Save does not even acquire source identity');
    settings = { ...enabled, exportDelivery: 'browserDownload' };
    await controller.save();
    assert.equal(identities, 0, 'browser download is not effective Live Save');
    settings = enabled;
    await Promise.all([controller.save(), controller.save(), controller.save()]);
    assert.equal(identities, 1);
    assert.equal(saves, 1);
    await controller.save();
    assert.equal(saves, 1, 'no source polling or retries during one visit');
});

test('Claude native detail capture suppresses redundant SSR acquisition', async () => {
    let saves = 0;
    const controller = createClaudeVisitSave({ path: () => '/chat/' + first, settings: async () => enabled,
        account: async () => ({ id: 'account' }), save: async () => { saves++; } });
    controller.nativeDetail(first);
    await controller.save();
    assert.equal(saves, 0);
});

test('Claude navigation cancels delayed old identity and only saves the current visit', async () => {
    let path = '/chat/' + first;
    let resolve!: (value: { id: string }) => void;
    const identity = new Promise<{ id: string }>(r => { resolve = r; });
    const saved: string[] = [];
    const controller = createClaudeVisitSave({ path: () => path, settings: async () => enabled,
        account: () => identity, save: async key => { saved.push(key.conversationId); } });
    const old = controller.save();
    await Promise.resolve();
    path = '/chat/' + second;
    controller.observe(path);
    resolve({ id: 'account' });
    await old;
    assert.deepEqual(saved, []);
    await controller.save();
    assert.deepEqual(saved, [second]);
});

test('Claude failed visit acquisition is not retried and non-conversation routes never save', async () => {
    let path = '/chat/' + first, attempts = 0;
    const controller = createClaudeVisitSave({ path: () => path, settings: async () => enabled,
        account: async () => ({ id: 'account' }), save: async () => { attempts++; throw new Error('HTTP 429'); } });
    await assert.rejects(controller.save(), /HTTP 429/);
    await controller.save();
    assert.equal(attempts, 1);
    path = '/new'; controller.observe(path);
    await controller.save();
    assert.equal(attempts, 1);
});

test('Claude disabling Live Save while identity resolves prevents acquisition', async () => {
    let settings = enabled, saved = false;
    const controller = createClaudeVisitSave({ path: () => '/chat/' + first, settings: async () => settings,
        account: async () => { settings = { ...enabled, enabledDisk: false }; return { id: 'account' }; },
        save: async () => { saved = true; } });
    await controller.save();
    assert.equal(saved, false);
});
});
