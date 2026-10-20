import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const uuid = '12345678-1234-4234-8234-123456789abc';
const account = { id: uuid, providerId: 'gemini', providerAccountId: 'gaia' };
const sender = { id: 'ext', tab: { id: 7 }, frameId: 0, url: 'https://gemini.google.com/app' };
function load(file: string, stubs: Record<string, unknown>) {
    const original = Module._load;
    Module._load = function(request: string, parent: { filename: string }, ...args: unknown[]) {
        const resolved = request.startsWith('.') ? path.resolve(path.dirname(parent.filename), request).replace(/\.ts$/, '.js') : request;
        const key = Object.keys(stubs).find(key => resolved === path.resolve(root, key).replace(/\.ts$/, '.js'));
        if (key) return stubs[key];
        return original.call(this, request, parent, ...args);
    };
    try {
        const filename = path.resolve(root, file);
        delete require.cache[require.resolve(filename)];
        return require(filename);
    } finally { Module._load = original; }
}
const chromeBase = () => ({ runtime: { id: 'ext' }, tabs: { sendMessage: (_id: unknown, _message: unknown, _options: unknown, callback: Function) => callback({ ok: true, accountContext: { accountId: uuid, providerId: 'gemini' } }) } });
const ready = { ensureV2Ready: async () => {} };
const storage = { getAccount: async () => account };
const security = () => load('src/runtime/background/contentSender.ts', { 'src/l3a/storageService.js': storage });
async function invoke(handler: Function, message: unknown, origin: unknown = sender) {
    let count = 0;
    let finish: (value: any) => void = () => {};
    const response = new Promise<any>(resolve => { finish = resolve; });
    assert.equal(handler(message, origin, (value: unknown) => { count++; finish(value); }), true);
    const result = await response;
    await Promise.resolve();
    assert.equal(count, 1);
    return result;
}

