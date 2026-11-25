import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import assert from "node:assert/strict";
import { chatGPTRequest } from "../src/l1/sniffer/chatgpt/observation.js";
import { confirmedChatGPTDeletion } from "../src/l1/sniffer/chatgpt/observation.js";
import { chatGPTStreamEvent } from "../src/l1/sniffer/chatgpt/observation.js";
import { streamGen } from "./fixtures/providers/chatgptStream.js";
import { listGen as chatgptListGen } from "./fixtures/providers/chatgpt.js";
import { sessionGen as chatgptSessionGen } from "./fixtures/providers/chatgptSession.js";
import { detailGen as chatgptDetailGen } from "./fixtures/providers/chatgptDetail.js";
import { deleteGen as chatgptDeleteGen } from "./fixtures/providers/chatgptDelete.js";
import { chatGPTSidebarPage } from "../src/l1/sniffer/chatgpt/sidebar.js";
import { indexStorage } from "./helpers/indexStorage.js";
import { discoverChatGPTAccounts } from "../src/runtime/capabilities/chatgptDiscovery.js";
import { ProviderRegistry } from "../src/l1/client/providerRegistry.js";
import { scanAll } from "../src/application/sync/scanController.js";
import { listAccounts } from "../src/l3a/storageService.js";
import { listIndexes } from "../src/l3a/storageService.js";
import { resolveCurrentAccount } from "../src/runtime/content/accountContext.js";
import { getAccountContext } from "../src/runtime/content/accountContext.js";
import { invalidateAccountContext } from "../src/runtime/content/accountContext.js";
import { configureAccountAdapter } from "../src/runtime/content/accountContext.js";
import { createChatGPTAccountAdapter } from "../src/runtime/content/adapters/chatgptAccountAdapter.js";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { relative } from "node:path";
import { type ChatGPTConversationNode } from "../src/l1/parsers/chatgpt/chatgptTypes.js";
import { chatGPTInteractiveSnapshot as snapshot } from "../src/l1/parsers/chatgpt/interactiveSnapshot.js";
import { expression } from "../src/l1/parsers/chatgpt/dil/expression.js";
import { parseMarkdownAst } from "../src/l1/parsers/shared/markdown/parseMarkdown.js";
import { preprocessChatGPTMarkdown } from "../src/l1/parsers/chatgpt/markdownCompatibility.js";
import { parseChatGPTConversation } from "../src/l1/parsers/chatgpt/parseConversation.js";
import { type BlockNode } from "../src/l2/content/blocks.js";
import { type RootContent } from "mdast";
import { platformOrigins } from "../src/shared/platformHosts.js";
import { SOURCE_PLATFORMS } from "../src/shared/platformHosts.js";
import { execFileSync } from "node:child_process";
import path from "node:path";

