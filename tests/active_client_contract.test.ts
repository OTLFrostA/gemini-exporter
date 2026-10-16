import { accountRuntime } from './helpers/accountRuntime.js';
import test from 'node:test';
import assert from 'node:assert';
import type { ActiveClientContract } from '../src/content/contentContext.js';
import { ContentContext, contentContext } from '../src/content/contentContext.js';
import { runCleanups } from '../src/content/cleanupRegistry.js';
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
// 2. Runtime regression: the mock Chrome listener and window must be scoped
// to each test; mutating the host globals at module import polluted other tests.
// --------------------------------------------------------------------------
type MessageListener = (msg: any, sender: any, respond: (response: any) => void) => unknown;
type Dispatch = (msg: any) => Promise<any>;

async function withMessageRouter<T>(
    execute: (dispatch: Dispatch, mockWindow: any) => Promise<T>,
    deps: Parameters<typeof initMessageRouter>[0] = {},
): Promise<T> {
    const g = globalThis as any;
    const originalChrome = Object.getOwnPropertyDescriptor(g, 'chrome');
    const originalWindow = Object.getOwnPropertyDescriptor(g, 'window');
    const activeClient = contentContext.getActiveClient();
    const wasAborted = contentContext.isAborted();
    const listeners = new Set<MessageListener>();
    const mockWindow = { __gemExporterCleanups: [] as Array<() => void> } as any;
    const mockChrome = {
        runtime: {
            onMessage: {
                addListener: (fn: MessageListener) => { listeners.add(fn); },
                removeListener: (fn: MessageListener) => { listeners.delete(fn); },
            },
            lastError: null,
            sendMessage: (_msg: any, _cb?: any) => {},
        },
    };
    Object.defineProperty(g, 'chrome', { value: mockChrome, writable: true, configurable: true });
    Object.defineProperty(g, 'window', { value: mockWindow, writable: true, configurable: true });

    const runtime = accountRuntime();
    try {
        contentContext.setActiveClient(null);
        contentContext.setAborted(false);
        initMessageRouter(deps);
        assert.equal(listeners.size, 1, 'test must exercise the actual registered router');
        const dispatch: Dispatch = (msg) => new Promise((resolve, reject) => {
            const listener = [...listeners][0];
            if (!listener) return reject(new Error('No message listener registered'));
            try { listener(msg, {}, resolve); }
            catch (error) { reject(error); }
        });
        return await execute(dispatch, window);
    } finally {
        runCleanups();
        runtime.restore();
        contentContext.setActiveClient(activeClient);
        contentContext.setAborted(wasAborted);
        if (originalWindow) Object.defineProperty(g, 'window', originalWindow);
        else delete g.window;
        if (originalChrome) Object.defineProperty(g, 'chrome', originalChrome);
        else delete g.chrome;
    }
}

test('ActiveClient contract - ContentContext.abort behavior with and without abort()', () => {
    const ctx = new ContentContext();

    let clientAbortCalled = 0;
    const clientWithAbort: ActiveClientContract = {
        abort: () => { clientAbortCalled++; },
    };
    ctx.setActiveClient(clientWithAbort);
    ctx.abort();
    assert.strictEqual(clientAbortCalled, 1, 'client.abort() should be invoked once');
    assert.strictEqual(ctx.isAborted(), true);

    const ctx2 = new ContentContext();
    ctx2.setActiveClient(clientWithoutAbort);
    assert.doesNotThrow(() => ctx2.abort());
    assert.strictEqual(ctx2.isAborted(), true);

    const ctx3 = new ContentContext();
    ctx3.setActiveClient({ abort: () => { throw new Error('Abort failure'); } });
    assert.doesNotThrow(() => ctx3.abort(), 'ContentContext.abort() is best-effort');
    assert.strictEqual(ctx3.isAborted(), true, 'abort state must survive an exception in client.abort()');
});

test('ActiveClient contract - messageRouter stopDeepScan and abortSync handle optional and throwing abort', async () => {
    await withMessageRouter(async (dispatch, mockWindow) => {
        let abortCalls = 0;
        mockWindow.__gemExporterActiveClient = { abort: () => { abortCalls++; } };
        const res1 = await dispatch({ action: 'stopDeepScan' });
        assert.strictEqual(res1.ok, true);
        assert.strictEqual(res1.aborted, true);
        assert.strictEqual(abortCalls, 1, 'the window client must actually receive abort');
        assert.strictEqual(contentContext.isAborted(), true);

        contentContext.setAborted(false);
        mockWindow.__gemExporterActiveClient = clientWithoutAbort;
        const res2 = await dispatch({ action: 'stopDeepScan' });
        assert.strictEqual(res2.ok, true);
        assert.strictEqual(res2.aborted, true);
        assert.strictEqual(contentContext.isAborted(), true);

        contentContext.setAborted(false);
        mockWindow.__gemExporterActiveClient = { abort: () => { throw new Error('Simulated abort crash'); } };
        const res3 = await dispatch({ action: 'abortSync' });
        assert.strictEqual(res3.ok, true);
        assert.strictEqual(res3.aborted, true);
        assert.strictEqual(contentContext.isAborted(), true);
    });
});

test('scan failures, limit, cancellation and completion return an explicit router status', async () => {
    let mode = 'complete';
    const syncEngine = {
        syncConversations: async () => {
            contentContext.setAborted(mode === 'aborted');
            if (mode === 'complete' || mode === 'up_to_date') return { status: mode, count: 3 };
            throw new Error(mode === 'partial_limit' ? 'HTTP 429 rate limit' : 'Injected failure');
        },
    };
    await withMessageRouter(async (dispatch) => {
        for (const status of ['complete', 'up_to_date']) {
            mode = status;
            const response = await dispatch({ action: 'deepScan' });
            assert.strictEqual(response.success, true);
            assert.strictEqual(response.status, status);
            assert.strictEqual(response.count, 3);
        }
        for (const status of ['error', 'aborted', 'partial_limit']) {
            mode = status;
            const response = await dispatch({ action: 'deepScan' });
            assert.strictEqual(response.success, false);
            assert.strictEqual(response.status, status);
            assert.strictEqual(response.hitGoogleLimit, status === 'partial_limit');
        }
    }, { syncEngine: syncEngine as never });
});
