import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { assertRuntimeUnitBoundary } from './helpers/runtimeV2ContractMocks.js';

const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const A = '12345678-1234-4234-8234-123456789abc';
const B = '87654321-4321-4321-8321-cba987654321';
const account = { providerId: 'gemini', accountId: A, slot: 'u0' };
const page = 'https://gemini.google.com/app/abcdef123456';

function load(stubs: Record<string, unknown>) {
    const original = Module._load;
    Module._load = function(request: string, parent: { filename: string }, ...args: unknown[]) {
        const resolved = request.startsWith('.') ? path.resolve(path.dirname(parent.filename), request).replace(/\.ts$/, '.js') : request;
        const key = Object.keys(stubs).find(name => resolved === path.resolve(root, name).replace(/\.ts$/, '.js'));
        if (key) return stubs[key];
        if (request.startsWith('.')) assertRuntimeUnitBoundary(resolved, root);
        return original.call(this, request, parent, ...args);
    };
    try {
        const file = path.resolve(root, 'src/runtime/content/messageRouter.ts');
        delete require.cache[require.resolve(file)];
        return require(file);
    } finally { Module._load = original; }
}

function setup(t: { after: (cleanup: () => void) => void }, overrides: {
    account?: () => Promise<unknown>;
    current?: (account: unknown) => boolean;
    file?: (message: unknown, reply: (value: unknown) => void) => Promise<void>;
    image?: (message: unknown, reply: (value: unknown) => void) => Promise<void>;
} = {}) {
    const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const added: Function[] = [], removed: Function[] = [], cleanups: Array<() => void> = [];
    (globalThis as any).location = { href: page };
    (globalThis as any).chrome = { runtime: {
        id: 'extension',
        onMessage: {
            addListener: (fn: Function) => added.push(fn),
            removeListener: (fn: Function) => removed.push(fn)
        }
    } };
    const assets = { AssetFetcher: {
        handleGetFileBlob: overrides.file || (async (_: unknown, reply: Function) => reply({ success: true, dataBase64: 'AA==', size: 1 })),
        handleGetImageBlob: overrides.image || (async (_: unknown, reply: Function) => reply({ success: true, dataBase64: 'AQ==', size: 1 })),
    } };
    load({
        'src/runtime/content/accountContext.js': {
            resolveCurrentAccount: overrides.account || (async () => account),
            isCurrentAccount: overrides.current || (() => true),
        },
        'src/l1/protocol/gemini/url.js': { extractConversationIdFromUrl: (pathname: string) => pathname.split('/app/')[1]?.split('/')[0] ?? null },
        'src/l1/resources/gemini/assetFetcher.js': assets,
        'src/runtime/content/cleanupRegistry.js': { registerCleanup: (fn: () => void) => { cleanups.push(fn); return () => {}; } },
        'src/shared/utils/constants.js': { getExtensionVersion: () => 'v2' },
    }).init();
    assert.equal(added.length, 1);
    t.after(() => {
        cleanups.forEach(fn => fn());
        if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
        else Reflect.deleteProperty(globalThis, 'chrome');
        if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
        else Reflect.deleteProperty(globalThis, 'location');
    });
    const sender = { id: 'extension' };
    async function request(message: unknown, source: unknown = sender) {
        let calls = 0;
        let finish!: (value: any) => void;
        const done = new Promise<any>(resolve => { finish = resolve; });
        const returned = added[0](message, source, (value: unknown) => { calls++; finish(value); });
        assert.equal(returned, true);
        const value = await done;
        await Promise.resolve();
        assert.equal(calls, 1);
        return value;
    }
    return { request, listener: added[0], removed, cleanups, sender };
}

test('Content IPC only handles the four supported actions, never an old Scan command', t => {
    const { listener, sender } = setup(t);
    for (const action of ['fetchBatch', 'getScrollContainer', 'abortSync', 'deepScan', 'domainStorage', 'notAnAction']) {
        let responses = 0;
        assert.equal(listener({ action }, sender, () => { responses++; }), false);
        assert.equal(responses, 0);
    }
});

