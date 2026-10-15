export {};
const test = require('node:test');
const assert = require('node:assert');

test('PageObserver re-init clears the old interval and listeners, then cleanup clears the new ones', () => {
    const keys = ['window', 'document', 'history', 'location', 'setInterval', 'clearInterval', 'clearTimeout'];
    const originals = new Map<string, PropertyDescriptor | undefined>(
        keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
    );
    const restore = () => {
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    };
    const listeners = new Map<string, Set<Function>>();
    const activeListenerCount = (type: string) => listeners.get(type)?.size ?? 0;
    // Model active timers; either clearInterval or clearTimeout may cancel an interval.
    const activeIntervals = new Map<number, Function>();
    let nextInterval = 1;
    Reflect.set(globalThis, 'setInterval', (fn: Function) => {
        const handle = nextInterval++;
        activeIntervals.set(handle, fn);
        return handle;
    });
    const cancelTimer = (handle: number) => { activeIntervals.delete(handle); };
    Reflect.set(globalThis, 'clearInterval', cancelTimer);
    Reflect.set(globalThis, 'clearTimeout', cancelTimer);
    Reflect.set(globalThis, 'window', {
        addEventListener: (type: string, fn: Function) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(fn);
        },
        removeEventListener: (type: string, fn: Function) => listeners.get(type)?.delete(fn),
        dispatchEvent: () => {}
    });
    Reflect.set(globalThis, 'document', { querySelector: () => null, getElementById: () => null });
    Reflect.set(globalThis, 'history', { pushState: () => {}, replaceState: () => {} });
    Reflect.set(globalThis, 'location', { href: 'https://gemini.google.com/app', pathname: '/app' });

    let observer: { init: (options?: { onSync?: () => void }) => unknown; cleanup: () => void } | null = null;
    try {
        observer = require('../src/content/pageObserver.js');
        observer!.init();
        const first = (globalThis as any).window.__gemExporterSyncInterval;
        assert.ok(first, 'first init must register a periodic sync interval');
        assert.strictEqual(activeIntervals.size, 1);
        assert.strictEqual(activeListenerCount('popstate'), 1);
        assert.strictEqual(activeListenerCount('gemini:locationchange'), 1);

        observer!.init();
        const second = (globalThis as any).window.__gemExporterSyncInterval;
        assert.ok(second, 'second init must register a periodic sync interval');
        assert.notStrictEqual(second, first);
        assert.strictEqual(activeIntervals.has(first), false, 'the old interval must be cancelled');
        assert.strictEqual(activeIntervals.has(second), true);
        assert.strictEqual(activeIntervals.size, 1, 're-init must not leak an interval');
        assert.strictEqual(activeListenerCount('popstate'), 1, 'no duplicate popstate listener');
        assert.strictEqual(activeListenerCount('gemini:locationchange'), 1, 'no duplicate route listener');

        observer!.cleanup();
        assert.strictEqual(activeIntervals.size, 0, 'cleanup must cancel the remaining interval');
        assert.strictEqual((globalThis as any).window.__gemExporterSyncInterval, null);
        assert.strictEqual(activeListenerCount('popstate'), 0);
        assert.strictEqual(activeListenerCount('gemini:locationchange'), 0);
    } finally {
        try { observer?.cleanup(); }
        finally { restore(); }
    }
});