__suiteDescribe("chatgpt-capture", () => {
// The MAIN-world entry installs on import; load it only after installing the browser fixture.
function installChatGPTHook(): void {
    const entry = require.resolve('../src/l1/sniffer/chatgpt/hook.js');
    delete require.cache[entry];
    require(entry);
}







const cid = '6acffdc5-c4d0-83e8-8e1b-ba60979a618a';
const session = chatgptSessionGen('C_CAPTURE_SESSION_04');

test('capture binds exact ChatGPT endpoints and rejects lookalikes, prepare and invalid IDs', () => {
    assert.deepEqual(chatGPTRequest('https://chatgpt.com/backend-api/f/conversation', 'POST'), { kind: 'stream' });
    assert.deepEqual(chatGPTRequest('https://chatgpt.com/backend-api/conversation/'+cid, 'GET'), { kind: 'detail', conversationId: cid });
    assert.deepEqual(chatGPTRequest('https://chatgpt.com/backend-api/conversations?offset=0&limit=28', 'GET'), { kind: 'list' });
    for (const [url, method] of [
        ['https://chatgpt.com.evil.test/backend-api/conversation/'+cid, 'GET'],
        ['http://chatgpt.com/backend-api/conversation/'+cid, 'GET'],
        ['https://chatgpt.com/backend-api/conversation/invalid', 'PATCH'],
        ['https://chatgpt.com/backend-api/f/conversation/prepare', 'POST'],
        ['https://chatgpt.com/backend-api/conversations', 'POST'],
        ['https://chatgpt.com/backend-api/conversations/invalid', 'GET'],
    ]) assert.equal(chatGPTRequest(url, method), null);
    assert.equal(confirmedChatGPTDeletion({ is_visible: false }, chatgptDeleteGen('C_CAPTURE_PATCH_CONFIRMED_01')), true);
    for (const [request, response] of [
        [{ is_visible: true }, chatgptDeleteGen('C_CAPTURE_PATCH_VISIBLE_01')],
        [{ is_visible: false }, chatgptDeleteGen('C_CAPTURE_PATCH_REJECTED_01')],
        [{ is_visible: false }, chatgptDeleteGen('C_CAPTURE_PATCH_EMPTY_01')],
        [{ is_visible: false }, chatgptDeleteGen('C_CAPTURE_PATCH_STRING_SUCCESS_01')],
    ] as const) assert.equal(confirmedChatGPTDeletion(request, response), false);
});

test('MAIN capture never consumes the page response or exposes tokens, and rejects switched sessions', async t => {
    const session = chatgptSessionGen('C_CAPTURE_SESSION_01');
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    t.after(() => {
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
        if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation); else Reflect.deleteProperty(globalThis, 'location');
    });
    for (const switched of [false, true]) {
        const events: unknown[] = [];
        let sessions = 0;
        const windowMock = { fetch: async (input: RequestInfo | URL) => {
            if (String(input).endsWith('/api/auth/session')) {
                sessions++;
                return Response.json(switched && sessions > 1 ? chatgptSessionGen('C_CAPTURE_SESSION_02') : session);
            }
            return Response.json(chatgptDetailGen('C_CAPTURE_EMPTY_DETAIL_01'));
        }, postMessage: (message: unknown) => events.push(message) };
        Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock });
        Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://chatgpt.com/c/'+cid, origin: 'https://chatgpt.com' } });
        installChatGPTHook();
        // Repeated MAIN-world script execution on the same window must be idempotent (never double-wrap fetch).
        installChatGPTHook();
        const response = await windowMock.fetch('https://chatgpt.com/backend-api/conversation/'+cid);
        assert.equal(response.bodyUsed, false);
        assert.equal((await response.json()).id, cid);
        for (let i = 0; i < 30 && sessions < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(events.length, switched ? 0 : 1);
        assert.equal(JSON.stringify(events).includes(String(session.accessToken)), false);
        if (!switched) assert.equal(Reflect.get(Reflect.get(events[0] as object, 'payload'), 'requestIdentity'), '["subject","workspace"]');
    }
});


test('SSE recognizes explicit completion and delta envelopes without treating prose as identity', () => {
    assert.deepEqual(chatGPTStreamEvent(streamGen('C_STREAM_EVENT_01')), {done:true});
    assert.deepEqual(chatGPTStreamEvent(streamGen('C_STREAM_EVENT_02')), {done:false,conversationId:cid});
    assert.deepEqual(chatGPTStreamEvent(streamGen('C_STREAM_EVENT_03')), {done:false,conversationId:cid});
    for (const key of ['C_STREAM_EVENT_INVALID_01', 'C_STREAM_EVENT_INVALID_02',
        'C_STREAM_EVENT_INVALID_03', 'C_STREAM_EVENT_INVALID_04'] as const)
        assert.deepEqual(chatGPTStreamEvent(streamGen(key)), {done:false});
});

test('sidebar list capture preserves pagination and all items without requiring a conversation id', async t => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    t.after(() => {
        for (const [key, descriptor] of [['window', previousWindow], ['location', previousLocation]] as const) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    });
    const page = chatgptListGen('C_CAPTURE_LIST_01');
    for (const mode of ['accepted', 'switched', 'workspace-mismatch', 'failed']) {
        const events: { payload: Record<string, unknown> }[] = [];
        let sessions = 0;
        const mock = {
            fetch: async (input: RequestInfo | URL, _init?: RequestInit) => {
                if (String(input).endsWith('/api/auth/session')) {
                    sessions++;
                    return Response.json(mode === 'switched' && sessions > 1
                        ? chatgptSessionGen('C_CAPTURE_SESSION_05') : session);
                }
                return Response.json(page, { status: mode === 'failed' ? 500 : 200 });
            },
            postMessage: (event: { payload: Record<string, unknown> }) => events.push(event),
        };
        Object.defineProperty(globalThis, 'window', { configurable: true, value: mock });
        Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://chatgpt.com/', origin: 'https://chatgpt.com' } });
        installChatGPTHook();
        const response = await mock.fetch('https://chatgpt.com/backend-api/conversations?offset=28&limit=28',
            mode === 'workspace-mismatch' ? { headers: { 'ChatGPT-Account-ID': 'other' } } : undefined);
        assert.equal(response.bodyUsed, false);
        assert.deepEqual(await response.json(), page);
        for (let i = 0; i < 30 && !events.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(events.length, mode === 'accepted' ? 1 : 0, mode);
        if (mode === 'accepted') {
            assert.equal(events[0].payload.kind, 'list');
            assert.deepEqual(events[0].payload.responseBody, page);
            assert.equal(events[0].payload.conversationId, undefined);
        }
        assert.equal(JSON.stringify(events).includes(String(session.accessToken)), false);
    }
});