test('Ping responds once with version; foreign extension sender fails closed', async t => {
    const { request } = setup(t);
    assert.deepEqual(await request({ action: 'ping' }), { ok: true, version: 'v2' });
    assert.match((await request({ action: 'ping' }, { id: 'foreign' })).error, /Foreign extension sender/);
});

test('Account and current Conversation ID come from the same document URL snapshot', async t => {
    const { request } = setup(t);
    assert.deepEqual(await request({ action: 'getAccountContext' }),
        { ok: true, accountContext: account, conversationId: 'abcdef123456' });
});

test('Navigation during account resolution cannot return a mismatched Tab identity', async t => {
    const { request } = setup(t, {
        account: async () => { (globalThis as any).location.href = 'https://gemini.google.com/app/another123456'; return account; }
    });
    const result = await request({ action: 'getAccountContext' });
    assert.equal(result.ok, false);
    assert.match(result.error, /Page changed/);
});

test('Resource requests are restricted to the current Account and expected HTTPS origins', async t => {
    let calls = 0;
    const { request } = setup(t, { file: async (msg, respond) => {
        calls++;
        assert.deepEqual(msg, { url: 'https://lh3.googleusercontent.com/file.png' });
        respond({ success: true, dataBase64: 'AA==', size: 1 });
    } });
    for (const body of [
        { accountId: B, url: 'https://lh3.googleusercontent.com/file.png' },
        { accountId: A, url: 'https://evil.example/attachment' },
        { accountId: A, url: 'data:image/png;base64,AA==' },
        { accountId: A, url: 'http://lh3.googleusercontent.com/file.png' },
        { accountId: A, url: 'https://google.com.evil.example/file.png' }
    ]) {
        const result = await request({ action: 'getFileBlob', ...body });
        assert.equal(result.ok, false);
        assert.equal(result.success, false);
    }
    assert.equal(calls, 0);
    assert.deepEqual(await request({ action: 'getFileBlob', accountId: A, url: 'https://lh3.googleusercontent.com/file.png' }),
        { success: true, dataBase64: 'AA==', size: 1 });
    assert.equal(calls, 1);
});

test('Resource result is discarded if the account changes during asynchronous acquisition', async t => {
    let current: unknown = account;
    const { request } = setup(t, {
        account: async () => current,
        file: async (_: unknown, reply: (value: unknown) => void) => {
            current = { ...account, accountId: B };
            reply({ success: true, dataBase64: 'SECRET' });
        }
    });
    const response = await request({ action: 'getFileBlob', accountId: A, url: 'https://lh3.googleusercontent.com/file.png' });
    assert.equal(response.ok, false);
    assert.match(response.error, /Account changed/);
    assert.equal('dataBase64' in response, false);
});

test('Resource handler must reply and may never transmit raw bytes or oversized JSON', async t => {
    let result: unknown;
    const { request } = setup(t, { image: async (_: unknown, reply: (value: unknown) => void) => {
        if (result !== undefined) reply(result);
    } });
    const payload = { action: 'getImageBlob', accountId: A, url: 'https://lh3.googleusercontent.com/photo' };
    result = { success: true, dataBuffer: new ArrayBuffer(4) };
    assert.match((await request(payload)).error, /flat JSON/);
    result = { success: true, size: 51 * 1024 * 1024, dataBase64: 'AA==' };
    assert.match((await request(payload)).error, /IPC size limit/);
    result = { success: true, dataBase64: 'AA==' };
    assert.equal((await request(payload)).success, true);
    result = undefined;
    assert.match((await request(payload)).error, /no result/);
});

test('Content handler unregisters exactly its own listener during reinjection cleanup', t => {
    const { listener, cleanups, removed } = setup(t);
    assert.equal(cleanups.length, 1);
    cleanups[0]();
    assert.deepEqual(removed, [listener]);
});