test('ingestion awaits L2 commit, forwards empty terminal page and never writes Storage directly', async () => {
    global.chrome = chromeBase() as any;
    let commit!: () => void;
    let args: unknown[] = [];
    const gate = new Promise<void>(resolve => { commit = resolve; });
    const { handleDomainIngestionMessage: handle } = load('src/runtime/background/domainStorageHandler.ts', {
        'src/runtime/background/readiness.js': ready, 'src/runtime/background/contentSender.js': security(),
        'src/l2/ingestion.js': { ingestIndexes: async (...values: unknown[]) => { args = values; await gate; } },
    });
    const page = { streamId: 'recent', requestCursor: 'last', nextCursor: null };
    let answered = false;
    const result = invoke(handle, { action: 'domainIngest', operation: 'indexes', accountId: uuid, items: [], page }).then(value => { answered = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(answered, false);
    assert.deepEqual(args, [uuid, [], page]);
    commit();
    assert.deepEqual(await result, { ok: true });
});

test('ingestion preserves Detail and Index facts; reports L2 errors', async () => {
    global.chrome = chromeBase() as any;
    let seen: unknown[] = [];
    const handle = load('src/runtime/background/domainStorageHandler.ts', {
        'src/runtime/background/readiness.js': ready, 'src/runtime/background/contentSender.js': security(),
        'src/l2/ingestion.js': { ingestDetail: async (...args: unknown[]) => { seen = args; throw new Error('commit failed'); } },
    }).handleDomainIngestionMessage;
    const detail = { quality: { status: 'partial' } }, indexFields = { title: 'a' };
    assert.deepEqual(await invoke(handle, { action: 'domainIngest', operation: 'detail', accountId: uuid, conversationId: 'abc', detail, indexFields }), { ok: false, error: 'commit failed' });
    assert.deepEqual(seen, [uuid, 'abc', detail, indexFields]);
    assert.equal(handle({ action: 'domainStorage' }, sender, () => assert.fail()), false);
});

test('Background returns the full Detail admission result only after L2 commits', async () => {
    global.chrome = chromeBase() as any;
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const handle = load('src/runtime/background/domainStorageHandler.ts', {
        'src/runtime/background/readiness.js': ready, 'src/runtime/background/contentSender.js': security(),
        'src/l2/ingestion.js': { ingestDetail: async () => { await gate; return { accepted: true, changed: false }; } },
    }).handleDomainIngestionMessage;
    let returned = false;
    const response = invoke(handle, { action: 'domainIngest', operation: 'detail',
        accountId: uuid, conversationId: 'abc', detail: {} }).then((value: unknown) => { returned = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(returned, false);
    finish();
    assert.deepEqual(await response, { ok: true, result: { accepted: true, changed: false } });
});

test('Background deletion awaits L2 commit, rejects default identity and propagates failure', async () => {
    global.chrome = chromeBase() as any;
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    let calls = 0;
    const handle = load('src/runtime/background/domainStorageHandler.ts', {
        'src/runtime/background/readiness.js': ready, 'src/runtime/background/contentSender.js': security(),
        'src/l2/ingestion.js': { ingestDeletedConversation: async (accountId: string, id: string) => {
            calls++; assert.equal(accountId, uuid); assert.equal(id, 'abcdef123456'); await gate;
        } },
    }).handleDomainIngestionMessage;
    let responded = false;
    const result = invoke(handle, { action: 'domainIngest', operation: 'deleted', accountId: uuid, conversationId: 'abcdef123456' })
        .then(value => { responded = true; return value; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(responded, false);
    finish(); assert.deepEqual(await result, { ok: true }); assert.equal(calls, 1);
    const denied = load('src/runtime/background/domainStorageHandler.ts', {
        'src/runtime/background/readiness.js': ready,
        'src/runtime/background/contentSender.js': { assertContentSender() {}, object: (value: unknown) => value,
            requireContentAccount: async () => ({ ...account, providerAccountId: 'default' }) },
        'src/l2/ingestion.js': { ingestDeletedConversation: () => assert.fail('default cannot delete') },
    }).handleDomainIngestionMessage;
    assert.equal((await invoke(denied, { action: 'domainIngest', operation: 'deleted', accountId: uuid, conversationId: 'abcdef123456' })).ok, false);
});

test('ingestion rejects foreign, unsupported, subframe and malformed requests', async () => {
    global.chrome = chromeBase() as any;
    let calls = 0;
    const handle = load('src/runtime/background/domainStorageHandler.ts', {
        'src/runtime/background/readiness.js': ready, 'src/runtime/background/contentSender.js': security(),
        'src/l2/ingestion.js': { ingestIndexes: async () => { calls++; } },
    }).handleDomainIngestionMessage;
    const message = { action: 'domainIngest', operation: 'indexes', accountId: uuid, items: [] };
    for (const origin of [{ ...sender, id: 'other' }, { ...sender, tab: undefined }, { ...sender, url: 'https://chatgpt.com/' }, { ...sender, frameId: 1 }]) {
        assert.equal((await invoke(handle, message, origin)).ok, false);
    }
    for (const patch of [{ accountId: 'u0' }, { items: {} }, { items: [{ conversationId: '', fields: {} }] }, { operation: 'write' }]) {
        assert.equal((await invoke(handle, { ...message, ...patch })).ok, false);
    }
    assert.equal(calls, 0);
});

test('provider mismatch is rejected before L2 admission', async () => {
    global.chrome = chromeBase() as any;
    const guard = load('src/runtime/background/contentSender.ts', { 'src/l3a/storageService.js': { getAccount: async () => ({ ...account, providerId: 'chatgpt' }) } });
    await assert.rejects(guard.requireContentAccount(sender, uuid), /mismatch/);
});

test('Content ingestion sends only JSON facts and propagates worker failure', async () => {
    global.location = { protocol: 'https:' } as any;
    let sent: unknown;
    global.chrome = { runtime: { sendMessage: async (message: unknown) => { sent = message; return { ok: false, error: 'L2 rejected' }; } } } as any;
    const api = load('src/runtime/api/domainIngestion.ts', { 'src/l2/ingestion.js': {}, 'src/runtime/api/runtimeReady.js': ready });
    await assert.rejects(api.ingestIndexes(uuid, []), /L2 rejected/);
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), { action: 'domainIngest', operation: 'indexes', accountId: uuid, items: [] });
});

test('Content ingestion preserves the full accepted/changed result from the worker', async () => {
    global.location = { protocol: 'https:' } as any;
    global.chrome = { runtime: { sendMessage: async () => ({ ok: true, result: { accepted: true, changed: true } }) } } as any;
    const api = load('src/runtime/api/domainIngestion.ts', { 'src/l2/ingestion.js': {},
        'src/runtime/api/runtimeReady.js': ready });
    assert.deepEqual(await api.ingestDetail(uuid, 'abc', {}), { accepted: true, changed: true });
    global.chrome = { runtime: { sendMessage: async () => ({ ok: true, result: { accepted: false, changed: false } }) } } as any;
    assert.deepEqual(await api.ingestDetail(uuid, 'abc', {}), { accepted: false, changed: false });
    global.chrome = { runtime: { sendMessage: async () => ({ ok: true, changed: true }) } } as any;
    await assert.rejects(api.ingestDetail(uuid, 'abc', {}), /Invalid committed/);
    global.chrome = { runtime: { sendMessage: async () => ({ ok: true, result: { accepted: false, changed: true } }) } } as any;
    await assert.rejects(api.ingestDetail(uuid, 'abc', {}), /Invalid committed/);
});

test('Extension ingestion calls the same L2 function after readiness', async () => {
    global.location = { protocol: 'chrome-extension:' } as any;
    const order: string[] = [];
    const api = load('src/runtime/api/domainIngestion.ts', {
        'src/l2/ingestion.js': { ingestDetail: async () => { order.push('L2'); return { accepted: true, changed: true }; } },
        'src/runtime/api/runtimeReady.js': { ensureV2Ready: async () => { order.push('ready'); } },
    });
    assert.deepEqual(await api.ingestDetail(uuid, 'abc', {}), { accepted: true, changed: true });
    assert.deepEqual(order, ['ready', 'L2']);
});

function live(settings: object, permission = 'granted', handleExists = true, exporter?: Function) {
    return load('src/runtime/background/liveSaveHandler.ts', {
        'src/application/settings/index.js': { getSettings: async () => settings },
        'src/l3a/storageService.js': { getDirectoryHandle: async () => handleExists ? { queryPermission: async (options: unknown) => { assert.deepEqual(options, { mode: 'readwrite' }); return permission; } } : null },
        'src/application/export/runExport.js': { runExport: exporter || (() => assert.fail('Unexpected Export')) },
    }).runLiveSave;
}
test('disabled and non-Markdown Live Save return null without exporting', async () => {
    const key = { accountId: uuid, conversationId: 'abc' };
    assert.equal(await live({ enabledDisk: false })(key), null);
    assert.equal(await live({ enabledDisk: true, defaultFormat: 'pdf' })(key), null);
});
test('missing directory or lost permission fails without requesting permission or changing Settings', async () => {
    const settings = { enabledDisk: true, defaultFormat: 'markdown' };
    const key = { accountId: uuid, conversationId: 'abc' };
    await assert.rejects(live(settings, 'granted', false)(key), /directory/);
    for (const permission of ['prompt', 'denied']) await assert.rejects(live(settings, permission)(key), /Reauthorize/);
    assert.deepEqual(settings, { enabledDisk: true, defaultFormat: 'markdown' });
});
test('Live Save returns the exact unified result and request, including skip/partial/abort', async () => {
    const key = { accountId: uuid, conversationId: 'abc' };
    const result = { exported: 0, skipped: 1, partial: 1, failed: [key], aborted: true };
    const save = live({ enabledDisk: true, defaultFormat: 'markdown', includeAssets: false }, 'granted', true, async (request: unknown) => {
        assert.deepEqual(request, { keys: [key], format: 'markdown', delivery: 'folderWriter', includeAssets: false, skipUnchanged: false });
        return result;
    });
    assert.equal(await save(key), result);
});

test('routing matches Provider and UUID, prefers matching active Tab, and never retries a different Tab after dispatch', async () => {
    const sent: any[] = [];
    global.chrome = { runtime: { id: 'ext' }, tabs: {
        query: async () => [{ id: 1, active: true }, { id: 2 }, { id: 3, active: true }],
        sendMessage: (id: number, message: any, callback: Function) => {
            sent.push({ id, message });
            if (message.action === 'getAccountContext') callback({ ok: true, accountContext: { accountId: id === 1 ? 'other' : uuid, providerId: 'gemini' } });
            else { Reflect.set(chrome.runtime, 'lastError', { message: 'Tab navigated' }); callback(); Reflect.deleteProperty(global.chrome.runtime, 'lastError'); }
        },
    } } as any;
    const routing = load('src/runtime/capabilities/tabService.ts', { 'src/l3a/storageService.js': storage, 'src/runtime/api/runtimeReady.js': ready });
    assert.equal((await routing.resolveAccountTab(uuid)).id, 3);
    await assert.rejects(routing.sendToGeminiTab({ action: 'getFileBlob' }, uuid), /Tab navigated/);
    assert.equal(sent.filter(value => value.message.action === 'getFileBlob').length, 1);
    assert.equal(sent.at(-1).message.accountId, uuid);
    await assert.rejects(routing.getGeminiTab(), /UUID/);
    await assert.rejects(routing.resolveAccountTab('u0'), /UUID/);
    await assert.rejects(routing.getAITab('chatgpt', uuid), /production/);
});
test('routing rejects matching UUID from wrong Provider and uninjected Tabs', async () => {
    global.chrome = { runtime: {}, tabs: { query: async () => [{ id: 1 }], sendMessage: (_: unknown, __: unknown, cb: Function) => cb({ ok: true, accountContext: { accountId: uuid, providerId: 'chatgpt' } }) } } as any;
    const routing = load('src/runtime/capabilities/tabService.ts', { 'src/l3a/storageService.js': storage, 'src/runtime/api/runtimeReady.js': ready });
    await assert.rejects(routing.resolveAccountTab(uuid), /No open/);
});

test('readiness shares one pending upgrade and retries failures', async () => {
    let calls = 0;
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const runtime = load('src/runtime/background/readiness.ts', { 'src/migration/upgradeV1.js': { ensureUpgraded: () => { calls++; return gate; } } });
    const first = runtime.ensureV2Ready();
    assert.equal(first, runtime.ensureV2Ready());
    assert.equal(calls, 1); finish(); await first;
    let attempts = 0;
    const retry = load('src/runtime/background/readiness.ts', { 'src/migration/upgradeV1.js': { ensureUpgraded: async () => { if (++attempts === 1) throw new Error('upgrade failed'); } } });
    await assert.rejects(retry.ensureV2Ready(), /upgrade failed/);
    await retry.ensureV2Ready();
    assert.equal(attempts, 2);
});

function contentWindow() {
    const target = new EventTarget();
    return Object.assign(target, { __gemExporterCleanups: [] as Function[] });
}
test('Content router pairs Account and conversation in one read and rejects account changes', async () => {
    global.location = { href: 'https://gemini.google.com/app/abcdef123456' } as any;
    global.window = contentWindow() as any;
    let listener!: Function;
    global.chrome = { runtime: { id: 'ext', onMessage: { addListener: (fn: Function) => { listener = fn; }, removeListener: () => {} } } } as any;
    const context = { accountId: uuid, providerId: 'gemini', slot: 'u0' };
    const router = load('src/runtime/content/messageRouter.ts', {
        'src/runtime/content/accountContext.js': { resolveCurrentAccount: async () => context, isCurrentAccount: () => true },
        'src/runtime/capabilities/assetFetcher.js': { AssetFetcher: {} },
    });
    router.init();
    assert.deepEqual(await invoke(listener, { action: 'getAccountContext' }), { ok: true, accountContext: context, conversationId: 'abcdef123456' });
    assert.equal((await invoke(listener, { action: 'getFileBlob', accountId: 'other', url: 'https://lh3.googleusercontent.com/a' })).ok, false);
    assert.equal((await invoke(listener, { action: 'getFileBlob', accountId: uuid, url: 'https://evil.test/a' })).ok, false);
    assert.equal(listener({ action: 'deepScan' }, sender, () => assert.fail()), false);
    assert.equal((await invoke(listener, { action: 'getAccountContext' }, { id: 'foreign' })).ok, false);
    const changed = load('src/runtime/content/messageRouter.ts', {
        'src/runtime/content/accountContext.js': { resolveCurrentAccount: async () => { global.location.href = 'https://gemini.google.com/app/other'; return context; }, isCurrentAccount: () => true },
        'src/runtime/capabilities/assetFetcher.js': { AssetFetcher: {} },
    });
    changed.init();
    assert.equal((await invoke(listener, { action: 'getAccountContext' })).ok, false);
});

test('resource router checks Account after completion and answers exactly once', async () => {
    global.location = { href: 'https://gemini.google.com/app/abcdef123456' } as any;
    global.window = contentWindow() as any;
    let listener!: Function;
    global.chrome = { runtime: { id: 'ext', onMessage: { addListener: (fn: Function) => { listener = fn; }, removeListener: () => {} } } } as any;
    const context = { accountId: uuid, providerId: 'gemini', slot: 'u0' };
    let changed = false;
    load('src/runtime/content/messageRouter.ts', {
        'src/runtime/content/accountContext.js': { resolveCurrentAccount: async () => changed ? null : context, isCurrentAccount: () => !changed },
        'src/runtime/capabilities/assetFetcher.js': { AssetFetcher: { handleGetFileBlob: async (_: unknown, cb: Function) => { changed = true; cb({ success: true, base64: 'AA==' }); } } },
    }).init();
    assert.equal((await invoke(listener, { action: 'getFileBlob', accountId: uuid, url: 'https://lh3.googleusercontent.com/a' })).ok, false);
});

test('Live Save Content sends only the changed key and suppresses stale reinjection feedback', async () => {
    const context = { accountId: uuid, providerId: 'gemini', slot: 'u0' };
    let sent: unknown;
    let reply!: (value: unknown) => void;
    global.chrome = { runtime: { sendMessage: (message: unknown) => { sent = message; return new Promise(resolve => { reply = resolve; }); } } } as any;
    const coordinator = load('src/runtime/content/liveSaveCoordinator.ts', {
        'src/runtime/content/accountContext.js': { getAccountContext: () => context },
    });
    let feedback = 0;
    const badge = { showLiveSaveFeedback: () => { feedback++; } };
    coordinator.init({ badge });
    const pending = coordinator.executeLiveSave({ accountId: uuid, conversationId: 'abc' });
    await Promise.resolve();
    assert.deepEqual(sent, { action: 'runLiveSave', key: { accountId: uuid, conversationId: 'abc' } });
    coordinator.cleanup(); coordinator.init({ badge });
    reply({ ok: true, result: { exported: 1, skipped: 0, partial: 0, failed: [], aborted: false } });
    await pending;
    assert.equal(feedback, 0);
});

test('lifecycle initializes Settings after readiness and opens Options only on installation', async () => {
    let install!: Function;
    const order: unknown[] = [];
    global.chrome = { runtime: { onInstalled: { addListener: (fn: Function) => { install = fn; } },
        getManifest: () => ({ version: '2.0.0' }), getURL: (path: string) => 'chrome-extension://ext/' + path }, tabs: { create: async ({url}: {url: string}) => { assert.match(url, /options.html\?startTour=1$/); order.push('open'); } } } as any;
    const lifecycle = load('src/runtime/background/lifecycle.ts', {
        'src/runtime/background/readiness.js': { ensureV2Ready: async () => { order.push('ready'); } },
        'src/application/settings/index.js': { getSettings: async () => ({}), updateSettings: async (patch: unknown) => { order.push(patch); } },
    });
    lifecycle.initLifecycleListeners();
    install({ reason: 'install' }); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['ready', { lastSeenFeatureVersion: '2.0.0' }, 'open']);
    order.length = 0;
    install({ reason: 'update', previousVersion: '1.8.1' }); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['ready', { lastSeenFeatureVersion: '1.8.1' }]);
    order.length = 0;
    install({ reason: 'update', previousVersion: 'untrusted' }); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['ready', { lastSeenFeatureVersion: '2.0.0' }]);
    assert.equal(Object.hasOwn(order[1] as object, 'tour' + 'AutoHandled'), false);
});

test('Background count, Badge position and Live Save follow their public IPC contracts', async () => {
    let listener!: Function;
    let badgePatch: unknown;
    let badgeWrites = 0;
    global.chrome = { ...chromeBase(), runtime: { id: 'ext', onMessage: { addListener: (fn: Function) => { listener = fn; } } } } as any;
    load('src/runtime/background/background.ts', {
        'src/runtime/background/domainStorageHandler.js': { handleDomainIngestionMessage: () => false },
        'src/runtime/background/accountRegistryHandler.js': { handleAccountRegistryMessage: () => false },
        'src/runtime/background/lifecycle.js': { initSessionAccessLevel: () => {}, initLifecycleListeners: () => {}, initUninstallUrl: () => {} },
        'src/runtime/background/tabAction.js': { initTabActionListeners: () => {} },
        'src/runtime/background/readiness.js': ready, 'src/runtime/background/contentSender.js': security(),
        'src/l3a/storageService.js': { listIndexes: async (id: string) => { assert.equal(id, uuid); return [{}, {}]; } },
        'src/application/settings/index.js': { updateSettings: async (patch: unknown) => { badgePatch = patch; badgeWrites++; } },
        'src/runtime/background/liveSaveHandler.js': { runLiveSave: async () => null },
    });
    assert.deepEqual(await invoke(listener, { action: 'getLocalIndexCount', accountId: uuid }), { ok: true, count: 2 });
    assert.deepEqual(await invoke(listener, { action: 'updateBadgePosition', position: { left: 12, top: 34 } }), { ok: true });
    assert.deepEqual(badgePatch, { badgePosition: { left: 12, top: 34 } });
    for (const position of [{ left: Infinity, top: 0 }, { left: 10, top: NaN }, { left: '1', top: 2 }, { left: 1, top: 2, enabledDisk: true }]) {
        assert.equal((await invoke(listener, { action: 'updateBadgePosition', position })).ok, false);
    }
    assert.equal((await invoke(listener, { action: 'updateBadgePosition', position: { left: 1, top: 2 } }, { ...sender, url: 'https://evil.test/' })).ok, false);
    assert.equal(badgeWrites, 1);
    assert.deepEqual(await invoke(listener, { action: 'runLiveSave', key: { accountId: uuid, conversationId: 'abc' } }), { ok: true, result: null });
    assert.equal((await invoke(listener, { action: 'getLocalIndexCount', accountId: uuid }, { ...sender, url: 'https://evil.test/' })).ok, false);
    for (const action of ['fetchBatch', 'cancelExport', 'deepScan', 'stopDeepScan', 'abortSync', 'liveSaveViaHandle', 'domainStorage']) assert.equal(listener({ action }, sender, () => assert.fail()), false);
});

test('directory picker and reauthorization preserve click gesture; restoration only queries permission', async () => {
    const order: string[] = [];
    const handle = { queryPermission: async () => { order.push('query'); return 'prompt'; }, requestPermission: async () => { order.push('request'); return 'granted'; } };
    global.window = { showDirectoryPicker: () => { order.push('picker'); return Promise.resolve({ ...handle, queryPermission: async () => 'granted' }); } } as any;
    const directory = load('src/runtime/capabilities/dirHandleController.ts', {
        'src/runtime/api/runtimeReady.js': { ensureV2Ready: async () => { order.push('ready'); } },
        'src/l3a/storageService.js': { getDirectoryHandle: async () => handle, setDirectoryHandle: async () => { order.push('store'); } },
    });
    assert.equal(await directory.restoreSavedDirHandle(), null);
    assert.deepEqual(order, ['ready', 'query']);
    order.length = 0;
    await directory.reauthorizeDirHandle();
    assert.deepEqual(order, ['request', 'ready', 'store']);
    order.length = 0;
    await directory.requestDirHandle();
    assert.deepEqual(order, ['picker', 'ready', 'store']);
});

test('MAIN hook reinjection returns before wrapping fetch or adding timers/listeners', () => {
    const fs = require('node:fs');
    const esbuild = require('esbuild');
    const vm = require('node:vm');
    const source = fs.readFileSync(path.join(root, 'src/l1/sniffer/gemini/hookCredentials.ts'), 'utf8')
        .replace(/import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*\s,]+)\s*from\s*['"][^'"]+['"];?\s*/g, '');
    const script = esbuild.transformSync(source, { loader: 'ts', format: 'iife' }).code;
    const window = { __gemExporterHookInstalled: true, fetch: () => {} };
    const original = window.fetch;
    vm.runInNewContext(script, { window });
    assert.equal(window.fetch, original);
});