test('MAIN emits on [DONE] even when the source stream remains open, without consuming the page branch', async t => {
    const session = chatgptSessionGen('C_CAPTURE_SESSION_03');
    const priorWindow=Object.getOwnPropertyDescriptor(globalThis,'window'), priorLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const source=new ReadableStream<Uint8Array>({start(c){controller=c;}});
    const events: unknown[]=[];
    const mock={fetch:async(input: RequestInfo | URL, _init?: RequestInit)=>String(input).endsWith('/api/auth/session')?Response.json(session):new Response(source),
        postMessage:(event:unknown)=>events.push(event)};
    Object.defineProperty(globalThis,'window',{configurable:true,value:mock});
    Object.defineProperty(globalThis,'location',{configurable:true,value:{href:'https://chatgpt.com/',origin:'https://chatgpt.com'}});
    t.after(()=>{controller.close();if(priorWindow)Object.defineProperty(globalThis,'window',priorWindow);else Reflect.deleteProperty(globalThis,'window');
        if(priorLocation)Object.defineProperty(globalThis,'location',priorLocation);else Reflect.deleteProperty(globalThis,'location');});
    installChatGPTHook();
    const response=await mock.fetch('https://chatgpt.com/backend-api/f/conversation',{method:'POST'});
    const data=streamGen('C_STREAM_CAPTURE_CHUNK_01');
    controller!.enqueue(new TextEncoder().encode(data.slice(0,20)));
    controller!.enqueue(new TextEncoder().encode(data.slice(20)));
    for(let i=0;i<50&&!events.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(events.length,1,'completion does not wait for HTTP EOF or tee cancellation');
    assert.equal(response.bodyUsed,false);
    const reader=response.body!.getReader();const first=await reader.read();assert.ok(first.value!.length>0);reader.releaseLock();
    assert.ok(!JSON.stringify(events).includes(String(session.accessToken)));
});


test('native ChatGPT DELETE binds its exact id endpoint and requires explicit success', () => {
    assert.deepEqual(chatGPTRequest('https://chatgpt.com/backend-api/conversation/id/'+cid,'DELETE'),{kind:'delete',conversationId:cid,method:'DELETE'});
    assert.equal(chatGPTRequest('https://chatgpt.com/backend-api/conversation/'+cid,'DELETE'),null);
    assert.equal(confirmedChatGPTDeletion(null, chatgptDeleteGen('C_CAPTURE_DELETE_CONFIRMED_01'), 'DELETE'), true);
    for (const key of [
        'C_CAPTURE_DELETE_NULL_01',
        'C_CAPTURE_DELETE_EMPTY_01',
        'C_CAPTURE_DELETE_REJECTED_01',
        'C_CAPTURE_DELETE_STRING_SUCCESS_01',
    ] as const) assert.equal(confirmedChatGPTDeletion(null, chatgptDeleteGen(key), 'DELETE'), false);
});

test('SSR sidebar capture awaits native loader data, binds its workspace and strips unrelated fields', async () => {
    const identity = async () => '["subject","workspace"]';
    const page = chatgptListGen('C_CAPTURE_SIDEBAR_LIST_01');
    const history = { accountId: 'workspace', chats: Promise.resolve(page), session: { accessToken: 'private-token' } };
    const captured = await chatGPTSidebarPage(history, identity);
    assert.equal(captured?.responseBody.items.length, 1);
    assert.equal(captured?.responseBody.total, 1);
    assert.equal(captured?.requestIdentity, await identity());
    assert.ok(!JSON.stringify(captured).includes('private-token'));
    assert.ok(!JSON.stringify(captured).includes('not-list-data'));
    assert.equal(await chatGPTSidebarPage({ ...history, accountId: 'other' }, identity), null);
    let reads = 0;
    assert.equal(await chatGPTSidebarPage(history, async () => ++reads === 1 ? await identity() : '["other","workspace"]'), null);
    assert.equal(await chatGPTSidebarPage(history, async () => null), null);
    assert.equal(await chatGPTSidebarPage({ accountId: 'workspace', chats: Promise.resolve({ ...page,
        items: [{ id: 'invalid' }] }) }, identity), null);
    assert.equal(await chatGPTSidebarPage({ accountId: 'workspace', chats: Promise.resolve({ ...page,
        items: [null] }) }, identity), null);
    assert.equal(await chatGPTSidebarPage({ accountId: 'workspace', chats: Promise.resolve({ ...page,
        items: [123] }) }, identity), null);
    assert.equal(await chatGPTSidebarPage({ chats: page }, identity), null);
});
});

