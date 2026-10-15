import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { rpcFixture, historicalFixture } from './helpers/nativeFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { init as initRouter, type MessageRouterDeps } from '../src/content/messageRouter.js';
import { init as initLive, resolveConversationDetail } from '../src/content/liveSaveCoordinator.js';
import { DomScraper } from '../src/content/domScraper.js';
import { ProviderRegistry } from '../src/core/provider/providerRegistry.js';
import type { GeminiProviderConversationDetail } from '../src/core/provider/gemini/geminiContracts.js';
import type { DomDetail, GetConversationDetailResponse, DetailFailure } from '../src/types/detailTransport.js';

// Compile-time regression: explicit null disables these optional runtime dependencies.
// Keep this assignment typed; routing through an unchecked fixture would hide the bug.
const deps: MessageRouterDeps = { syncEngine: null, scraper: null, assets: null, storage: null };
void deps;

function detail(): GeminiProviderConversationDetail {
    return rpcFixture({ id: 'detail123', title: 'Research', titleSource: 'rpc', titles: { rpc: 'Research' }, timestamp: null, createdAt: null, updatedAt: null,
        messages: [{ role: 'model', content: 'Research answer', timestamp: 1700000000000, model: 'Model',
            attachments: [{ type: 'image', url: 'https://example.com/image', name: 'generated.png' }],
            citations: [{ title: 'Citation', url: 'source' }], thoughts: 'thought' }] },
        { decodedPayload: { wire: ['evidence'] }, schemaDrift: ['drift'], turnsRejected: 1 });
}

async function withProvider(run: (set: (acquire: () => Promise<GeminiProviderConversationDetail>) => void) => Promise<void>) {
    const provider = ProviderRegistry.getDefault();
    assert.ok(provider);
    const original = provider.fetchConversationDetail;
    try { await run(acquire => { provider.fetchConversationDetail = acquire; }); }
    finally { provider.fetchConversationDetail = original; initLive(); }
}

async function route(dom: DomDetail | DetailFailure | (() => Promise<DomDetail | DetailFailure>)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] | undefined;
    let removed = '';
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { ...globalThis.chrome, runtime: {
        onMessage: { addListener(fn: typeof listener) { listener = fn; }, removeListener() {} }, sendMessage() {}
    } } });
    try {
        initRouter({ scraper: { ...DomScraper, contentFetchChatDetail: typeof dom === 'function' ? dom : async () => dom },
            storage: { removeConversation: async (_slot, id) => { removed = id; return true; }, getConversations: async () => [] } });
        assert.ok(listener);
        const result = await new Promise<GetConversationDetailResponse>(resolve => {
            listener!({ action: 'getConversationDetail', conversationId: 'detail123', targetSid: 'sid' }, {}, resolve);
        });
        return { result, removed };
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'chrome', descriptor);
        else Reflect.deleteProperty(globalThis, 'chrome');
    }
}
const dom: DomDetail = { ...historicalFixture({ id: 'detail123', title: 'DOM title', titleSource: 'dom', messages: [{ role: 'user', content: 'DOM' }] }), transport: { nodeCount: 1, htmlLen: 42, fallbackUsed: null } };
const emptyDom: DomDetail = { ...dom, conversation: { index: { ...dom.conversation.index }, detail: { ...dom.conversation.detail, messages: [] } } };

test('messageRouter: provider success preserves all companion and multimodal evidence', async () => withProvider(async set => {
    const payload = detail(); set(async () => payload);
    const { result, removed } = await route(async () => { throw new Error('DOM must not run'); });
    assert.ok(result.success && result.source === 'batchexecute');
    assert.deepEqual(('conversation' in result.data && result.data.conversation.detail.messages), payload.conversation.detail.messages);
    assert.deepEqual('transport' in result.data && result.data.transport, payload.transport);
    assert.equal(removed, '');
}));

test('messageRouter: empty RPC retains raw previews and DOM debug without pruning', async () => withProvider(async set => {
    const payload = detail(); payload.conversation.detail.messages = []; set(async () => payload);
    const { result, removed } = await route(emptyDom);
    assert.ok(result.success && result.source === 'dom' && '_empty' in result.data);
    const debug = result.data._debug; assert.ok(debug && 'batchexecuteEmptyDebug' in debug);
    assert.deepEqual(debug.batchexecuteEmptyDebug, { rawKeys: ['wire'], rawPreview: JSON.stringify(payload.transport.decodedPayload),
        topPreview: JSON.stringify(payload).slice(0, 1000), messagesLen: 0, hasRaw: true, titleSeen: 'Research' });
    assert.equal(debug.domHtmlLen, 42); assert.equal(result.data.isEmpty, true); assert.equal(removed, '');
}));