test('Content cleanup unregisters individual completed requests and drains listeners once on reinjection', () => {
    global.window = contentWindow() as any;
    const cleanup = load('src/runtime/content/cleanupRegistry.ts', {});
    let calls = 0;
    const unregister = cleanup.registerCleanup(() => { calls++; });
    unregister();
    cleanup.registerCleanup(() => { calls++; });
    assert.equal(cleanup.pendingCleanupCount(), 1);
    cleanup.runCleanups(); cleanup.runCleanups();
    assert.equal(calls, 1);
    assert.equal(cleanup.pendingCleanupCount(), 0);
});

test('Worker API readiness shares the background upgrade promise and never messages itself', async () => {
    delete (global as any).window;
    global.location = { protocol: 'chrome-extension:' } as any;
    global.chrome = { runtime: { sendMessage: () => assert.fail('Worker must not message itself') } } as any;
    let upgrades = 0;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const worker = load('src/runtime/background/readiness.ts', {
        'src/migration/upgradeV1.js': { ensureUpgraded: () => { upgrades++; return pending; } },
    });
    const api = load('src/runtime/api/runtimeReady.ts', { 'src/runtime/background/readiness.js': worker });
    let done = false;
    const calls = Promise.all([worker.ensureV2Ready(), api.ensureV2Ready(), api.ensureV2Ready()]).then(() => { done = true; });
    await Promise.resolve();
    assert.equal(upgrades, 1);
    assert.equal(done, false);
    finish(); await calls;
    assert.equal(done, true);
});

