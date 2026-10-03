import test from 'node:test';
import assert from 'node:assert/strict';
import { init as initRouter, type MessageRouterDeps } from '../src/content/messageRouter.js';
import { init as initLive, resolveConversationDetail } from '../src/content/liveSaveCoordinator.js';
import { DomScraper } from '../src/content/domScraper.js';
import { ProviderRegistry } from '../src/core/provider/providerRegistry.js';
import type { GeminiProviderConversationDetail } from '../src/core/provider/gemini/geminiContracts.js';
import type { DomDetail, GetConversationDetailResponse } from '../src/types/detailTransport.js';

// Compile-time regression: explicit null disables these optional runtime dependencies.
// Keep this assignment typed; routing through an unchecked fixture would hide the bug.
const deps: MessageRouterDeps = { storage: null, utils: null };
void deps;

function detail(): GeminiProviderConversationDetail {
    return { id: 'detail123', title: 'Research', titleSource: 'rpc', titles: { rpc: 'Research' },
        createdAt: null, updatedAt: null, timestamp: null, chatTime: null,
        url: 'https://gemini.google.com/app/detail123', nextPageToken: null, messageCount: 1, attachmentCount: 1,
        messages: [{ role: 'model', content: 'Research answer', timestamp: 1700000000000,
            images: [{ type: 'image', sourceUrl: 'https://example.com/image', isGenerated: true, generation: { chatId: 'detail123', providerRequestId: 'req', generationOrdinal: 0 } }],
            attachments: [{ type: 'image', originalUrl: 'original', alt: 'generated' }],
            documents: [{ id: 'doc', title: 'Report', chipUrl: 'chip', url: 'url', localName: 'report.md', type: 'doc', sections: ['section'], links: [] }],
            citations: [{ title: 'Citation', url: 'source' }], structuredContent: { children: [] }, groundingCitationMarkers: ['cite'], thoughts: ['thought'] }],
        _raw: { wire: ['evidence'] }, _debug: { turnsLen: 1 }, schemaDrift: ['drift'], turnsRejected: 1,
        truncated: true, isTruncated: true, truncateReason: 'token_loop' };
}

async function withProvider(run: (set: (acquire: () => Promise<GeminiProviderConversationDetail>) => void) => Promise<void>) {
    const provider = ProviderRegistry.getDefault();
    assert.ok(provider);
    const original = provider.fetchConversationDetail;
    try { await run(acquire => { provider.fetchConversationDetail = acquire; }); }
    finally { provider.fetchConversationDetail = original; initLive(); }
}

async function route(dom: DomDetail | (() => Promise<DomDetail>)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] | undefined;
    let removed = '';
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
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
const dom: DomDetail = { id: 'detail123', title: 'DOM title', titleSource: 'dom', messages: [{ role: 'user', content: 'DOM' }], _debug: { nodeCount: 1 } };

test('messageRouter: provider success preserves all companion and multimodal evidence', async () => withProvider(async set => {
    const payload = detail(); set(async () => payload);
    const { result, removed } = await route(async () => { throw new Error('DOM must not run'); });
    assert.ok(result.success && result.source === 'batchexecute');
    assert.strictEqual(result.data, payload);
    assert.strictEqual(result.data.messages, payload.messages);
    assert.deepEqual(result.data, payload); assert.equal(removed, '');
}));

test('messageRouter: empty RPC retains raw previews and DOM debug without pruning', async () => withProvider(async set => {
    const payload = detail(); payload.messages = []; set(async () => payload);
    const { result, removed } = await route({ ...dom, messages: [], _debug: { htmlLen: 42 } });
    assert.ok(result.success && result.source === 'dom' && '_empty' in result.data);
    const debug = result.data._debug;
    assert.deepEqual(debug.batchexecuteEmptyDebug, { rawKeys: ['wire'], rawPreview: JSON.stringify(payload._raw),
        topPreview: JSON.stringify(payload).slice(0, 1000), messagesLen: 0, hasRaw: true, titleSeen: 'Research' });
    assert.equal(debug.domHtmlLen, 42); assert.equal(result.data.isEmpty, true); assert.equal(removed, '');
}));

test('messageRouter: provider failure permits valid DOM fallback; 404 prunes only confirmed deletion', async () => withProvider(async set => {
    set(async () => { throw new Error('temporary failure'); });
    const success = await route(dom);
    assert.ok(success.result.success && success.result.source === 'dom'); assert.strictEqual(success.result.data, dom);
    assert.equal(success.removed, '');
    const deleted = await route({ ...dom, messages: [], isDeleted: true, error: 'HTTP 404', _debug: { status: 404, isNotFound: true } });
    assert.ok(deleted.result.success && deleted.result.source === 'dom' && '_empty' in deleted.result.data);
    assert.equal(deleted.result.data.isDeleted, true); assert.equal(deleted.result.data.isEmpty, false);
    assert.equal(deleted.removed, 'detail123');
    assert.deepEqual(deleted.result.data._debug.batchexecuteEmptyDebug, { error: 'temporary failure' });
}));

test('messageRouter: confirmed RPC deletion suppresses DOM and preserves deletion evidence', async () => withProvider(async set => {
    set(async () => { throw new Error('rpc error (BardErrorInfo: 1167) inaccessible or deleted'); });
    const { result, removed } = await route(async () => { throw new Error('DOM must not run'); });
    assert.ok(result.success && result.source === 'batchexecute' && '_empty' in result.data);
    assert.equal(result.data.isDeleted, true); assert.equal(removed, 'detail123');
    assert.equal(result.data._debug.isDeleted, true);
}));

test('liveSave: provider and injected acquisition retain title/media/evidence and derive only missing time aliases', async () => withProvider(async set => {
    for (const injected of [false, true]) {
        const payload = detail(); let calledId = '';
        set(async () => { if (injected) throw new Error('provider must not run'); return payload; });
        class Client { async getConversationDetail(id: string) { calledId = id; return payload; } }
        initLive(injected ? { clientClass: Client } : {});
        const before = structuredClone(payload.messages);
        const resolved = await resolveConversationDetail('c_detail123');
        assert.strictEqual(resolved, payload); assert.deepEqual(resolved?.messages, before);
        assert.equal(resolved?.chatTime, 1700000000000); assert.equal(resolved?.timestamp, 1700000000000);
        assert.equal(resolved?.updatedAt, 1700000000000); assert.equal(resolved?.createdAt, null);
        assert.equal(resolved?.titleSource, 'rpc'); assert.strictEqual(resolved?.titles, payload.titles);
        if (injected) assert.equal(calledId, 'detail123');
    }
    const existing = detail(); existing.chatTime = 1600000000000; existing.updatedAt = 1500000000000;
    set(async () => existing); initLive();
    assert.strictEqual(await resolveConversationDetail('detail123'), existing);
    assert.equal(existing.chatTime, 1600000000000); assert.equal(existing.updatedAt, 1500000000000); assert.equal(existing.timestamp, null);
}));

test('liveSave: empty/failed provider and failed injected client still permit DOM acquisition', async () => withProvider(async set => {
    const empty = detail(); empty.messages = [];
    for (const mode of ['empty', 'failed', 'injected']) {
        set(async () => { if (mode === 'empty') return empty; throw new Error('failure'); });
        class Client { async getConversationDetail(): Promise<GeminiProviderConversationDetail> { throw new Error('injected failure'); } }
        initLive({ scraper: { ...DomScraper, parseDoc: () => dom }, ...(mode === 'injected' ? { clientClass: Client } : {}) });
        assert.strictEqual(await resolveConversationDetail('detail123'), dom);
    }
}));