test('messageRouter: provider failure permits valid DOM fallback; 404 only marks confirmed cloud deletion', async () => withProvider(async set => {
    set(async () => { throw new Error('temporary failure'); });
    const success = await route(dom);
    assert.ok(success.result.success && success.result.source === 'dom'); assert.deepEqual('conversation' in success.result.data && success.result.data.conversation.detail.messages, dom.conversation.detail.messages);
    assert.equal(success.removed, '');
    const deleted = await route({ id: 'detail123', isDeleted: true, error: 'HTTP 404', _debug: { status: 404, isNotFound: true } });
    assert.ok(deleted.result.success && deleted.result.source === 'dom' && '_empty' in deleted.result.data);
    assert.equal(deleted.result.data.isDeleted, true); assert.equal(deleted.result.data.isEmpty, false);
    assert.equal(deleted.removed, '');
    assert.ok(deleted.result.data._debug && 'batchexecuteEmptyDebug' in deleted.result.data._debug);
    assert.deepEqual(deleted.result.data._debug.batchexecuteEmptyDebug, { error: 'temporary failure' });
}));

test('messageRouter: confirmed RPC deletion suppresses DOM and preserves deletion evidence', async () => withProvider(async set => {
    set(async () => { throw new Error('rpc error (BardErrorInfo: 1167) inaccessible or deleted'); });
    const { result, removed } = await route(async () => { throw new Error('DOM must not run'); });
    assert.ok(result.success && result.source === 'batchexecute' && '_empty' in result.data);
    assert.equal(result.data.isDeleted, true); assert.equal(removed, '');
    assert.ok(result.data._debug && 'isDeleted' in result.data._debug);
    assert.equal(result.data._debug.isDeleted, true);
}));

test('messageRouter: DOM deletion uses the explicit outcome regardless of diagnostic evidence', async () => withProvider(async set => {
    set(async () => { throw new Error('temporary failure'); });
    for (const isDeleted of [false, true]) {
        const { result } = await route({ id: 'detail123', error: 'source failure', isDeleted,
            _debug: { isNotFound: !isDeleted, status: isDeleted ? 500 : 404 } });
        assert.ok(result.success && '_empty' in result.data);
        assert.equal(result.data.isDeleted, isDeleted);
        assert.equal(result.data.isEmpty, !isDeleted);
    }
}));

test('liveSave: provider and injected acquisition retain title/media/evidence and derive only missing time aliases', async () => withProvider(async set => {
    for (const injected of [false, true]) {
        const payload = detail(); let calledId = '';
        set(async () => { if (injected) throw new Error('provider must not run'); return payload; });
        class Client { async getConversationDetail(id: string) { calledId = id; return payload; } }
        initLive(injected ? { clientClass: Client } : {});
        const before = structuredClone(payload.conversation.detail.messages);
        const resolved = await resolveConversationDetail('c_detail123');
        assert.notEqual(resolved, payload); assert.deepEqual(resolved?.conversation.detail.messages, before);
        assert.equal(Object.hasOwn(resolved!.conversation, 'chatTime'), false);
        assert.equal(resolved?.sourceVersion, undefined); assert.equal(resolved?.conversation.index.createdAt, undefined);
        assert.equal(resolved?.conversation.index.titleSource, 'rpc'); assert.equal(Object.hasOwn(resolved!.conversation, 'titles'), false);
        if (injected) assert.equal(calledId, 'detail123');
    }
    const existing = detail(); existing.sourceVersion = 1500000000000;
    set(async () => existing); initLive();
    assert.equal((await resolveConversationDetail('detail123'))?.sourceVersion, existing.sourceVersion);
    assert.equal(existing.sourceVersion, 1500000000000);
}));

test('liveSave: empty/failed provider and failed injected client still permit DOM acquisition', async () => withProvider(async set => {
    const empty = detail(); empty.conversation.detail.messages = [];
    for (const mode of ['empty', 'failed', 'injected']) {
        set(async () => { if (mode === 'empty') return empty; throw new Error('failure'); });
        class Client { async getConversationDetail(): Promise<GeminiProviderConversationDetail> { throw new Error('injected failure'); } }
        initLive({ scraper: { ...DomScraper, parseDoc: () => dom }, ...(mode === 'injected' ? { clientClass: Client } : {}) });
        assert.deepEqual((await resolveConversationDetail('detail123'))?.conversation.detail.messages, dom.conversation.detail.messages);
    }
}));

test('liveSave: missing document is an explicit null DOM fallback, not a non-null assertion', async () => withProvider(async set => {
    set(async () => { throw new Error('provider unavailable'); });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'document');
    try {
        assert.equal(DomScraper.parseDoc(null, 'detail123'), null);
        initLive();
        assert.equal(await resolveConversationDetail('detail123'), null);
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    }
}));