test('Content readiness uses IPC and propagates Background upgrade failure', async () => {
    global.window = contentWindow() as any;
    global.location = { protocol: 'https:' } as any;
    let messages = 0;
    global.chrome = { runtime: { sendMessage: async (message: unknown) => {
        messages++; assert.deepEqual(message, { action: 'ensureV2Ready' });
        return { ok: false, error: 'upgrade failed' };
    } } } as any;
    const api = load('src/runtime/api/runtimeReady.ts', { 'src/runtime/background/readiness.js': { ensureV2Ready: () => assert.fail('Content must not execute upgrade') } });
    await assert.rejects(api.ensureV2Ready(), /upgrade failed/);
    assert.equal(messages, 1);
});

test('Content registers capture, account and message listeners while readiness is pending', async () => {
    global.window = contentWindow() as any;
    global.document = { readyState: 'complete' } as any;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const initialized: string[] = [];
    load('src/runtime/content/content.ts', {
        'src/runtime/api/runtimeReady.js': { ensureV2Ready: () => pending },
        'src/l1/client/gemini/bootstrap.js': { initBootstrap: () => initialized.push('credentials') },
        'src/runtime/content/messageRouter.js': { MessageRouter: { init: () => initialized.push('router') } },
        'src/l1/sniffer/gemini/messageBridge.js': { MessageBridge: { init: () => initialized.push('bridge') } },
        'src/ui/badge/badgeView.js': { BadgeView: { ensureBadge: () => initialized.push('badge') } },
        'src/runtime/content/liveSaveCoordinator.js': { LiveSaveCoordinator: { init: () => {}, cleanup: () => {} } },
        'src/runtime/content/accountContext.js': { setAccountChangedHandler() {}, invalidateAccountContext: () => {} },
        'src/runtime/content/cleanupRegistry.js': { runCleanups: () => {}, registerCleanup: () => {} },
    });
    assert.deepEqual(initialized, ['credentials', 'router', 'bridge']);
    finish(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(initialized, ['credentials', 'router', 'bridge', 'badge']);
});

test('an early source completion survives readiness wait and keeps its captured Account after a switch', async () => {
    global.window = contentWindow() as any;
    global.location = { origin: 'https://gemini.google.com', pathname: '/app/abcdef123456' } as any;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    let commits = 0;
    const keys: unknown[] = [];
    const context = { accountId: uuid, providerId: 'gemini', slot: 'u0' };
    let current = context;
    const bridge = load('src/l1/sniffer/gemini/messageBridge.ts', {
        'src/runtime/api/accountRegistry.js': { getAccount: async () => account },
        'src/runtime/content/accountContext.js': { resolveRequestAccount: async () => { await pending; return context; }, resolveCurrentAccount: async () => current },
        'src/runtime/api/domainIngestion.js': { ingestIndexes: async () => { commits++; current = { ...context, accountId: '87654321-4321-4321-8321-cba987654321' }; } },
        'src/l1/client/gemini/listObservation.js': {},
        'src/l1/parsers/gemini/rpc/parseConversation.js': {},
        'src/l1/parsers/gemini/rpc/mergePages.js': {},
        'src/l1/parsers/gemini/parseIndexObservation.js': { parseGeminiIndexObservation: () => ({ conversationId: 'abcdef123456', fields: {} }) },
        'src/l1/parsers/gemini/dom/parseIndex.js': { parseGeminiDomIndex: () => ({}) },
        'src/shared/utils/utils.js': { isDevMode: () => false },
        'src/l1/parsers/gemini/rpc/parseList.js': {},
    });
    bridge.init({ onStreamComplete: (key: unknown) => keys.push(key) });
    const event = { source: global.window, origin: global.location.origin, data: { type: 'GEMINI_STREAM_GENERATE_COMPLETE', payload: { slot: 'u0', requestAccountObservation: { providerId: 'gemini', providerAccountId: 'gaia' }, id: 'abcdef123456' } } };
    const operation = bridge.handleWindowMessage(event);
    await Promise.resolve(); assert.equal(commits, 0);
    finish(); await operation;
    assert.equal(commits, 1);
    assert.deepEqual(keys, [{ accountId: uuid, conversationId: 'abcdef123456' }]);
});

test('active Content Account validation targets the sending document and rejects a different current Account', async () => {
    const guard = security();
    global.chrome = chromeBase() as any;
    let checks = 0;
    global.chrome.tabs.sendMessage = ((id: number, message: unknown, options: unknown, callback: Function) => {
        checks++; assert.equal(id, 7);
        assert.deepEqual(message, { action: 'getAccountContext' });
        assert.deepEqual(options, { frameId: 0, documentId: 'source-document' });
        callback({ ok: true, accountContext: { accountId: '87654321-4321-4321-8321-cba987654321', providerId: 'gemini' } });
    }) as any;
    // Historical passive evidence keeps request-time ownership and does not consult the current Tab.
    assert.equal((await guard.requireContentAccount(sender, uuid)).id, uuid);
    assert.equal(checks, 0);
    await assert.rejects(guard.requireCurrentContentAccount({ ...sender, documentId: 'source-document' }, uuid), /sending Tab/);
    assert.equal(checks, 1);
    global.chrome.tabs.sendMessage = ((_id: unknown, _message: unknown, _options: unknown, callback: Function) => {
        Reflect.set(chrome.runtime, 'lastError', { message: 'Document closed' }); callback(); Reflect.deleteProperty(global.chrome.runtime, 'lastError');
    }) as any;
    await assert.rejects(guard.requireCurrentContentAccount(sender, uuid), /Document closed/);
});

test('both active Background ports reject a different current Account before Export or Index query', async () => {
    let listener!: Function;
    global.chrome = { ...chromeBase(), runtime: { id: 'ext', onMessage: { addListener: (fn: Function) => { listener = fn; } } } } as any;
    global.chrome.tabs.sendMessage = ((_id: unknown, _message: unknown, _options: unknown, callback: Function) => callback({ ok: true, accountContext: { accountId: 'other', providerId: 'gemini' } })) as any;
    load('src/runtime/background/background.ts', {
        'src/runtime/background/domainStorageHandler.js': { handleDomainIngestionMessage: () => false },
        'src/runtime/background/accountRegistryHandler.js': { handleAccountRegistryMessage: () => false },
        'src/runtime/background/lifecycle.js': { initSessionAccessLevel: () => {}, initLifecycleListeners: () => {}, initUninstallUrl: () => {} },
        'src/runtime/background/tabAction.js': { initTabActionListeners: () => {} },
        'src/runtime/background/readiness.js': ready, 'src/runtime/background/contentSender.js': security(),
        'src/l3a/storageService.js': { listIndexes: () => assert.fail('Must reject before reading Index') },
        'src/runtime/background/liveSaveHandler.js': { runLiveSave: () => assert.fail('Must reject before writing files') },
    });
    for (const request of [{ action: 'getLocalIndexCount', accountId: uuid }, { action: 'runLiveSave', key: { accountId: uuid, conversationId: 'abc' } }]) {
        const result = await invoke(listener, request);
        assert.equal(result.ok, false); assert.match(result.error, /sending Tab/);
    }
});

test('CI scripts no longer reference Runtime modules removed by this PR', () => {
    const fs = require('node:fs');
    const files = JSON.parse(fs.readFileSync(path.join(root, 'scripts/zero-any-files.json'), 'utf8'));
    for (const deleted of ['src/runtime/background/batchFetcher.ts', 'src/runtime/background/abortManager.ts',
        'src/runtime/content/geminiIndexCapture.ts', 'src/runtime/content/domScraper.ts', 'src/runtime/content/syncEngine.ts']) {
        assert.equal(files.includes(deleted), false);
        assert.equal(fs.existsSync(path.join(root, deleted)), false);
    }
    const entries = fs.readdirSync(path.join(root, 'scripts'), { recursive: true });
    for (const entry of entries) {
        const file = path.join(root, 'scripts', entry);
        if (fs.statSync(file).isFile() && /\.(?:cjs|mjs|js|ts|json|py|sh)$/.test(entry)) {
            assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /(?:batchFetcher|abortManager|geminiIndexCapture|domScraper|syncEngine)\.(?:js|ts)/, entry);
        }
    }
});

