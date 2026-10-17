import { useAccountRuntime } from './helpers/accountRuntime.js';
useAccountRuntime();
import test from 'node:test';
import assert from 'node:assert';

// S1: content messageRouter fail-closed + exactly-once responder.

const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const listeners: Array<(msg: any, sender: any, sendResponse: any) => any> = [];
(global as any).chrome = {
    runtime: {
        onMessage: { addListener: (fn: any) => { listeners.push(fn); } },
        lastError: null,
        sendMessage: (_msg: any, _cb?: any) => {},
    },
};

const { init } = require('../src/content/messageRouter.ts');
const { ProviderRegistry } = require('../src/core/provider/providerRegistry.ts');
test.after(() => {
    listeners.length = 0;
    if (chromeDescriptor) Object.defineProperty(globalThis, 'chrome', chromeDescriptor);
    else Reflect.deleteProperty(globalThis, 'chrome');
});

function lastListener() {
    return listeners[listeners.length - 1];
}

async function dispatch(msg: any, waitMs = 2000): Promise<{ responses: any[]; returned: any }> {
    const responses: any[] = [];
    const returned = lastListener()(msg, {}, (r: any) => { responses.push(r); });
    const deadline = Date.now() + waitMs;
    while (responses.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
    }
    // Give exactly-once guard a chance to (incorrectly) fire twice.
    await new Promise((r) => setTimeout(r, 50));
    return { responses, returned };
}

function freshInit(deps: any) {
    listeners.length = 0;
    init(deps);
}

test('S1 - ping responds exactly once with ok:true', async () => {
    freshInit({});
    const { responses } = await dispatch({ action: 'ping' });
    assert.strictEqual(responses.length, 1, 'exactly one response');
    assert.strictEqual(responses[0].ok, true);
});

test('S1 - synchronous throw in dispatch becomes a structured failure, not a hang', async () => {
    freshInit({
        scraper: { getScrollContainer: () => { throw new Error('boom'); } },
    });
    const { responses } = await dispatch({ action: 'getScrollContainer' });
    assert.strictEqual(responses.length, 1, 'exactly one response despite throw');
    const r = responses[0];
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.success, false);
    assert.ok(String(r.error).includes('boom'), `error mentions cause, got: ${r.error}`);
});

test('S1 - unknown action is a structured failure', async () => {
    freshInit({});
    const { responses } = await dispatch({ action: 'noSuchAction' });
    assert.strictEqual(responses.length, 1);
    assert.strictEqual(responses[0].ok, false);
    assert.strictEqual(responses[0].success, false);
    assert.ok(String(responses[0].error).includes('unknown action'));
});

test('S1 - getConversationDetail with no provider result and no scraper fails closed', async () => {
    // Make the default provider resolve to "no detail" without network.
    const provider = ProviderRegistry.getDefault();
    assert.ok(provider, 'default provider registered');
    const orig = provider.fetchConversationDetail;
    provider.fetchConversationDetail = async () => null;
    try {
        freshInit({ syncEngine: null, scraper: null, assets: null, storage: null });
        const { responses } = await dispatch({ action: 'getConversationDetail', conversationId: 'c_123' });
        assert.strictEqual(responses.length, 1, 'port must not hang when no fetch path exists');
        const r = responses[0];
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.success, false);
        assert.match(String(r.error), /conversation detail unavailable/, 'missing acquisition paths fail closed with a useful reason');
    } finally {
        provider.fetchConversationDetail = orig;
    }
});

test('S1 - getConversationDetail intercepts BardErrorInfo 1167 directly without falling back to DOM scraper', async () => {
    const provider = ProviderRegistry.getDefault();
    assert.ok(provider, 'default provider registered');
    const orig = provider.fetchConversationDetail;
    provider.fetchConversationDetail = async () => {
        throw new Error('rpc error (BardErrorInfo: 1167) inaccessible or deleted');
    };
    let scraperCalled = false;
    let prunedId = '';
    let availability = '';
    const mockStorage = {
        updateConversation: async (_slot: string, _id: string, patch: { cloudAvailability: string }) => { availability = patch.cloudAvailability; },
        removeConversation: async (_slot: string, id: string) => {
            prunedId = id;
        },
        getLastSync: async () => ({ count: 0 }),
        getConversations: async () => []
    };
    try {
        freshInit({
            syncEngine: null,
            scraper: {
                contentFetchChatDetail: async () => {
                    scraperCalled = true;
                    return { id: 'c_del_123', messages: [] };
                }
            },
            assets: null,
            storage: mockStorage,
        });
        const { responses } = await dispatch({ action: 'getConversationDetail', conversationId: 'c_del_123' });
        assert.strictEqual(responses.length, 1, 'exactly one response');
        assert.strictEqual(scraperCalled, false, 'Must NOT fall back to DOM scraper when cloud confirms deletion');
        assert.strictEqual(prunedId, '', 'Cloud deletion must retain local archive');
        assert.strictEqual(availability, 'deleted');
        const r = responses[0];
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.data.isDeleted, true);
        assert.strictEqual(r.data.id, 'c_del_123');
    } finally {
        provider.fetchConversationDetail = orig;
    }
});


