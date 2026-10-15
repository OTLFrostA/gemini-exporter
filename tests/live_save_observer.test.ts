export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const LiveSaveObserver = require('../src/content/liveSaveObserver.js');
const PageObserver = require('../src/content/pageObserver.js');

/** Restore the exact global descriptors even if a test or observer throws. */
async function withHost<T>(overrides: Record<string, unknown>, run: () => T | Promise<T>): Promise<T> {
    const host = globalThis as any;
    const keys = Object.keys(overrides);
    const before = keys.map(key => Object.getOwnPropertyDescriptor(host, key));
    try {
        for (const key of keys) {
            Object.defineProperty(host, key, { value: overrides[key], writable: true, configurable: true });
        }
        return await run();
    } finally {
        LiveSaveObserver.cleanup();
        PageObserver.cleanup();
        keys.forEach((key, i) => {
            if (before[i]) Object.defineProperty(host, key, before[i]);
            else Reflect.deleteProperty(host, key);
        });
    }
}

function fakeWindow() {
    const listeners = new Map<string, Set<(e?: any) => void>>();
    return {
        addEventListener(type: string, cb: (e?: any) => void) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(cb);
        },
        removeEventListener(type: string, cb: (e?: any) => void) { listeners.get(type)?.delete(cb); },
        dispatchEvent(event: Event) {
            for (const listener of listeners.get(event.type) ?? []) listener(event);
            return true;
        },
        count(type: string) { return listeners.get(type)?.size ?? 0; },
    };
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, timeoutMs = 500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('Expected observer callback was never delivered');
        await pause(10);
    }
}

test('liveSaveObserver recognizes visible generation controls but ignores hidden Stop buttons', async () => {
    const visible = new Map<string, any>();
    await withHost({
        document: { querySelector: (selector: string) => visible.get(selector) ?? null },
    }, () => {
        assert.equal(LiveSaveObserver.checkIsGeneratingDOM(), false);
        visible.set('button[aria-label*="Stop"]', { offsetParent: null });
        assert.equal(LiveSaveObserver.checkIsGeneratingDOM(), false,
            'a hidden Stop control must not block a completed turn');
        visible.set('button[aria-label*="Stop"]', { offsetParent: {} });
        assert.equal(LiveSaveObserver.checkIsGeneratingDOM(), true);
        visible.clear();
        visible.set('.streaming', { className: 'streaming' });
        assert.equal(LiveSaveObserver.checkIsGeneratingDOM(), true);
        visible.clear();
        assert.equal(LiveSaveObserver.checkIsGeneratingDOM(), false);
    });
});

test('liveSaveObserver obtains only the active Gemini conversation ID from the URL', async () => {
    const location = { pathname: '/app/82a15f0bc2e' };
    await withHost({ location }, () => {
        assert.equal(LiveSaveObserver.getActiveConversationId(), '82a15f0bc2e');
        location.pathname = '/u/1/app/999abcdef';
        assert.equal(LiveSaveObserver.getActiveConversationId(), '999abcdef');
        location.pathname = '/app';
        assert.equal(LiveSaveObserver.getActiveConversationId(), null);
    });
});

test('liveSaveObserver manual flush and location-change emergency save invoke the registered callback', async () => {
    const win = fakeWindow();
    const completed: Array<{ id: string; reason: string }> = [];
    await withHost({
        window: win,
        document: { querySelector: () => null },
        MutationObserver: class { observe() {} disconnect() {} },
    }, () => {
        LiveSaveObserver.init({
            getActiveId: () => 'manual-chat',
            onTurnComplete: (id: string, reason: string) => completed.push({ id, reason }),
        });
        assert.equal(LiveSaveObserver.isObserverActive(), true);
        assert.equal(win.count('gemini:locationchange'), 1);
        LiveSaveObserver.flushCurrentTurnNow();
        assert.deepEqual(completed, [{ id: 'manual-chat', reason: 'turn_complete' }]);

        LiveSaveObserver.notifyStreamStart('stream-chat');
        win.dispatchEvent(new Event('gemini:locationchange'));
        assert.deepEqual(completed.at(-1), { id: 'stream-chat', reason: 'location_change' });
        LiveSaveObserver.cleanup();
        assert.equal(win.count('gemini:locationchange'), 0);
        assert.equal(LiveSaveObserver.isObserverActive(), false);
        win.dispatchEvent(new Event('gemini:locationchange'));
        assert.equal(completed.length, 2, 'cleanup must remove the emergency save listener');
    });
});

test('liveSaveObserver RPC completion bypasses the configured 500ms DOM debounce', async () => {
    const saves: Array<{ id: string; reason: string }> = [];
    await withHost({
        window: fakeWindow(),
        document: { querySelector: () => null },
        MutationObserver: class { observe() {} disconnect() {} },
    }, async () => {
        LiveSaveObserver.init({
            debounceMs: 500,
            getActiveId: () => 'default-chat',
            onTurnComplete: (id: string, reason: string) => saves.push({ id, reason }),
        });
        LiveSaveObserver.notifyStreamStart('c_stream_123');
        assert.deepEqual(saves, [], 'stream start must not save unfinished content');
        LiveSaveObserver.notifyStreamComplete('c_stream_123');
        await until(() => saves.length > 0, 350);
        assert.deepEqual(saves, [{ id: 'c_stream_123', reason: 'turn_complete' }]);
    });
});

test('liveSaveObserver catches a background DOM transition without animation frames and cancels pending work', async () => {
    let mutate = () => {};
    let generating = false;
    const saves: string[] = [];
    const doc = {
        visibilityState: 'hidden',
        body: null,
        documentElement: null,
        querySelector: (selector: string) =>
            generating && selector === 'button[aria-label*="Stop"]' ? { offsetParent: {} } : null,
    };
    await withHost({
        window: fakeWindow(),
        document: doc,
        location: { href: 'https://gemini.google.com/app/background-chat' },
        history: { pushState() {}, replaceState() {} },
        requestAnimationFrame: () => { throw new Error('Background animation frames cannot drive saving'); },
        MutationObserver: class {
            private connected = false;
            constructor(callback: () => void) { mutate = () => { if (this.connected) callback(); }; }
            observe(target: unknown) { assert.strictEqual(target, doc); this.connected = true; }
            disconnect() { this.connected = false; }
        },
    }, async () => {
        LiveSaveObserver.init({
            debounceMs: 10,
            getActiveId: () => 'background-chat',
            onTurnComplete: (id: string) => saves.push(id),
        });
        PageObserver.init();
        generating = true; mutate();
        await pause(70); // Mutation batching must first observe the generating state.
        generating = false; mutate();
        await until(() => saves.length === 1, 500);
        assert.deepEqual(saves, ['background-chat']);

        LiveSaveObserver.notifyStreamComplete('background-chat');
        LiveSaveObserver.cleanup();
        await pause(120);
        assert.deepEqual(saves, ['background-chat'], 'cleanup must cancel an in-flight RPC save timer');

        LiveSaveObserver.init({
            getActiveId: () => 'background-chat',
            onTurnComplete: (id: string) => saves.push(id),
        });
        generating = true; mutate();
        LiveSaveObserver.cleanup();
        await pause(120);
        assert.deepEqual(saves, ['background-chat'], 'cleanup must also cancel queued DOM mutation callbacks');
    });
});