// Synthetic wire fixtures follow the documented upstream completion fields, not HTTP status:
// HanaokaYuzu/Gemini-API @ 1ad0d4a93e505e77c79769d78ef2997641f973c8,
// client.py: candidate[8][0] == 2 (answered), inner[25] (saved to history).
function streamWire(options: { answered?: number; saved?: boolean; responseId?: string } = {}) {
    const candidate = ['rc_abc123', ['latest reply'], null, null, null, null, null, null, [options.answered ?? 2]];
    const inner = new Array(26).fill(null);
    inner[1] = ['c_abcdef123456', options.responseId || 'r_abc123']; inner[4] = [candidate];
    if (options.saved !== false) inner[25] = 'history-save-token';
    const frame = JSON.stringify([['wrb.fr', null, JSON.stringify(inner)]]);
    return ")]}'\n\n" + Buffer.byteLength(frame) + '\n' + frame + '\n';
}
function hookHarness(fetcher: Function) {
    const fs = require('node:fs'), esbuild = require('esbuild'), vm = require('node:vm');
    const protocol = require('../src/l1/protocol/gemini/protocol.js');
    const messages: any[] = [];
    let intervals = 0;
    class Xhr extends EventTarget {
        status = 200; responseText = ''; nativeSendError = false;
        open() {}
        send() { if (this.nativeSendError) throw new Error('native send failed'); }
        emit(type: string) { this.dispatchEvent(new Event(type)); }
    }
    const win = Object.assign(new EventTarget(), {
        fetch: fetcher,
        postMessage: (message: unknown) => { messages.push(message); },
        setInterval: () => { intervals++; return 1; },
    });
    const location = { href: 'https://gemini.google.com/app/abcdef123456', pathname: '/app/abcdef123456', origin: 'https://gemini.google.com' };
    const source = fs.readFileSync(path.join(root, 'src/l1/sniffer/gemini/hookCredentials.ts'), 'utf8')
        .replace(/import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*\s,]+)\s*from\s*['"][^'"]+['"];?\s*/g, '');
    const script = esbuild.transformSync(source, { loader: 'ts', format: 'iife' }).code;
    const context = vm.createContext({ window: win, location, document: new EventTarget(),
        console, Event, URL, URLSearchParams, Request, Response, TextEncoder, TextDecoder, Uint8Array,
        XMLHttpRequest: Xhr, GeminiProtocol: protocol, CrossWorldEvents: protocol.CrossWorldEvents,
        sniffUserProfileFromDom: () => ({}), geminiAccountObservation: () => ({ providerId: 'gemini', providerAccountId: 'gaia' }),
        readGeminiListRequest: () => null, readGeminiDetailRequest: () => null,
    });
    const inject = () => vm.runInContext(script, context);
    inject();
    return { win, Xhr, messages, inject, intervals: () => intervals,
        complete: () => messages.filter(message => message.type === 'GEMINI_STREAM_GENERATE_COMPLETE'),
        url: 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate',
    };
}
const settleHook = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };

test('Fetch: full answered + history-save frames notify once, reinjection and replay do not duplicate', async () => {
    const harness = hookHarness(async () => new Response(streamWire()));
    const fetch = harness.win.fetch;
    harness.inject(); assert.equal(harness.win.fetch, fetch); assert.equal(harness.intervals(), 1);
    const response = await harness.win.fetch(harness.url);
    await response.text(); await settleHook();
    assert.equal(harness.complete().length, 1);
    assert.equal(harness.complete()[0].payload.id, 'abcdef123456');
    await (await harness.win.fetch(harness.url)).text(); await settleHook();
    assert.equal(harness.complete().length, 1);
});
for (const status of [400, 500]) test(`Fetch: HTTP ${status} never completes even with final-looking body`, async () => {
    const harness = hookHarness(async () => new Response(streamWire(), { status }));
    await (await harness.win.fetch(harness.url)).text(); await settleHook();
    assert.equal(harness.complete().length, 0);
    assert.equal((harness.win as any).__geminiIsStreaming, false);
});
test('Fetch: rejected Abort clears transient generation state without completing', async () => {
    const harness = hookHarness(async () => { throw new DOMException('cancelled', 'AbortError'); });
    await assert.rejects(harness.win.fetch(harness.url), /cancelled/);
    assert.equal(harness.complete().length, 0);
    assert.equal((harness.win as any).__geminiIsStreaming, false);
});
test('Fetch: body reader failure never falls back to successful text or completes', async () => {
    const harness = hookHarness(async () => ({ ok: true, clone: () => ({
        body: { getReader: () => ({ read: async () => { throw new Error('read failed'); }, releaseLock() {} }) },
        text: () => assert.fail('Do not reinterpret failed reader as successful text'),
    }) }));
    await harness.win.fetch(harness.url); await settleHook();
    assert.equal(harness.complete().length, 0);
    assert.equal((harness.win as any).__geminiIsStreaming, false);
});
test('Fetch: capped response cannot complete even when its prefix contains completion markers', async () => {
    let reads = 0, cancels = 0;
    const harness = hookHarness(async () => ({ ok: true, clone: () => ({ body: { getReader: () => ({
        read: async () => ({ done: false, value: new TextEncoder().encode(streamWire() + ' '.repeat(4 * 1024 * 1024)) }),
        cancel: () => { cancels++; return new Promise<void>(() => {}); }, releaseLock() { reads++; },
    }) } }) }));
    await harness.win.fetch(harness.url); await settleHook();
    assert.equal(reads, 1); assert.equal(cancels, 1);
    assert.equal(harness.complete().length, 0);
});
for (const wire of [streamWire({ answered: 1 }), streamWire({ saved: false }), '[]\n', streamWire() + '50\n', streamWire() + '[["er",7]]\n']) {
    test('Fetch: HTTP 200 without unambiguous successful protocol termination is ignored: ' + wire.slice(-22), async () => {
        const harness = hookHarness(async () => new Response(wire));
        await (await harness.win.fetch(harness.url)).text(); await settleHook();
        assert.equal(harness.complete().length, 0);
    });
}
test('Fetch: clone failure and signal aborted after headers do not complete', async () => {
    const failedClone = hookHarness(async () => ({ ok: true, clone: () => { throw new Error('clone failed'); } }));
    await failedClone.win.fetch(failedClone.url); await settleHook(); assert.equal(failedClone.complete().length, 0);
    const controller = new AbortController();
    const aborted = hookHarness(async () => { controller.abort(); return new Response(streamWire()); });
    await (await aborted.win.fetch(aborted.url, { signal: controller.signal })).text(); await settleHook();
    assert.equal(aborted.complete().length, 0);
});
test('XHR: successful final frames on load notify once; loadend/reinjection/replay cannot duplicate', () => {
    const harness = hookHarness(async () => new Response(''));
    harness.inject(); assert.equal(harness.intervals(), 1);
    const xhr = new harness.Xhr();
    (xhr.open as Function)('POST', harness.url); xhr.responseText = streamWire(); xhr.send();
    xhr.emit('load'); xhr.emit('loadend'); xhr.emit('load');
    assert.equal(harness.complete().length, 1);
    // Reusing the object must not retain old listeners, and a new response id is a new turn.
    (xhr.open as Function)('POST', harness.url); xhr.responseText = streamWire({ responseId: 'r_def456' }); xhr.send(); xhr.emit('load'); xhr.emit('loadend');
    assert.equal(harness.complete().length, 2);
});
for (const event of ['abort', 'error', 'timeout', 'loadend']) test(`XHR: ${event} is request termination, never generation completion`, () => {
    const harness = hookHarness(async () => new Response(''));
    const xhr = new harness.Xhr(); (xhr.open as Function)('POST', harness.url); xhr.responseText = streamWire(); xhr.send();
    xhr.emit(event); xhr.emit('loadend'); xhr.emit('load');
    assert.equal(harness.complete().length, 0);
    assert.equal((harness.win as any).__geminiIsStreaming, false);
});
for (const status of [0, 403, 503]) test(`XHR: status ${status} with load cannot complete`, () => {
    const harness = hookHarness(async () => new Response(''));
    const xhr = new harness.Xhr(); (xhr.open as Function)('POST', harness.url); xhr.status = status; xhr.responseText = streamWire(); xhr.send(); xhr.emit('load'); xhr.emit('loadend');
    assert.equal(harness.complete().length, 0);
});
test('XHR: 200 without completion markers, oversized body and synchronous send failure cannot complete', () => {
    const harness = hookHarness(async () => new Response(''));
    for (const body of [streamWire({ answered: 1 }), streamWire({ saved: false }), streamWire() + ' '.repeat(4 * 1024 * 1024)]) {
        const xhr = new harness.Xhr(); (xhr.open as Function)('POST', harness.url); xhr.responseText = body; xhr.send(); xhr.emit('load'); xhr.emit('loadend');
    }
    const xhr = new harness.Xhr(); (xhr.open as Function)('POST', harness.url); xhr.nativeSendError = true;
    assert.throws(() => xhr.send(), /native send failed/); xhr.responseText = streamWire(); xhr.emit('load');
    assert.equal(harness.complete().length, 0);
});

function completionBridge(commitDetail: () => Promise<boolean>) {
    global.window = contentWindow() as any;
    global.location = { origin: 'https://gemini.google.com', pathname: '/app/abcdef123456' } as any;
    const context = { accountId: uuid, providerId: 'gemini', slot: 'u0' };
    const parsed = { conversationId: 'abcdef123456', transport: { nextPageToken: null },
        conversation: { index: {}, detail: { messages: [{}] } } };
    const bridge = load('src/l1/sniffer/gemini/messageBridge.ts', {
        'src/runtime/api/accountRegistry.js': { getAccount: async () => account },
        'src/runtime/content/accountContext.js': { resolveRequestAccount: async () => context, resolveCurrentAccount: async () => context },
        'src/runtime/api/domainIngestion.js': { ingestIndexes: async () => {}, ingestDetail: commitDetail },
        'src/l1/client/gemini/listObservation.js': {},
        'src/l1/parsers/gemini/rpc/parseConversation.js': { parseGeminiRpcConversation: () => parsed },
        'src/l1/parsers/gemini/rpc/mergePages.js': { mergeConversationPages: () => parsed },
        'src/l1/parsers/gemini/parseIndexObservation.js': { parseGeminiIndexObservation: () => ({ conversationId: 'abcdef123456', fields: {} }) },
        'src/l1/parsers/gemini/dom/parseIndex.js': { parseGeminiDomIndex: () => ({}) },
        'src/shared/utils/utils.js': { isDevMode: () => false },
        'src/l1/parsers/gemini/rpc/parseList.js': {},
    });
    const event = (type: string) => ({ source: global.window, origin: global.location.origin,
        data: { type, payload: { slot: 'u0', requestAccountObservation: { providerId: 'gemini', providerAccountId: 'gaia' },
            id: 'abcdef123456', text: 'hNvQHb', truncated: false, requestedAt: Date.now(),
            url: 'https://gemini.google.com/_/BardChatUi/data/batchexecute' } } });
    return { bridge, detail: () => bridge.handleWindowMessage(event('GEMINI_NETWORK_BATCHEXECUTE')),
        complete: () => bridge.handleWindowMessage(event('GEMINI_STREAM_GENERATE_COMPLETE')) };
}