for (const failure of ['HTTP 401', 'HTTP 403', 'HTTP 429', 'request timeout', 'parse error']) {
    test('S1 - non-deletion error retains archive and does not mark deleted: ' + failure, async () => {
        const provider = ProviderRegistry.getDefault();
        const original = provider.fetchConversationDetail;
        provider.fetchConversationDetail = async () => { throw new Error(failure); };
        let marked = false;
        let removed = false;
        try {
            freshInit({ syncEngine: null, assets: null,
                storage: { updateConversation: async () => { marked = true; }, removeConversation: async () => { removed = true; } },
                scraper: { contentFetchChatDetail: async () => ({ id: 'auth_failure', error: failure, isDeleted: false }) }
            });
            const { responses } = await dispatch({ action: 'getConversationDetail', conversationId: 'auth_failure', accountSlot: '10000000-0000-4000-8000-000000000002' });
            assert.equal(responses.length, 1);
            assert.equal(responses[0].data.isDeleted, false);
            assert.equal(responses[0].data.isEmpty, true, 'transient failures do not imply a deleted cloud conversation');
            assert.equal(marked, false);
            assert.equal(removed, false);
        } finally { provider.fetchConversationDetail = original; }
    });
}

test('S1 - cloud availability write failure retains deletion evidence without deleting archive or hanging', async () => {
    const provider = ProviderRegistry.getDefault(); const original = provider.fetchConversationDetail;
    provider.fetchConversationDetail = async () => { throw new Error('HTTP 404'); };
    let removed = false;
    try {
        freshInit({ syncEngine: null, scraper: null, assets: null,
            storage: { updateConversation: async () => { throw new Error('quota failure'); }, removeConversation: async () => { removed = true; } } });
        const { responses } = await dispatch({ action: 'getConversationDetail', conversationId: 'write_fail' });
        assert.equal(responses.length, 1); assert.equal(responses[0].success, true);
        assert.equal(responses[0].data.isDeleted, true); assert.equal(removed, false);
    } finally { provider.fetchConversationDetail = original; }
});

for (const failure of ['memory', 'ui-throw', 'ui-reject']) {
    test('S1 - deletion side effects remain independent: ' + failure, async () => {
        const provider = ProviderRegistry.getDefault(); const original = provider.fetchConversationDetail;
        const originalSend = chrome.runtime.sendMessage;
        const originalWarn = console.warn;
        const warnings: unknown[][] = [];
        const order: string[] = [];
        provider.fetchConversationDetail = async () => { throw new Error('HTTP 404'); };
        console.warn = (...args: unknown[]) => { warnings.push(args); };
        Reflect.set(chrome.runtime, 'sendMessage', (message: {action:string}) => {
            if (message.action === 'accountRegistry') return Reflect.apply(originalSend, chrome.runtime, [message]);
            order.push('ui');
            if (failure === 'ui-throw') throw new Error('UI unavailable');
            if (failure === 'ui-reject') return Promise.reject(new Error('UI unavailable'));
        });
        try {
            freshInit({ assets: null, scraper: null,
                syncEngine: { markConfirmedDeleted: () => {
                    order.push('memory');
                    if (failure === 'memory') throw new Error('Memory marker unavailable');
                } },
                storage: { updateConversation: async () => { order.push('storage'); throw new Error('quota failure'); } }
            });
            const { responses } = await dispatch({ action: 'getConversationDetail', conversationId: 'isolated_deletion' });
            assert.equal(responses.length, 1); assert.equal(responses[0].success, true);
            assert.equal(responses[0].data.isDeleted, true);
            assert.deepEqual(order, ['memory', 'storage', 'ui']);
            assert.match(warnings.map(args => args.join(' ')).join(' '), /quota failure/);
            if (failure === 'memory') assert.match(warnings.map(args => args.join(' ')).join(' '), /Memory marker unavailable/);
        } finally {
            provider.fetchConversationDetail = original;
            chrome.runtime.sendMessage = originalSend;
            console.warn = originalWarn;
        }
    });
}
