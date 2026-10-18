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
const chromeBase = () => ({ runtime: { id: 'ext' } });
const ready = { ensureV2Ready: async () => {} };
const storage = { getAccount: async () => account };
const security = () => load('src/background/contentSender.ts', { 'src/core/storage/storageService.js': storage });
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
    const { handleDomainIngestionMessage: handle } = load('src/background/domainStorageHandler.ts', {
        'src/background/readiness.js': ready, 'src/background/contentSender.js': security(),
        'src/core/domain/ingestion.js': { ingestIndexes: async (...values: unknown[]) => { args = values; await gate; } },
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
    const handle = load('src/background/domainStorageHandler.ts', {
        'src/background/readiness.js': ready, 'src/background/contentSender.js': security(),
        'src/core/domain/ingestion.js': { ingestDetail: async (...args: unknown[]) => { seen = args; throw new Error('commit failed'); } },
    }).handleDomainIngestionMessage;
    const detail = { quality: { status: 'partial' } }, indexFields = { title: 'a' };
    assert.deepEqual(await invoke(handle, { action: 'domainIngest', operation: 'detail', accountId: uuid, conversationId: 'abc', detail, indexFields }), { ok: false, error: 'commit failed' });
    assert.deepEqual(seen, [uuid, 'abc', detail, indexFields]);
    assert.equal(handle({ action: 'domainStorage' }, sender, () => assert.fail()), false);
});

test('ingestion rejects foreign, unsupported, subframe and malformed requests', async () => {
    global.chrome = chromeBase() as any;
    let calls = 0;
    const handle = load('src/background/domainStorageHandler.ts', {
        'src/background/readiness.js': ready, 'src/background/contentSender.js': security(),
        'src/core/domain/ingestion.js': { ingestIndexes: async () => { calls++; } },
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
    const guard = load('src/background/contentSender.ts', { 'src/core/storage/storageService.js': { getAccount: async () => ({ ...account, providerId: 'chatgpt' }) } });
    await assert.rejects(guard.requireContentAccount(sender, uuid), /mismatch/);
});

test('Content ingestion sends only JSON facts and propagates worker failure', async () => {
    global.location = { protocol: 'https:' } as any;
    let sent: unknown;
    global.chrome = { runtime: { sendMessage: async (message: unknown) => { sent = message; return { ok: false, error: 'L2 rejected' }; } } } as any;
    const api = load('src/core/api/domainIngestion.ts', { 'src/core/domain/ingestion.js': {}, 'src/core/api/runtimeReady.js': ready });
    await assert.rejects(api.ingestIndexes(uuid, []), /L2 rejected/);
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), { action: 'domainIngest', operation: 'indexes', accountId: uuid, items: [] });
});

test('Extension ingestion calls the same L2 function after readiness', async () => {
    global.location = { protocol: 'chrome-extension:' } as any;
    const order: string[] = [];
    const api = load('src/core/api/domainIngestion.ts', {
        'src/core/domain/ingestion.js': { ingestDetail: async () => { order.push('L2'); } },
        'src/core/api/runtimeReady.js': { ensureV2Ready: async () => { order.push('ready'); } },
    });
    await api.ingestDetail(uuid, 'abc', {});
    assert.deepEqual(order, ['ready', 'L2']);
});

function live(settings: object, permission = 'granted', handleExists = true, exporter?: Function) {
    return load('src/background/liveSaveHandler.ts', {
        'src/core/application/settings/index.js': { getSettings: async () => settings },
        'src/core/storage/storageService.js': { getDirectoryHandle: async () => handleExists ? { queryPermission: async (options: unknown) => { assert.deepEqual(options, { mode: 'readwrite' }); return permission; } } : null },
        'src/core/application/export/runExport.js': { runExport: exporter || (() => assert.fail('Unexpected Export')) },
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
        assert.deepEqual(request, { keys: [key], format: 'markdown', delivery: 'folderWriter', useZip: false, includeAssets: false, skipUnchanged: true });
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
            else { global.chrome.runtime.lastError = { message: 'Tab navigated' }; callback(); delete global.chrome.runtime.lastError; }
        },
    } } as any;
    const routing = load('src/core/utils/tabService.ts', { 'src/core/storage/storageService.js': storage, 'src/core/api/runtimeReady.js': ready });
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
    const routing = load('src/core/utils/tabService.ts', { 'src/core/storage/storageService.js': storage, 'src/core/api/runtimeReady.js': ready });
    await assert.rejects(routing.resolveAccountTab(uuid), /No open/);
});