// Use the real Application Skip, Document composer, Markdown renderer and Packaging.
// Stub only persistence, provider/resource acquisition and final folder delivery.
function markdownApplication() {
    const key = { accountId: uuid, conversationId: 'abcdef123456' };
    const message = (text: string) => ({ id: text, role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text }] }] });
    const conversation = { index: { key, title: 'Live conversation', titleSource: 'rpc', updatedAt: 100 },
        detail: { key, savedAt: 100, quality: { status: 'complete' }, messages: [message('original reply')], assets: [] } };
    let record: unknown = null;
    const markdown: string[] = [];
    const runExport = load('src/application/export/runExport.ts', {
        'src/l2/readConversation.js': { readConversation: async () => conversation },
        'src/runtime/api/accountRegistry.js': { getAccount: async () => account },
        'src/l3a/storageService.js': { getIndex: async () => conversation.index, getExportRecord: async () => record,
            putExportRecord: async (_: unknown, value: unknown) => { record = value; }, getDirectoryHandle: async () => ({}) },
        'src/l1/resources/sourceResources.js': { createSourceResourceContext: () => ({ release() {} }) },
        'src/l1/client/taskProvider.js': { createTaskProvider: () => assert.fail('Fresh admitted Detail requires no fetch') },
        'src/application/export/prepareExportResources.js': { prepareExportResources: async () => new Map() },
        'src/l4/delivery/index.js': { writeToFolder: async (files: { content: string }[]) => { markdown.push(...files.map(file => file.content)); } },
        'src/l4/format/html/renderHtml.js': {}, 'src/l4/format/json/serializeDomainJson.js': {},
        'src/l4/format/pdf/compileDocumentPdf.js': {}, 'src/l4/format/pdf/typst/typstSandboxCompiler.js': {},
        'src/l4/format/pdf/typst/fonts/localFontProvider.js': {}, 'src/l4/format/pdf/typst/fonts/mountRuntimeFonts.js': {},
    }).runExport;
    const save = live({ enabledDisk: true, defaultFormat: 'markdown', includeAssets: false }, 'granted', true, runExport);
    return { key, save, markdown, append: (advanceIndex = true) => {
        conversation.detail.messages.push(message('latest generated reply'));
        conversation.detail.savedAt = 200;
        if (advanceIndex) conversation.index.updatedAt = 200;
    } };
}

test('passive Detail change waits for commit and Live Save writes latest Markdown', async () => {
    const app = markdownApplication();
    assert.equal((await app.save(app.key)).exported, 1);
    assert.match(app.markdown[0], /original reply/);
    let commit!: () => void;
    const gate = new Promise<void>(resolve => { commit = resolve; });
    const harness = completionBridge(async () => { await gate; app.append(); return true; });
    const exports: Promise<any>[] = [];
    harness.bridge.init({ onDetailChanged: (key: unknown) => { exports.push(app.save(key)); } });
    const detail = harness.detail();
    const completion = harness.complete(); // Completion is only an observation, not a save trigger.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(exports.length, 0);
    assert.equal(app.markdown.length, 1);
    commit(); await detail; await completion;
    assert.equal(exports.length, 1);
    assert.equal((await exports[0]).exported, 1);
    assert.equal(app.markdown.length, 2);
    assert.match(app.markdown[1], /original reply/);
    assert.match(app.markdown[1], /latest generated reply/);
});

test('Live Save does not consult old ExportRecord even when Index time is unchanged', async () => {
    const app = markdownApplication();
    assert.equal((await app.save(app.key)).exported, 1);
    app.append(false);
    const result = await app.save(app.key);
    assert.equal(result.skipped, 0);
    assert.equal(result.exported, 1);
    assert.equal(app.markdown.length, 2);
    assert.match(app.markdown[1], /latest generated reply/);
});

test('failed, unchanged and superseded Detail admissions never trigger Live Save', async () => {
    let fail!: (error: Error) => void;
    const gate = new Promise<boolean>((_, reject) => { fail = reject; });
    const harness = completionBridge(() => gate);
    let saves = 0;
    harness.bridge.init({ onDetailChanged: () => { saves++; } });
    const rejectedDetail = assert.rejects(harness.detail(), /commit failed/);
    fail(new Error('commit failed'));
    await rejectedDetail;
    assert.equal(saves, 0);
    await harness.complete();
    assert.equal(saves, 0);

    const unchanged = completionBridge(async () => false);
    unchanged.bridge.init({ onDetailChanged: () => { saves++; } });
    await unchanged.detail(); await unchanged.complete();
    assert.equal(saves, 0);

    let commit!: () => void;
    const pending = new Promise<void>(resolve => { commit = resolve; });
    const replaced = completionBridge(async () => { await pending; return true; });
    replaced.bridge.init({ onDetailChanged: () => { saves++; } });
    const d = replaced.detail();
    replaced.bridge.init({ onDetailChanged: () => { saves++; } });
    commit(); await d;
    assert.equal(saves, 0, 'a disposed listener cannot trigger an export');
    await replaced.detail();
    assert.equal(saves, 1);
});

test('resource IPC rejects aggregate duplicate Base64 fields before sending, while preserving small responses', async () => {
    global.location = { href: 'https://gemini.google.com/app/abcdef123456' } as any;
    global.window = contentWindow() as any;
    let listener!: Function;
    global.chrome = { runtime: { id: 'ext', onMessage: { addListener: (fn: Function) => { listener = fn; }, removeListener() {} } } } as any;
    const context = { accountId: uuid, providerId: 'gemini', slot: 'u0' };
    let result: unknown = { success: true, dataUrl: 'data:image/png;base64,AA==', size: 1 };
    load('src/runtime/content/messageRouter.ts', {
        'src/runtime/content/accountContext.js': { resolveCurrentAccount: async () => context, isCurrentAccount: () => true },
        'src/runtime/capabilities/assetFetcher.js': { AssetFetcher: { handleGetImageBlob: async (_: unknown, cb: Function) => cb(result) } },
    }).init();
    const request = { action: 'getImageBlob', accountId: uuid, url: 'https://lh3.googleusercontent.com/a' };
    assert.deepEqual(await invoke(listener, request), result);
    const base64 = 'A'.repeat(21 * 1024 * 1024);
    result = { success: true, dataUrl: 'data:image/png;base64,' + base64, dataBase64: base64, blobBase64: base64, size: 16 * 1024 * 1024 };
    assert.match((await invoke(listener, request)).error, /IPC size limit/);
    result = { success: true, buffer: new ArrayBuffer(8) };
    assert.match((await invoke(listener, request)).error, /flat JSON/);
});


test('Fetch: relative StreamGenerate URL completes; unrelated BardFrontend RPC never does', async () => {
    const relative = hookHarness(async () => new Response(streamWire()));
    await (await relative.win.fetch(new URL(relative.url).pathname)).text(); await settleHook();
    assert.equal(relative.complete().length, 1);
    const unrelated = hookHarness(async () => new Response(streamWire()));
    await (await unrelated.win.fetch(unrelated.url.replace('/StreamGenerate', '/OtherRpc'))).text(); await settleHook();
    assert.equal(unrelated.complete().length, 0);
});