__suiteDescribe("chatgpt-discovery.integration", () => {
async function environment() {
    const storage = indexStorage({}, { seedAccounts: false });
    await storage.ready;
    const fetchFn = globalThis.fetch;
    let granted = true, open = true;
    const calls: string[] = [];
    Object.assign(chrome, {
        permissions: { contains: async () => granted },
        tabs: { query: async () => open ? [{ id: 1, url: 'https://chatgpt.com/' }] : [] },
    });
    return { calls, grant: (value: boolean) => { granted = value; }, open: (value: boolean) => { open = value; },
        restore() { globalThis.fetch = fetchFn; ProviderRegistry.unregister('chatgpt'); storage.restore(); } };
}

test('ChatGPT discovery is inert without optional access or an open ChatGPT tab', async () => {
    const env = await environment();
    try {
        globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
        env.grant(false);
        assert.deepEqual(await discoverChatGPTAccounts(), []);
        env.grant(true); env.open(false);
        assert.deepEqual(await discoverChatGPTAccounts(), []);
        assert.deepEqual(await listAccounts(), []);
        assert.equal(ProviderRegistry.get('chatgpt'), undefined);
    } finally { env.restore(); }
});

test('Granted discovery registers the session workspace and the production scan commits ChatGPT indexes', async () => {
    const env = await environment();
    try {
        globalThis.fetch = async (input, init) => {
            const url = String(input); env.calls.push(new URL(url).pathname);
            assert.equal(init?.credentials, 'include');
            if (url.endsWith('/api/auth/session')) return new Response(JSON.stringify(chatgptSessionGen('C_DISCOVERY_SESSION_01')));
            assert.equal(url, 'https://chatgpt.com/backend-api/conversations?offset=0&limit=100');
            return new Response(JSON.stringify(chatgptListGen('C_DISCOVERY_LIST_01')));
        };
        const [account] = await discoverChatGPTAccounts();
        assert.equal(account.providerId, 'chatgpt');
        assert.equal(account.providerAccountId, JSON.stringify(['user', 'workspace']));
        assert.equal(ProviderRegistry.get('chatgpt')?.id, 'chatgpt');
        assert.deepEqual(await scanAll({ accountId: account.id }), {
            status: 'complete', pagesFetched: 1, conversationsFetched: 1, indexChanges: { added: 1, updated: 0 },
        });
        assert.equal((await listIndexes(account.id))[0].title, 'ChatGPT conversation');
        assert.deepEqual((await listAccounts()).filter(account => account.providerId === 'gemini'), []);
        assert.ok(env.calls.includes('/backend-api/conversations'));
        const again = await discoverChatGPTAccounts();
        assert.equal(again[0].id, account.id, 'discovery reuses the canonical account');
    } finally { env.restore(); }
});

test('Missing login or workspace identity cannot create a ChatGPT scan account', async () => {
    const env = await environment();
    try {
        for (const key of ['C_DISCOVERY_SESSION_02', 'C_DISCOVERY_SESSION_03', 'C_DISCOVERY_SESSION_04', 'C_DISCOVERY_SESSION_06'] as const) {
            const value = chatgptSessionGen(key);
            globalThis.fetch = async () => new Response(JSON.stringify(value));
            assert.deepEqual(await discoverChatGPTAccounts(), []);
        }
        assert.deepEqual(await listAccounts(), []);
        assert.equal(ProviderRegistry.get('chatgpt'), undefined);
        globalThis.fetch = async () => new Response(JSON.stringify(chatgptSessionGen('C_DISCOVERY_SESSION_05')), { status: 401 });
        await assert.rejects(discoverChatGPTAccounts(), /session failed: 401/);
    } finally { env.restore(); }
});
});

