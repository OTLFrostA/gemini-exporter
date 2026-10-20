import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const A = '12345678-1234-4234-8234-123456789abc';
const B = '87654321-4321-4321-8321-cba987654321';
const accounts: Record<string, unknown> = {
    [A]: { id: A, providerId: 'gemini', providerAccountId: 'gaia-a' },
    [B]: { id: B, providerId: 'gemini', providerAccountId: 'gaia-b' },
};
function load(stubs: Record<string, unknown> = {}) {
    const original = Module._load;
    Module._load = function(request: string, parent: { filename: string }, ...args: unknown[]) {
        const resolved = request.startsWith('.') ? path.resolve(path.dirname(parent.filename), request).replace(/\.ts$/, '.js') : request;
        const key = Object.keys(stubs).find(name => resolved === path.resolve(root, name).replace(/\.ts$/, '.js'));
        if (key) return stubs[key];
        return original.call(this, request, parent, ...args);
    };
    try {
        const file = path.resolve(root, 'src/runtime/capabilities/tabService.ts');
        delete require.cache[require.resolve(file)];
        return require(file);
    } finally { Module._load = original; }
}
function router() {
    return load({
        'src/l3a/storageService.js': { getAccount: async (id: string) => accounts[id] ?? null },
        'src/runtime/api/runtimeReady.js': { ensureV2Ready: async () => {} }
    });
}
function withChrome(t: { after: (fn: () => void) => void }, value: unknown) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    (globalThis as any).chrome = value;
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, 'chrome', descriptor);
        else Reflect.deleteProperty(globalThis, 'chrome');
    });
}

test('Tab routing requires a registered real Account UUID, not a Gemini URL slot', async t => {
    withChrome(t, { runtime: {}, tabs: { query: async () => [{ id: 1 }] } });
    const route = router();
    await assert.rejects(route.getGeminiTab(), /UUID/);
    await assert.rejects(route.resolveAccountTab('u0'), /UUID/);
    await assert.rejects(route.resolveAccountTab('https://gemini.google.com/u/0/app'), /UUID/);
    await assert.rejects(route.resolveAccountTab(B.replace(/.$/, 'x')), /UUID|supported|matches/);
    await assert.rejects(route.getAITab('chatgpt', A), /production Content Script/);
});

test('Verified Provider + Account match wins over first tab or URL slot; active match is preferred', async t => {
    const probes: number[] = [];
    withChrome(t, { runtime: { lastError: null }, tabs: {
        query: async () => [
            { id: 1, active: false, url: 'https://gemini.google.com/u/0/app' },
            { id: 2, active: false, url: 'https://gemini.google.com/u/1/app' },
            { id: 3, active: true, url: 'https://gemini.google.com/u/0/app' }
        ],
        sendMessage: (id: number, message: any, callback: Function) => {
            assert.equal(message.action, 'getAccountContext');
            probes.push(id);
            callback({ ok: true, accountContext: { accountId: id === 1 ? B : A,
                providerId: id === 2 ? 'chatgpt' : 'gemini' } });
        }
    } });
    const route = router();
    assert.equal((await route.resolveAccountTab(A)).id, 3);
    assert.deepEqual(probes, [3]); // matching active tab, no first-tab fallback
    assert.equal((await route.getGeminiTab(A)).id, 3);
});

test('Ambiguous Scan target fails without guessing; explicit preference and a unique live UUID work', async t => {
    let accepted: Record<number, string | null> = { 1: A, 2: B, 3: A };
    withChrome(t, { runtime: { lastError: null }, tabs: {
        query: async () => [{ id: 1 }, { id: 2 }, { id: 3 }],
        sendMessage: (id: number, _: unknown, callback: Function) =>
            callback({ ok: true, accountContext: accepted[id] ? { accountId: accepted[id], providerId: 'gemini' } : null }),
    } });
    const route = router();
    await assert.rejects(route.resolveScanTarget(), /Multiple Gemini accounts/);
    assert.equal(await route.resolveScanTarget(A), A);
    assert.equal(await route.resolveScanTarget(B), B);
    accepted = { 1: A, 2: null, 3: A };
    assert.equal(await route.resolveScanTarget(), A);
    accepted = { 1: null, 2: null, 3: null };
    await assert.rejects(route.resolveScanTarget(), /Open Gemini/);
});

test('Unknown/default source identity is not a Scan target even if Content replies ok', async t => {
    accounts[B] = { id: B, providerId: 'gemini', providerAccountId: 'default' };
    try {
        withChrome(t, { runtime: { lastError: null }, tabs: {
            query: async () => [{ id: 5 }],
            sendMessage: (_: number, __: unknown, cb: Function) => cb({ ok: true, accountContext: { accountId: B, providerId: 'gemini' } })
        } });
        await assert.rejects(router().resolveScanTarget(B), /Open Gemini/);
    } finally { accounts[B] = { id: B, providerId: 'gemini', providerAccountId: 'gaia-b' }; }
});

test('Content operation fixes target Account once and never fails over after send failure', async t => {
    const sends: Array<{ id: number; action: string; accountId?: string }> = [];
    withChrome(t, { runtime: { lastError: null }, tabs: {
        query: async () => [{ id: 9, active: true }, { id: 10 }],
        sendMessage: (id: number, message: any, cb: Function) => {
            sends.push({ id, action: message.action, accountId: message.accountId });
            if (message.action === 'getAccountContext') cb({ ok: true, accountContext: { accountId: A, providerId: 'gemini' } });
            else {
                (globalThis as any).chrome.runtime.lastError = { message: 'Tab navigated' };
                cb(undefined);
                (globalThis as any).chrome.runtime.lastError = null;
            }
        },
    } });
    await assert.rejects(router().sendToGeminiTab({ action: 'getImageBlob', url: 'https://lh3.googleusercontent.com/x' }, A), /Tab navigated/);
    assert.deepEqual(sends.filter(value => value.action === 'getImageBlob'), [{ id: 9, action: 'getImageBlob', accountId: A }]);
    await assert.rejects(router().sendToGeminiTab({ action: 'getImageBlob' }), /UUID/);
    await assert.rejects(router().sendToAITab('chatgpt', { action: 'ping' }, A), /production Content Script/);
});

test('Uninjected/closed tab errors are never successful delivery acknowledgements', async t => {
    withChrome(t, { runtime: { lastError: null }, tabs: {
        query: async () => [{ id: 12 }],
        sendMessage: (_id: number, _msg: unknown, callback: Function) => callback(undefined),
    } });
    const route = router();
    await assert.rejects(route.sendTabMessage(12, { action: 'ping' }, 15), /no response/);
    await assert.rejects(route.resolveAccountTab(A), /No open Provider Tab/);
    assert.equal((await route.checkGeminiStatus(A)).status, 'ERROR');
});

test('Explicit navigation requests only succeed after Background returned ok:true', async t => {
    const seen: unknown[] = [];
    withChrome(t, { runtime: { sendMessage: async (msg: any) => {
        seen.push(msg);
        return msg.action === 'openGeminiPage' ? { ok: true, tabId: 55 } : { ok: false, error: 'Wrong Tab' };
    } } });
    const route = router();
    assert.deepEqual(await route.openGeminiPage(), { ok: true, tabId: 55 });
    await assert.rejects(route.reloadGeminiTab(7), /Wrong Tab/);
    assert.deepEqual(seen, [{ action: 'openGeminiPage' }, { action: 'reloadGeminiTab', tabId: 7 }]);
});