test('readiness shares one pending upgrade and retries failures', async () => {
    let calls = 0;
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const runtime = load('src/background/readiness.ts', { 'src/core/migration/upgradeV1.js': { ensureUpgraded: () => { calls++; return gate; } } });
    const first = runtime.ensureV2Ready();
    assert.equal(first, runtime.ensureV2Ready());
    assert.equal(calls, 1); finish(); await first;
    let attempts = 0;
    const retry = load('src/background/readiness.ts', { 'src/core/migration/upgradeV1.js': { ensureUpgraded: async () => { if (++attempts === 1) throw new Error('upgrade failed'); } } });
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
    const router = load('src/content/messageRouter.ts', {
        'src/content/accountContext.js': { resolveCurrentAccount: async () => context, isCurrentAccount: () => true },
        'src/content/assetFetcher.js': { AssetFetcher: {} },
    });
    router.init();
    assert.deepEqual(await invoke(listener, { action: 'getAccountContext' }), { ok: true, accountContext: context, conversationId: 'abcdef123456' });
    assert.equal((await invoke(listener, { action: 'getFileBlob', accountId: 'other', url: 'https://lh3.googleusercontent.com/a' })).ok, false);
    assert.equal((await invoke(listener, { action: 'getFileBlob', accountId: uuid, url: 'https://evil.test/a' })).ok, false);
    assert.equal(listener({ action: 'deepScan' }, sender, () => assert.fail()), false);
    assert.equal((await invoke(listener, { action: 'getAccountContext' }, { id: 'foreign' })).ok, false);
    const changed = load('src/content/messageRouter.ts', {
        'src/content/accountContext.js': { resolveCurrentAccount: async () => { global.location.href = 'https://gemini.google.com/app/other'; return context; }, isCurrentAccount: () => true },
        'src/content/assetFetcher.js': { AssetFetcher: {} },
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
    load('src/content/messageRouter.ts', {
        'src/content/accountContext.js': { resolveCurrentAccount: async () => changed ? null : context, isCurrentAccount: () => !changed },
        'src/content/assetFetcher.js': { AssetFetcher: { handleGetFileBlob: async (_: unknown, cb: Function) => { changed = true; cb({ success: true, base64: 'AA==' }); } } },
    }).init();
    assert.equal((await invoke(listener, { action: 'getFileBlob', accountId: uuid, url: 'https://lh3.googleusercontent.com/a' })).ok, false);
});

test('Live Save Content sends only key, ignores navigation flush, and suppresses stale reinjection feedback', async () => {
    const context = { accountId: uuid, providerId: 'gemini', slot: 'u0' };
    let sent: unknown;
    let reply!: (value: unknown) => void;
    global.chrome = { runtime: { sendMessage: (message: unknown) => { sent = message; return new Promise(resolve => { reply = resolve; }); } } } as any;
    const coordinator = load('src/content/liveSaveCoordinator.ts', {
        'src/content/accountContext.js': { resolveCurrentAccount: async () => context, isCurrentAccount: () => true },
    });
    let feedback = 0;
    const badge = { showLiveSaveFeedback: () => { feedback++; } };
    coordinator.init({ badge });
    assert.equal(await coordinator.executeLiveSave('abc', 'unload'), null);
    const pending = coordinator.executeLiveSave('abc');
    await Promise.resolve();
    assert.deepEqual(sent, { action: 'runLiveSave', key: { accountId: uuid, conversationId: 'abc' } });
    coordinator.cleanup(); coordinator.init({ badge });
    reply({ ok: true, result: { exported: 1, skipped: 0, partial: 0, failed: [], aborted: false } });
    await pending;
    assert.equal(feedback, 0);
});

test('only confirmed stream completion triggers Live Save; cleanup cancels pending completion', async () => {
    global.window = contentWindow() as any;
    const observer = load('src/content/liveSaveObserver.ts', {});
    const saves: unknown[] = [];
    observer.init({ debounceMs: 1, getActiveId: () => 'abc', onTurnComplete: (...args: unknown[]) => saves.push(args) });
    observer.notifyStreamStart('abc'); observer.flushCurrentTurnNow();
    global.window.dispatchEvent(new Event('beforeunload'));
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(saves, []);
    observer.notifyStreamComplete('abc');
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(saves, [['abc', 'turn_complete']]);
    observer.notifyStreamComplete('abc'); observer.cleanup();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(saves.length, 1);
});

test('lifecycle initializes Settings after readiness and opens Options only on installation', async () => {
    let install!: Function;
    const order: unknown[] = [];
    global.chrome = { runtime: { onInstalled: { addListener: (fn: Function) => { install = fn; } },
        getManifest: () => ({ version: '2.0.0' }), openOptionsPage: async () => { order.push('open'); } } } as any;
    const lifecycle = load('src/background/lifecycle.ts', {
        'src/background/readiness.js': { ensureV2Ready: async () => { order.push('ready'); } },
        'src/core/application/settings/index.js': { getSettings: async () => ({}), updateSettings: async (patch: unknown) => { order.push(patch); } },
    });
    lifecycle.initLifecycleListeners();
    install({ reason: 'install' }); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['ready', { lastSeenFeatureVersion: '2.0.0' }, 'open']);
    order.length = 0;
    install({ reason: 'update', previousVersion: '1.8.1' }); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['ready', { tourAutoHandled: true, lastSeenFeatureVersion: '1.8.1' }]);
    order.length = 0;
    install({ reason: 'update', previousVersion: 'untrusted' }); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['ready', { tourAutoHandled: true }]);
});