// Real Migration + Settings + Storage behind the production Runtime handlers.
// Only the Chrome/IndexedDB browser surfaces are replaced, not ensureUpgraded().
function migratedRuntime(initial: Record<string, unknown>, beforeWrite: (patch: Record<string, unknown>) => Promise<void> = async () => {}) {
    const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
    global.IDBKeyRange = IDBKeyRange;
    const pendingLocks = new Map<string, Promise<void>>();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
        async request<T>(name: string, callback: () => Promise<T>): Promise<T> {
            const previous = pendingLocks.get(name) ?? Promise.resolve();
            let release!: () => void;
            const next = new Promise<void>(resolve => { release = resolve; });
            pendingLocks.set(name, next); await previous;
            try { return await callback(); }
            finally { release(); if (pendingLocks.get(name) === next) pendingLocks.delete(name); }
        }
    } });
    global.indexedDB = new IDBFactory();
    delete (global as any).window;
    global.location = { protocol: 'chrome-extension:' } as any;
    const data = structuredClone(initial);
    const writes: Record<string, unknown>[] = [];
    let listener!: Function, installed!: Function;
    let opened = 0;
    global.chrome = { ...chromeBase(), tabs: { ...chromeBase().tabs, create: async () => { opened++; } }, storage: { local: {
        get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(data[key])])),
        set: async (patch: Record<string, unknown>) => { await beforeWrite(patch); writes.push(structuredClone(patch)); Object.assign(data, structuredClone(patch)); },
    } }, runtime: { id: 'ext', getURL: (path: string) => 'chrome-extension://ext/' + path, getManifest: () => ({ version: '2.0.0' }), openOptionsPage: async () => { opened++; },
        onInstalled: { addListener: (fn: Function) => { installed = fn; } },
        onMessage: { addListener: (fn: Function) => { listener = fn; } },
        sendMessage: async (message: unknown) => invoke(listener, message),
    } } as any;
    delete require.cache[require.resolve('../src/migration/upgradeV1.ts')];
    const readiness = load('src/runtime/background/readiness.ts', {});
    const settings = load('src/application/settings/index.ts', {});
    const lifecycle = load('src/runtime/background/lifecycle.ts', { 'src/runtime/background/readiness.js': readiness,
        'src/application/settings/index.js': settings });
    const guards = load('src/runtime/background/contentSender.ts', {});
    const registryHandler = load('src/runtime/background/accountRegistryHandler.ts', {
        'src/runtime/background/readiness.js': readiness, 'src/runtime/background/contentSender.js': guards,
    });
    load('src/runtime/background/background.ts', {
        'src/runtime/background/readiness.js': readiness, 'src/runtime/background/lifecycle.js': lifecycle,
        'src/runtime/background/contentSender.js': guards, 'src/runtime/background/accountRegistryHandler.js': registryHandler,
        'src/runtime/background/domainStorageHandler.js': { handleDomainIngestionMessage: () => false },
        'src/runtime/background/tabAction.js': { initTabActionListeners() {} },
        'src/runtime/background/liveSaveHandler.js': { runLiveSave: () => assert.fail('No export requested') },
    });
    const readyApi = load('src/runtime/api/runtimeReady.ts', { 'src/runtime/background/readiness.js': readiness });
    const accounts = load('src/runtime/api/accountRegistry.ts', { 'src/runtime/api/runtimeReady.js': readyApi });
    return { data, writes, readiness, readyApi, accounts, settings, opened: () => opened,
        install: (reason: string, previousVersion?: string) => installed({ reason, previousVersion }),
        message: (message: unknown) => invoke(listener, message),
        store: load('src/l3a/storageService.ts', {}),
    };
}
async function seedRuntimeLegacyAccount() {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('gemini_exporter_domain');
        request.onupgradeneeded = () => request.result.createObjectStore('accounts');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('accounts', 'readwrite');
            tx.objectStore('accounts').put(account, uuid);
            tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
        });
    } finally { db.close(); }
}
const migrationMarker = 'gemini_exporter_v2_initialized';
const migratedSettingsKey = 'gemini_exporter_v2_settings';

test('real Migration: fresh-install lifecycle and concurrent readiness IPC wait for initialized marker', async () => {
    let commit!: () => void, reached!: () => void;
    const gate = new Promise<void>(resolve => { commit = resolve; });
    const writing = new Promise<void>(resolve => { reached = resolve; });
    const runtime = migratedRuntime({}, async patch => {
        if (patch[migrationMarker]) { reached(); await gate; }
    });
    runtime.install('install');
    let responses = 0;
    const ipc = Promise.all([runtime.message({ action: 'ensureV2Ready' }), runtime.message({ action: 'ensureV2Ready' })])
        .then(values => { responses++; return values; });
    await writing;
    assert.equal(responses, 0); assert.equal(runtime.opened(), 0);
    assert.equal(runtime.data[migratedSettingsKey], undefined);
    commit(); assert.deepEqual(await ipc, [{ ok: true }, { ok: true }]); await settleHook();
    assert.equal(runtime.data[migrationMarker], true);
    assert.deepEqual(runtime.data[migratedSettingsKey], { lastSeenFeatureVersion: '2.0.0' });
    assert.equal(runtime.opened(), 1);
    assert.equal(runtime.writes.filter(patch => patch[migrationMarker]).length, 1);
    assert.deepEqual(await indexedDB.databases(), []);
});

for (const baseline of ['1.6.0', undefined]) test(`real Migration: Account/count IPC and update lifecycle await commit; feature baseline ${baseline || 'falls back to previousVersion'}`, async () => {
    let commit!: () => void, reached!: () => void;
    const gate = new Promise<void>(resolve => { commit = resolve; });
    const writing = new Promise<void>(resolve => { reached = resolve; });
    const legacyIndex = { key: { accountId: uuid, conversationId: 'legacy' }, title: 'Migrated', titleSource: 'provider', updatedAt: 100 };
    const runtime = migratedRuntime({ gemini_export_format: 'html', gemini_export_zip: false,
        ...(baseline ? { last_seen_feature_version: baseline } : {}), [`conversations_${uuid}`]: [legacyIndex] }, async patch => {
        if (patch[migrationMarker]) { reached(); await gate; }
    });
    await seedRuntimeLegacyAccount();
    runtime.install('update', '1.8.1');
    const worker = runtime.readyApi.ensureV2Ready(); // Worker takes the direct path.
    global.window = contentWindow() as any;
    global.location = { protocol: 'https:' } as any;
    let resolved = 0;
    const registry = runtime.accounts.getAccount(uuid).then((value: unknown) => { resolved++; return value; });
    const count = runtime.message({ action: 'getLocalIndexCount', accountId: uuid }).then(value => { resolved++; return value; });
    await writing; assert.equal(resolved, 0); assert.equal(runtime.opened(), 0);
    commit(); await worker;
    assert.deepEqual(await registry, account);
    assert.deepEqual(await count, { ok: true, count: 1 }); await settleHook();
    assert.deepEqual(await runtime.store.listIndexes(uuid), [legacyIndex]);
    assert.deepEqual(await runtime.settings.getSettings(), {
        defaultFormat: 'html', skipExported: true, includeAssets: true,
        enabledDisk: false, developerMode: false, lastSeenFeatureVersion: baseline || '1.8.1',
    });
    assert.equal(runtime.writes.filter(patch => patch[migrationMarker]).length, 1);
    assert.deepEqual(runtime.data[`conversations_${uuid}`], [legacyIndex]);
});

test('real Migration: failed completion marker fails Runtime IPC and retries before allowing Account reads', async () => {
    let fail = true;
    const runtime = migratedRuntime({ gemini_export_zip: false }, async patch => {
        if (patch[migrationMarker] && fail) throw new Error('migration marker write failed');
    });
    await seedRuntimeLegacyAccount();
    const failed = await runtime.message({ action: 'ensureV2Ready' });
    assert.deepEqual(failed, { ok: false, error: 'migration marker write failed' });
    assert.equal(runtime.data[migrationMarker], undefined);
    global.window = contentWindow() as any;
    global.location = { protocol: 'https:' } as any;
    await assert.rejects(runtime.accounts.getAccount(uuid), /migration marker write failed/);
    fail = false;
    assert.deepEqual(await runtime.accounts.getAccount(uuid), account);
    assert.equal(runtime.data[migrationMarker], true);
    assert.equal(runtime.writes.filter(patch => patch[migrationMarker]).length, 1);
    // Once ready, neither the worker nor Content asks Migration to reopen legacy DBs.
    indexedDB.databases = () => assert.fail('Ready Runtime must not rerun Migration');
    assert.deepEqual(await runtime.message({ action: 'ensureV2Ready' }), { ok: true });
    assert.deepEqual(await runtime.accounts.getAccount(uuid), account);
});
