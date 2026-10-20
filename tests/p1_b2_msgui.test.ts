import { accountRuntime } from './helpers/accountRuntime.js';
export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = (p: string) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
const restoreGlobal = (key: string, descriptor: PropertyDescriptor | undefined) => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
};

// P1-017 retired: same-slot serialization and cancellation have real runtime
// coverage in seam_s2_background_router.test.ts.

// P1-018: narrow static guard only. The full double-response adversarial case
// still needs a production message-router seam; this does not prove behavior.
test('p1_b2 - P1-018: background responder keeps a duplicate-response guard (static)', () => {
    const src = SRC('runtime/background/background.ts');
    assert.ok(src.includes('guardedResponse'), 'guarded response wrapper exists');
    assert.ok(/if \(responded\) return;/.test(src), 'duplicate responses suppressed');
});

// P1-020: exercise the real listener, not the spelling of its null branch.
test('p1_b2 - P1-020: null deepScan result sends a terminal failure', async () => {
    const previousChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    let dispatch: (message: unknown, sender: unknown, respond: (response: any) => void) => unknown =
        () => { throw new Error('message listener was not registered'); };
    Reflect.set(globalThis, 'chrome', {
        runtime: {
            onMessage: {
                addListener: (fn: typeof dispatch) => { dispatch = fn; },
                removeListener: () => {}
            }
        }
    });
    const runtime = accountRuntime();
    try {
        const { init } = require('../src/runtime/content/messageRouter.js');
        let scanResult: any = null;
        init({ syncEngine: { syncConversations: async () => scanResult } });
        const sendScan = () => new Promise<any>(resolve => {
            dispatch({ action: 'deepScan' }, {}, resolve);
        });
        const response = await sendScan();
        assert.strictEqual(response.success, false);
        assert.strictEqual(response.status, 'error');
        assert.strictEqual(response.count, 0);
        assert.match(response.error, /sync did not produce a result/);

        // Positive control: successful scans must not be misclassified as failures.
        scanResult = { status: 'complete', count: 3 };
        const completed = await sendScan();
        assert.strictEqual(completed.success, true);
        assert.strictEqual(completed.status, 'complete');
        assert.strictEqual(completed.count, 3);
    } finally {
        try { require('../src/runtime/content/cleanupRegistry.js').runCleanups(); }
        finally { runtime.restore(); restoreGlobal('chrome', previousChrome); }
    }
});

// P1-021: failure during constructor must release the UI running state.
test('p1_b2 - P1-021: constructor failure resets export UI state', async () => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Reflect.set(globalThis, 'document', { getElementById: () => null });
    const rateLimitModule = require('../src/l1/client/rateLimiter.js');
    const originalClass = rateLimitModule.RateLimitManager;
    const { ExportController } = require('../src/ui/options/controllers/exportController.js');
    try {
        rateLimitModule.RateLimitManager = undefined;
        await assert.rejects(
            () => ExportController.runExport({ selected: [], format: 'markdown' }, {}),
            /RateLimitModule missing/
        );
        assert.strictEqual(ExportController.isRunning(), false);
        assert.strictEqual(ExportController.getActiveEngine(), null);
    } finally {
        rateLimitModule.RateLimitManager = originalClass;
        restoreGlobal('document', previousDocument);
    }
});

// P1-024 remains a source-level guard: the LRU/TTL map is private to syncEngine.
// Presence checks do NOT prove eviction behavior.
test('p1_b2 - P1-024: lastTouched map has a cap and TTL (static)', () => {
    const src = SRC('content/syncEngine.ts');
    assert.ok(src.includes('LAST_TOUCHED_MAX_ENTRIES'), 'max entries cap exists');
    assert.ok(src.includes('LAST_TOUCHED_TTL_MS'), 'TTL exists');
    assert.ok(src.includes('pruneLastTouchedMap'), 'prune function exists');
});

// P1-025: duplicate initialization must not install duplicate listeners.
test('p1_b2 - P1-025: live-save observer removes listeners on re-init and cleanup', () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalMutationObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
    const listeners = new Map<string, Set<Function>>();
    const count = (event: string) => listeners.get(event)?.size ?? 0;
    Reflect.set(globalThis, 'window', {
        addEventListener: (event: string, fn: Function) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)!.add(fn);
        },
        removeEventListener: (event: string, fn: Function) => listeners.get(event)?.delete(fn)
    });
    Reflect.set(globalThis, 'document', { querySelector: () => null });
    Reflect.set(globalThis, 'MutationObserver', class { observe() {} disconnect() {} });
    const observer = require('../src/runtime/content/liveSaveObserver.js');
    const observedEvents = ['gemini:locationchange', 'popstate', 'beforeunload'];
    try {
        observer.init({ getActiveId: () => 'c1' });
        assert.deepStrictEqual(observedEvents.map(count), [1, 1, 1]);
        observer.init({ getActiveId: () => 'c1' });
        assert.deepStrictEqual(observedEvents.map(count), [1, 1, 1]);
        observer.cleanup();
        assert.deepStrictEqual(observedEvents.map(count), [0, 0, 0]);
    } finally {
        try { observer.cleanup(); }
        finally {
            restoreGlobal('window', originalWindow);
            restoreGlobal('document', originalDocument);
            restoreGlobal('MutationObserver', originalMutationObserver);
        }
    }
});

// P1-028 remains a static presence check until the hook's streaming reader
// can be tested through a small behavioral seam.
test('p1_b2 - P1-028: capped response reader is wired (static)', () => {
    const src = SRC('l1/sniffer/gemini/hookCredentials.ts');
    assert.ok(src.includes('readCappedText'), 'capped reader exists');
    assert.ok(src.includes('BATCHEXECUTE_SNIFF_CAP'), 'cap constant exists');
});

// P1-030 remains a static presence check; this does NOT verify that the
// background IPC path rejects oversized payloads without sending them.
test('p1_b2 - P1-030: live-save payload size guard is wired (static)', () => {
    const src = SRC('runtime/content/liveSaveCoordinator.ts');
    assert.ok(src.includes('LIVE_SAVE_PAYLOAD_CAP'), 'payload cap exists');
    assert.ok(src.includes('payload_too_large'), 'too-large warning type exists');
});