test('Background count uses Index query, propagates Live Save result, and declines retired actions', async () => {
    let listener!: Function;
    global.chrome = { runtime: { id: 'ext', onMessage: { addListener: (fn: Function) => { listener = fn; } } } } as any;
    load('src/background/background.ts', {
        'src/background/domainStorageHandler.js': { handleDomainIngestionMessage: () => false },
        'src/background/accountRegistryHandler.js': { handleAccountRegistryMessage: () => false },
        'src/background/lifecycle.js': { initSessionAccessLevel: () => {}, initLifecycleListeners: () => {}, initUninstallUrl: () => {} },
        'src/background/tabAction.js': { initTabActionListeners: () => {} },
        'src/background/readiness.js': ready, 'src/background/contentSender.js': security(),
        'src/core/storage/storageService.js': { listIndexes: async (id: string) => { assert.equal(id, uuid); return [{}, {}]; } },
        'src/background/liveSaveHandler.js': { runLiveSave: async () => null },
    });
    assert.deepEqual(await invoke(listener, { action: 'getLocalIndexCount', accountId: uuid }), { ok: true, count: 2 });
    assert.deepEqual(await invoke(listener, { action: 'runLiveSave', key: { accountId: uuid, conversationId: 'abc' } }), { ok: true, result: null });
    assert.equal((await invoke(listener, { action: 'getLocalIndexCount', accountId: uuid }, { ...sender, url: 'https://evil.test/' })).ok, false);
    for (const action of ['fetchBatch', 'cancelExport', 'deepScan', 'stopDeepScan', 'abortSync', 'liveSaveViaHandle', 'domainStorage']) assert.equal(listener({ action }, sender, () => assert.fail()), false);
});

test('directory picker and reauthorization preserve click gesture; restoration only queries permission', async () => {
    const order: string[] = [];
    const handle = { queryPermission: async () => { order.push('query'); return 'prompt'; }, requestPermission: async () => { order.push('request'); return 'granted'; } };
    global.window = { showDirectoryPicker: () => { order.push('picker'); return Promise.resolve({ ...handle, queryPermission: async () => 'granted' }); } } as any;
    const directory = load('src/ui/controllers/dirHandleController.ts', {
        'src/core/api/runtimeReady.js': { ensureV2Ready: async () => { order.push('ready'); } },
        'src/core/storage/storageService.js': { getDirectoryHandle: async () => handle, setDirectoryHandle: async () => { order.push('store'); } },
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
    const source = fs.readFileSync(path.join(root, 'src/content/hookCredentials.ts'), 'utf8')
        .replace(/import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*\s,]+)\s*from\s*['"][^'"]+['"];?\s*/g, '');
    const script = esbuild.transformSync(source, { loader: 'ts', format: 'iife' }).code;
    const window = { __gemExporterHookInstalled: true, fetch: () => {} };
    const original = window.fetch;
    vm.runInNewContext(script, { window });
    assert.equal(window.fetch, original);
});

test('Content cleanup unregisters individual completed requests and drains listeners once on reinjection', () => {
    global.window = contentWindow() as any;
    const cleanup = load('src/content/cleanupRegistry.ts', {});
    let calls = 0;
    const unregister = cleanup.registerCleanup(() => { calls++; });
    unregister();
    cleanup.registerCleanup(() => { calls++; });
    assert.equal(cleanup.pendingCleanupCount(), 1);
    cleanup.runCleanups(); cleanup.runCleanups();
    assert.equal(calls, 1);
    assert.equal(cleanup.pendingCleanupCount(), 0);
});