__suiteDescribe("chatgpt_account_context", () => {
test('ChatGPT badge binds session subject and workspace, rejects other providers and clears logout', async t => {
    configureAccountAdapter(createChatGPTAccountAdapter());
    const names = ['window', 'location', 'chrome', 'fetch'];
    const prior = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    t.after(() => {
        configureAccountAdapter(null);
        invalidateAccountContext();
        for (const name of names) {
            const descriptor = prior.get(name);
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    });
    let workspace = 'workspace-1';
    let loggedIn = true;
    let requests = 0;
    const id1 = '11111111-1111-4111-8111-111111111111';
    const id2 = '22222222-2222-4222-8222-222222222222';
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: {
        protocol: 'https:', hostname: 'chatgpt.com', origin: 'https://chatgpt.com', href: 'https://chatgpt.com/c/test',
    } });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string) => {
        assert.equal(url, '/api/auth/session');
        requests++;
        return Response.json(loggedIn
            ? chatgptSessionGen(workspace === 'workspace-1' ? 'C_ACCOUNT_CONTEXT_WORKSPACE_01' : 'C_ACCOUNT_CONTEXT_WORKSPACE_02')
            : chatgptSessionGen('C_ACCOUNT_CONTEXT_LOGOUT_01'));
    } });
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
        sendMessage: async (message: Record<string, unknown>) => {
            if (message.action === 'ensureV2Ready') return { ok: true };
            assert.equal(message.command, 'getOrCreate');
            assert.equal(message.providerId, 'chatgpt');
            assert.equal(message.providerAccountId, JSON.stringify(['subject', workspace]));
            assert.equal(JSON.stringify(message).includes('private-token'), false);
            return { ok: true, value: { id: workspace === 'workspace-1' ? id1 : id2,
                providerId: 'chatgpt', providerAccountId: message.providerAccountId } };
        },
    } } });
    invalidateAccountContext();
    assert.equal((await resolveCurrentAccount())?.accountId, id1);
    workspace = 'workspace-2';
    assert.equal((await resolveCurrentAccount())?.accountId, id2);
    assert.equal(getAccountContext()?.providerId, 'chatgpt');
    await assert.rejects(resolveCurrentAccount({ providerId: 'gemini', providerAccountId: 'wrong-provider' }), /Wrong account observation provider/);
    loggedIn = false;
    assert.equal(await resolveCurrentAccount(), null);
    assert.equal(getAccountContext(), null);
    assert.equal(requests, 3);
});
});