test('Shared multi-platform Content control router answers ping without auth I/O and guards navigation/reinjection races', async t => {
    const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const added: Function[] = [], removed: Function[] = [], cleanups: Array<() => void> = [];
    (globalThis as any).location = {
        href: 'https://chatgpt.com/c/6acffdc5-c4d0-83e8-8e1b-ba60979a618a',
        pathname: '/c/6acffdc5-c4d0-83e8-8e1b-ba60979a618a',
    };
    (globalThis as any).chrome = { runtime: {
        id: 'extension',
        onMessage: { addListener: (fn: Function) => added.push(fn), removeListener: (fn: Function) => removed.push(fn) },
    } };
    t.after(() => {
        cleanups.forEach(fn => fn());
        if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
        else Reflect.deleteProperty(globalThis, 'chrome');
        if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
        else Reflect.deleteProperty(globalThis, 'location');
    });
    let active = true;
    let accountLookups = 0;
    let resolveHook: (() => Promise<string | null>) = async () => { accountLookups++; return A; };
    const originalLoad = Module._load;
    Module._load = function(request: string, parent: { filename: string }, ...args: unknown[]) {
        const resolved = request.startsWith('.') ? path.resolve(path.dirname(parent.filename), request).replace(/\.ts$/, '.js') : request;
        if (resolved === path.resolve(root, 'src/runtime/content/cleanupRegistry.js')) {
            return { registerCleanup: (fn: () => void) => { cleanups.push(fn); return () => {}; } };
        }
        if (resolved === path.resolve(root, 'src/shared/utils/constants.js')) {
            return { getExtensionVersion: () => 'v2' };
        }
        if (request.startsWith('.')) assertRuntimeUnitBoundary(resolved, root);
        return originalLoad.call(this, request, parent, ...args);
    };
    let controlRouter: typeof import('../src/runtime/content/controlRouter.js');
    try {
        const file = path.resolve(root, 'src/runtime/content/controlRouter.ts');
        delete require.cache[require.resolve(file)];
        controlRouter = require(file);
    } finally { Module._load = originalLoad; }

    controlRouter.registerContentControlRouter({
        providerId: 'chatgpt',
        isActive: () => active,
        resolveAccountId: () => resolveHook(),
        conversationIdFromPath: pathname => pathname.split('/c/')[1]?.split('/')[0] ?? null,
    });
    assert.equal(added.length, 1);
    const send = (msg: unknown, sender: unknown = { id: 'extension' }) => new Promise<any>(resolve => {
        assert.equal(added[0](msg, sender, resolve), true);
    });

    // 1. Ping responds immediately without triggering account/session network lookup
    assert.deepEqual(await send({ action: 'ping' }), { ok: true, version: 'v2' });
    assert.equal(accountLookups, 0);

    // 2. Foreign sender fails closed
    assert.match((await send({ action: 'ping' }, { id: 'evil' })).error, /Foreign extension sender/);

    // 3. Atomic URL + Account snapshot succeeds when page is stable
    assert.deepEqual(await send({ action: 'getAccountContext' }), {
        ok: true,
        accountContext: { accountId: A, providerId: 'chatgpt' },
        conversationId: '6acffdc5-c4d0-83e8-8e1b-ba60979a618a',
    });
    assert.equal(accountLookups, 1);

    // 4. SPA navigation mid-resolution rejects instead of pairing old account with new URL
    resolveHook = async () => {
        (globalThis as any).location.href = 'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
        (globalThis as any).location.pathname = '/c/11111111-2222-4333-8444-555555555555';
        return A;
    };
    assert.match((await send({ action: 'getAccountContext' })).error, /Page changed/);

    // 5. Superseded instance rejects after reinjection cleanup
    active = false;
    assert.match((await send({ action: 'getAccountContext' })).error, /superseded/);
    cleanups[0]();
    assert.deepEqual(removed, [added[0]]);
});
