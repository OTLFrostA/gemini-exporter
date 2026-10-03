import test from 'node:test';
import assert from 'node:assert';
import type { ActiveClientContract } from '../src/content/contentContext.js';
import { ContentContext } from '../src/content/contentContext.js';
import { init as initMessageRouter } from '../src/content/messageRouter.js';

// --------------------------------------------------------------------------
// 1. Compile-time regression:
// Prove that a valid ActiveClientContract WITHOUT abort() can be assigned
// to window.__gemExporterActiveClient and ContentContext without type error.
// --------------------------------------------------------------------------
const clientWithoutAbort: ActiveClientContract = {
    getAllConversations: async () => [],
    getConversationDetail: async () => ({})
};

const _compileTimeCheck = () => {
    if (typeof window !== 'undefined') {
        window.__gemExporterActiveClient = clientWithoutAbort;
        window.__gemExporterActiveClient = null;
        window.__gemExporterActiveClient = undefined;
    }
    const ctx = new ContentContext();
    ctx.setActiveClient(clientWithoutAbort);
    const retrieved: ActiveClientContract | null = ctx.getActiveClient();
    void retrieved;
};
void _compileTimeCheck;

// --------------------------------------------------------------------------
// 2. Runtime regression:
// --------------------------------------------------------------------------

const listeners: Array<(msg: any, sender: any, sendResponse: any) => any> = [];
if (typeof (global as any).chrome === 'undefined') {
    (global as any).chrome = {
        runtime: {
            onMessage: { addListener: (fn: any) => { listeners.push(fn); } },
            lastError: null,
            sendMessage: (_msg: any, _cb?: any) => {},
        },
    };
} else if (!(global as any).chrome.runtime) {
    (global as any).chrome.runtime = {
        onMessage: { addListener: (fn: any) => { listeners.push(fn); } },
        lastError: null,
        sendMessage: (_msg: any, _cb?: any) => {},
    };
}

function dispatchMessage(msg: any): Promise<any> {
    return new Promise((resolve) => {
        const listener = listeners[listeners.length - 1];
        if (!listener) throw new Error('No message listener registered');
        listener(msg, {}, (res: any) => {
            resolve(res);
        });
    });
}

test('ActiveClient contract - ContentContext.abort behavior with and without abort()', () => {
    const ctx = new ContentContext();

    // Case A: client has abort() -> abort() is called
    let clientAbortCalled = false;
    const clientWithAbort: ActiveClientContract = {
        abort: () => { clientAbortCalled = true; }
    };
    ctx.setActiveClient(clientWithAbort);
    ctx.abort();
    assert.strictEqual(clientAbortCalled, true, 'client.abort() should be called');
    assert.strictEqual(ctx.isAborted(), true);

    // Case B: client does NOT have abort() -> does not throw
    const ctx2 = new ContentContext();
    ctx2.setActiveClient(clientWithoutAbort);
    assert.doesNotThrow(() => {
        ctx2.abort();
    }, 'ContentContext.abort() should not throw when client has no abort method');
    assert.strictEqual(ctx2.isAborted(), true);

    // Case C: client.abort() throws -> exception caught cleanly (best-effort)
    const ctx3 = new ContentContext();
    const failingClient: ActiveClientContract = {
        abort: () => { throw new Error('Abort failure'); }
    };
    ctx3.setActiveClient(failingClient);
    assert.doesNotThrow(() => {
        ctx3.abort();
    }, 'ContentContext.abort() should catch client.abort() errors');
});

test('ActiveClient contract - messageRouter stopDeepScan invokes abort() when present and succeeds when absent', async () => {
    listeners.length = 0;
    initMessageRouter({});

    if (typeof (global as any).window === 'undefined') {
        (global as any).window = {};
    }

    // Case 1: window.__gemExporterActiveClient has abort()
    let abortInvoked = false;
    (global as any).window.__gemExporterActiveClient = {
        abort: () => { abortInvoked = true; }
    };
    const res1 = await dispatchMessage({ action: 'stopDeepScan' });
    assert.strictEqual(res1.ok, true);
    assert.strictEqual(res1.aborted, true);
    assert.strictEqual(abortInvoked, true, 'window.__gemExporterActiveClient.abort() should be called');

    // Case 2: window.__gemExporterActiveClient does NOT have abort()
    (global as any).window.__gemExporterActiveClient = clientWithoutAbort;
    const res2 = await dispatchMessage({ action: 'stopDeepScan' });
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(res2.aborted, true);

    // Case 3: window.__gemExporterActiveClient abort() throws
    (global as any).window.__gemExporterActiveClient = {
        abort: () => { throw new Error('Simulated abort crash'); }
    };
    const res3 = await dispatchMessage({ action: 'abortSync' });
    assert.strictEqual(res3.ok, true);
    assert.strictEqual(res3.aborted, true);

    // Cleanup
    delete (global as any).window.__gemExporterActiveClient;
});