__suiteDescribe("chatgpt_rpc_fixture_closure", () => {
/**
 * ChatGPT HTTP mock payloads are owned by the corresponding endpoint Gen(key):
 * session, List, Detail, Stream, deletion, file-download JSON and signed asset bytes.
 * Parser-level shape tests and ordinary response/status assertions are not HTTP mocks.
 */
const root = join(__dirname);
const generatorFolder = 'fixtures/providers/';

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

test('ChatGPT native HTTP response mocks use their endpoint-keyed fixtures', () => {
    const violations: string[] = [];
    const inlineMocks = [
        // Session, List, Detail, and signed-download JSON constructed directly as fetch replies.
        /Response\.json\(\s*\{\s*(?:user|accessToken|items|conversation_id|download_url)\s*:/g,
        /new\s+Response\(\s*JSON\.stringify\(\s*\{\s*(?:user|accessToken|items|conversation_id|mapping|download_url)\s*:/g,
        /Response\.json\(\s*\{\s*id:\s*[^,]+,\s*mapping:\s*\{/g,
        // Empty HTTP bodies accompanying retry status are List endpoint responses too.
        /new\s+Response\(\s*(?:''|"")\s*,\s*\{\s*status:\s*429/g,
        // SSE transport literals are owned by streamGen(key), not individual source tests.
        /chatGPTStreamEvent\(\s*['"]data:/g,
        // Native deletion acknowledgements must not be constructed inline.
        /confirmedChatGPTDeletion\(\s*(?:null|\{[^}]*\})\s*,\s*(?:null|\{[^}]*\})/g,
    ];
    for (const file of testSources(root)) {
        const path = relative(root, file).replaceAll('\\', '/');
        if (path.startsWith(generatorFolder) || path === 'chatgpt_rpc_fixture_closure.test.ts') continue;
        const source = readFileSync(file, 'utf8');
        // Only scan native ChatGPT test consumers; other providers use different generators.
        if (!/\b(?:ChatGPTProvider|chatgpt(?:List|Session|Detail)Gen|installChatGPTHook|chatGPTRequest)\b/.test(source)) continue;
        const patterns = source.includes('confirmedChatGPTDeletion(')
            ? [...inlineMocks, /\{\s*success:\s*(?:true|false|'true'|"true")\s*\}/g]
            : inlineMocks;
        for (const pattern of patterns) {
            for (const match of source.matchAll(pattern)) {
                const line = source.slice(0, match.index).split('\n').length;
                violations.push(`${path}:${line} constructs a ChatGPT response outside Gen(key)`);
            }
        }
    }
    assert.deepEqual(violations, [], 'native ChatGPT mocks must be generated by their matching endpoint fixture');
});
});

__suiteDescribe("provider-chatgpt-dil", () => {
const corpus = JSON.parse(readFileSync(join(__dirname, 'fixtures/chatgpt_dil_corpus.json'), 'utf8')) as Array<{name: string; raw: string; fallback: string}>;
function codes(text: string): string[] {
    const result: string[] = [];
    const walk = (nodes: RootContent[]) => { for (const node of nodes) { if (node.type === 'code') result.push(node.value); if ('children' in node) walk(node.children); } };
    walk(parseMarkdownAst(preprocessChatGPTMarkdown(text)).children); return result;
}
function domainCodes(blocks: BlockNode[]): string[] {
    return blocks.flatMap(block => block.type === 'code' ? [block.code]
        : block.type === 'quote' ? domainCodes(block.blocks)
        : block.type === 'list' ? block.items.flatMap(item => domainCodes(item.blocks)) : []);
}
function ordered(text: string, expected: string[]) {
    let at = -1;
    for (const token of expected) { const next = text.indexOf(token, at + 1); assert.ok(next > at, `Missing/out-of-order: ${token}`); at = next; }
}

for (const fixture of corpus) test(`Captured DIL ${fixture.name}: source is independently parseable without fallback`, () => {
    const direct = snapshot(fixture.raw), withFallback = snapshot(fixture.raw, fixture.fallback);
    assert.equal(direct.incomplete, false, JSON.stringify(direct.unsupported));
    assert.equal(direct.fallbackBlocks, 0);
    assert.deepEqual(direct.unsupported, []);
    assert.equal(withFallback.text, direct.text, 'official fallback does not replace a supported source');
    assert.equal(withFallback.fallbackBlocks, 0);
    // Verify every original Python CodeBlock physically survives, including
    // indentation. This oracle reads raw component bodies, not parser output.
    const parsed = parseChatGPTConversation({ assetsByNode: new Map(), conversation: {
        id: fixture.name, title: fixture.name, current_node: 'answer', createdAtMs: 1000, updatedAtMs: 2000, is_archived: false,
        mapping: new Map(Object.entries<ChatGPTConversationNode>({ root: { id: 'root', children: ['answer'] }, answer: { id: 'answer', parent: 'root', children: [], message: {
            id: 'answer', author: { role: 'assistant' }, recipient: 'all', weight: 1, end_turn: true,
            status: 'finished_successfully', content: { content_type: 'text', parts: [fixture.raw] },
            metadata: { model_dil_v2: { fallbackMarkdown: fixture.fallback } },
        } } })),
    } });
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.equal(parsed.conversation.detail.messages.length, 1);
    const actualCodes = codes(direct.text);
    const productionCodes = parsed.conversation.detail.messages.flatMap(message => domainCodes(message.content));
    for (const match of fixture.raw.matchAll(/<CodeBlock\b[^>]*>\n?([\s\S]*?)\n?<\/CodeBlock>/g)) {
        const expected = match[1].replace(/\n\s*$/, '');
        assert.ok(actualCodes.includes(expected), `${fixture.name}: code body changed`);
        assert.ok(productionCodes.includes(expected), `${fixture.name}: production conversation changed code body`);
    }
});

test('Live Helmholtz checklist stays before conclusion with all six labels and static initial counter', () => {
    const fixture = corpus.find(item => item.raw.includes('const checks ='))!;
    const result = snapshot(fixture.raw, fixture.fallback);
    ordered(result.text, ['## 7. Reproducibility checklist', '0 of 6',
        'Record cavity volume, neck radius, and physical neck length in SI units.',
        'Record the speed of sound and the exact end-correction convention.',
        'Calculate effective length and ideal resonance frequency independently.',
        'Run the positive-domain, scaling, volume-dependence, and reference tests.',
        'Record Python version, test output, and any changes to model parameters.',
        'If comparing with hardware, record the measurement setup, temperature, boundary conditions, and observed resonance peak.',
        '**Conclusion:**']);
    assert.ok(!result.text.includes('setDone'));
    assert.equal(result.representation, 'structured-source');
    assert.equal(result.text.match(/Record cavity volume/g)?.length, 1);
});

test('Layout cards, title, divider, code, SVG, learning widget and gallery render in source order', () => {
    const raw = '# Before\n<box><title size="xl">Summary</title><grid><grid-item><text>Count</text>64</grid-item></grid>'
        + '<divider/><CodeBlock language="python">print("<box>{literal}</box>")</CodeBlock>'
        + '<svg><text fontSize="12">diagram</text></svg>'
        + '<LearningViz type_id="ANGULAR_FREQUENCY_RELATION" initial_values={{frequency:100}}/>'
        + '<AsyncImage query="test diagram"/><caption>Caption text</caption>'
        + '<math block value="x^2"/><input value="10" placeholder="Enter value"/>'
        + '<LearningViz type_id="COMPOUND_INTEREST">Growth formula</LearningViz></box>\nAfter';
    const result = snapshot(raw);
    assert.equal(result.incomplete, false);
    ordered(result.text, ['# Before', '**Summary**', 'Count', '64', '---', '```python', 'print("<box>{literal}</box>")',
        '```svg', 'font-size="12"', 'Shows the relationship', '- frequency: 100', '\uE200image_group', 'Caption text', 'x^2', '输入框占位文本：Enter value', '初始值：10', 'Explains compound interest', 'Growth formula', 'After']);
    assert.deepEqual(codes(result.text), ['print("<box>{literal}</box>")', '<svg><text font-size="12">diagram</text></svg>']);
});

test('Literal loops render only referenced fields, retain repeated choices, and honor nested conditions', () => {
    const result = snapshot('{@body const internal = ["not-visible"]}'
        + '{@body const $questions = [{q:"One?",opts:["Yes","No"],secret:"hidden"},{q:"Two?",opts:["Yes","No"]}]}'
        + '{#each $questions as q,i}<box><text>{q.q}</text>{#each q.opts as opt,j}<radio>{["A","B"][j]}. {opt}</radio>{/each}'
        + '{#if i < $questions.length - 1}<divider/>{:else}<text>Last</text>{/if}</box>{/each}');
    assert.equal(result.incomplete, false);
    assert.ok(!result.text.includes('not-visible')); assert.ok(!result.text.includes('hidden'));
    ordered(result.text, ['One?', 'A. Yes', 'B. No', '---', 'Two?', 'A. Yes', 'B. No', 'Last']);
    assert.equal(result.text.match(/A\. Yes/g)?.length, 2);
});

test('Components preserve Markdown code, inline code, formulas, and safe literal interpolation', () => {
    const raw = String.raw`<box>
\[x_{i} < y_{j}\]
\(p<q\)
` + '`<checkbox>{fake}</checkbox>`' + '\n```html\n<box>{untouched}</box>\n```\n'
        + '{@body const label = "safe <tag> *value*"}<text>{label}</text></box>';
    const result = snapshot(raw);
    assert.equal(result.incomplete, false);
    assert.ok(result.text.includes(String.raw`\[x_{i} < y_{j}\]`));
    assert.ok(result.text.includes('`<checkbox>{fake}</checkbox>`'));
    assert.ok(result.text.includes('safe \\<tag\\> \\*value\\*'));
    assert.deepEqual(codes(result.text), ['<box>{untouched}</box>']);
});

test('Only the unsupported component uses uniquely anchored fallback; siblings and restored labels stay', () => {
    const before = 'This paragraph precedes the custom visualization.';
    const after = 'This paragraph follows the custom visualization.';
    const result = snapshot(`<box>${before}<CustomChart value={getData()}/>${after}</box>`
        + '{@body const items = ["Restored choice"]}{#each items as item}<checkbox>{item}</checkbox>{/each}',
        `${before}\nChart summary from provider.\n${after}`);
    ordered(result.text, [before, 'Chart summary from provider.', after, 'Restored choice']);
    assert.equal(result.fallbackBlocks, 1);
    assert.deepEqual(result.unsupported, ['CustomChart']);
    assert.equal(result.incomplete, false);
    const unicodeBefore = 'Long enough neighboring text 𐐀&#65;';
    const unicodeAfter = 'Following paragraph that anchors the end.';
    const unicode = snapshot(`<box>${unicodeBefore}<CustomChart/>${unicodeAfter}</box>`,
        `${unicodeBefore}\nChart description.\n${unicodeAfter}`);
    ordered(unicode.text, [unicodeBefore, 'Chart description.', unicodeAfter]);
    assert.equal(unicode.fallbackBlocks, 1);
    assert.equal(unicode.text.match(/&#65;/g)?.length, 1);
});

test('Unknown, malformed and ambiguous components preserve fallback or explicitly report unavailable content', () => {
    for (const raw of ['<custom-chart/>', '<LearningViz type_id="UNKNOWN"/>', '<box>Unclosed', '{#each missing as x}{x}{/each}', '<text>{run()}</text>', '<box>'.repeat(70)]) {
        const fallback = 'Known provider content'; const result = snapshot(raw, fallback);
        assert.equal(result.text, fallback); assert.equal(result.incomplete, false); assert.ok(result.fallbackBlocks);
        assert.equal(snapshot(raw).incomplete, true, raw);
    }
    assert.equal(snapshot('x'.repeat(1_000_001), 'Full fallback').text, 'Full fallback');
    assert.equal(snapshot('').incomplete, true);
    assert.equal(snapshot('', 'Fallback only').text, 'Fallback only');
    assert.equal(snapshot('<radio>One label</radio>', 'Extra question\nOne label\nOther label').text,
        'Extra question\nOne label\nOther label', 'source discrepancy does not erase additional provider content');
});

test('Expressions and handlers cannot execute calls, access prototypes, or expand arbitrary data', () => {
    for (const source of ['fetch("https://invalid.example")', '[{q:run()}]', '["hidden"].map(run)',
        '[...secrets]', '[{get q(){return "hidden"}}]', '({}).constructor', 'x.__proto__', 'x["constructor"]',
        'new Function("return 1")', '(()=>1)()', '1/0', '"x".repeat(1e9)']) {
        assert.throws(() => expression(source, new Map([['x', []]])), source);
        const result = snapshot(`{@body const questions = ${source}}{#each questions as q}<text>{q}</text>{/each}`, '[Submit]');
        assert.equal(result.text, '[Submit]'); assert.ok(result.unsupported.length);
    }
    assert.throws(() => expression('x + x', new Map([['x', 'x'.repeat(600_000)]])), /string limit/);
    assert.equal(snapshot('<button onClick={() => fetch("https://invalid.example")}>Submit</button>').text.trim(), '[Submit]');
    assert.equal(snapshot('<checkbox checked={run()} onChange={run}>Label</checkbox>').text.trim(), '- Label');
});
});

__suiteDescribe("release-chatgpt-bundles", () => {
test('physical release ZIP contains every source script and retains all optional platform groups', () => {
    const root = path.resolve(__dirname, '..');
    const source = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as { version: string };
    const archive = `gemini-exporter-v${source.version}.zip`;
    execFileSync(process.execPath, ['build.js', '--pack'], { cwd: root, stdio: 'pipe' });
    const manifest = JSON.parse(execFileSync('unzip', ['-p', archive, 'manifest.json'],
        { cwd: root, encoding: 'utf8' })) as { host_permissions: string[]; optional_host_permissions: string[] };
    for (const host of SOURCE_PLATFORMS.flatMap(platformOrigins)) {
        assert.ok(manifest.optional_host_permissions.includes(host));
        assert.ok(!manifest.host_permissions.includes(host));
    }
    for (const file of ['dist/content/hook.js', 'dist/content/content.js', 'dist/content/chatgpt-hook.js', 'dist/content/chatgpt-content.js', 'dist/content/grok-hook.js', 'dist/content/grok-content.js', 'dist/content/claude-hook.js', 'dist/content/claude-content.js']) {
        const bytes = execFileSync('unzip', ['-p', archive, file], { cwd: root });
        assert.ok(bytes.length > 0, file);
    }
    const notices = execFileSync('unzip', ['-p', archive, 'THIRD_PARTY_NOTICES.md'], { cwd: root, encoding: 'utf8' });
    assert.ok(notices.includes('Copyright (c) 2025 Yalums'));
    assert.ok(notices.includes('5ae077b5bc010d80289a851621514397cf95422b'));
    const entries = execFileSync('unzip', ['-Z1', archive], { cwd: root, encoding: 'utf8' });
    assert.ok(!entries.split('\n').some(name => name.startsWith('temp/')));
});
});
