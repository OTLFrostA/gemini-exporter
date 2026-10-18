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

test('Background returns Detail changed only after L2 admission commits', async () => {
    global.chrome = chromeBase() as any;
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const handle = load('src/background/domainStorageHandler.ts', {
        'src/background/readiness.js': ready, 'src/background/contentSender.js': security(),
        'src/core/domain/ingestion.js': { ingestDetail: async () => { await gate; return false; } },
    }).handleDomainIngestionMessage;
    let returned = false;
    const response = invoke(handle, { action: 'domainIngest', operation: 'detail',
        accountId: uuid, conversationId: 'abc', detail: {} }).then((value: unknown) => { returned = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(returned, false);
    finish();
    assert.deepEqual(await response, { ok: true, changed: false });
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

test('Content ingestion preserves committed changed results from the worker', async () => {
    global.location = { protocol: 'https:' } as any;
    global.chrome = { runtime: { sendMessage: async () => ({ ok: true, changed: true }) } } as any;
    const api = load('src/core/api/domainIngestion.ts', { 'src/core/domain/ingestion.js': {},
        'src/core/api/runtimeReady.js': ready });
    assert.equal(await api.ingestDetail(uuid, 'abc', {}), true);
    global.chrome = { runtime: { sendMessage: async () => ({ ok: true }) } } as any;
    await assert.rejects(api.ingestDetail(uuid, 'abc', {}), /changed/);
});

test('Extension ingestion calls the same L2 function after readiness', async () => {
    global.location = { protocol: 'chrome-extension:' } as any;
    const order: string[] = [];
    const api = load('src/core/api/domainIngestion.ts', {
        'src/core/domain/ingestion.js': { ingestDetail: async () => { order.push('L2'); return true; } },
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
        assert.deepEqual(request, { keys: [key], format: 'markdown', delivery: 'folderWriter', useZip: false, includeAssets: false, skipUnchanged: false });
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
        'src/content/accountContext.js': { getAccountContext: () => context },
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

test('only confirmed stream completion triggers Live Save; cleanup cancels pending completion', async () => {
    global.window = contentWindow() as any;
    const observer = load('src/content/liveSaveObserver.ts', {});
    const saves: unknown[] = [];
    observer.init({ debounceMs: 1, getActiveId: () => 'abc', onTurnComplete: (...args: unknown[]) => saves.push(args) });
    observer.notifyStreamStart('abc'); observer.flushCurrentTurnNow();
    global.window.dispatchEvent(new Event('beforeunload'));
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(saves, []);
    observer.notifyStreamComplete({ accountId: uuid, conversationId: 'abc' });
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(saves, [[{ accountId: uuid, conversationId: 'abc' }, 'turn_complete']]);
    observer.notifyStreamComplete({ accountId: uuid, conversationId: 'abc' }); observer.cleanup();
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
    assert.deepEqual(order, ['ready', { tourShown: true, lastSeenFeatureVersion: '1.8.1' }]);
    order.length = 0;
    install({ reason: 'update', previousVersion: 'untrusted' }); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['ready', { tourShown: true }]);
    assert.equal(Object.hasOwn(order[1] as object, 'tour' + 'AutoHandled'), false);
});

test('Background count uses Index query, propagates Live Save result, and declines retired actions', async () => {
    let listener!: Function;
    global.chrome = { ...chromeBase(), runtime: { id: 'ext', onMessage: { addListener: (fn: Function) => { listener = fn; } } } } as any;
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

test('Worker API readiness shares the background upgrade promise and never messages itself', async () => {
    delete (global as any).window;
    global.location = { protocol: 'chrome-extension:' } as any;
    global.chrome = { runtime: { sendMessage: () => assert.fail('Worker must not message itself') } } as any;
    let upgrades = 0;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const worker = load('src/background/readiness.ts', {
        'src/core/migration/upgradeV1.js': { ensureUpgraded: () => { upgrades++; return pending; } },
    });
    const api = load('src/core/api/runtimeReady.ts', { 'src/background/readiness.js': worker });
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
    const api = load('src/core/api/runtimeReady.ts', { 'src/background/readiness.js': { ensureV2Ready: () => assert.fail('Content must not execute upgrade') } });
    await assert.rejects(api.ensureV2Ready(), /upgrade failed/);
    assert.equal(messages, 1);
});

test('Content registers capture, account and message listeners while readiness is pending', async () => {
    global.window = contentWindow() as any;
    global.document = { readyState: 'complete' } as any;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const initialized: string[] = [];
    load('src/content/content.ts', {
        'src/core/api/runtimeReady.js': { ensureV2Ready: () => pending },
        'src/content/bootstrap.js': { initBootstrap: () => initialized.push('credentials') },
        'src/content/messageRouter.js': { MessageRouter: { init: () => initialized.push('router') } },
        'src/content/messageBridge.js': { MessageBridge: { init: () => initialized.push('bridge') } },
        'src/content/badgeView.js': { BadgeView: { ensureBadge: () => initialized.push('badge') } },
        'src/content/liveSaveObserver.js': { LiveSaveObserver: { init: () => initialized.push('completion'), cleanup: () => {} } },
        'src/content/liveSaveCoordinator.js': { LiveSaveCoordinator: { init: () => {}, cleanup: () => {} } },
        'src/content/accountContext.js': { invalidateAccountContext: () => {} },
        'src/content/cleanupRegistry.js': { runCleanups: () => {}, registerCleanup: () => {} },
    });
    assert.deepEqual(initialized, ['credentials', 'router', 'completion', 'bridge']);
    finish(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(initialized, ['credentials', 'router', 'completion', 'bridge', 'badge']);
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
    const bridge = load('src/content/messageBridge.ts', {
        'src/core/api/accountRegistry.js': { getAccount: async () => account },
        'src/content/accountContext.js': { resolveRequestAccount: async () => { await pending; return context; }, resolveCurrentAccount: async () => current },
        'src/core/api/domainIngestion.js': { ingestIndexes: async () => { commits++; current = { ...context, accountId: '87654321-4321-4321-8321-cba987654321' }; } },
        'src/core/provider/gemini/listObservation.js': {},
        'src/core/parsers/gemini/rpc/parseConversation.js': {},
        'src/core/parsers/gemini/rpc/mergePages.js': {},
        'src/core/parsers/gemini/parseIndexObservation.js': { parseGeminiIndexObservation: () => ({ conversationId: 'abcdef123456', fields: {} }) },
        'src/core/parsers/gemini/dom/parseIndex.js': { parseGeminiDomIndex: () => ({}) },
        'src/core/utils/utils.js': { isDevMode: () => false },
        'src/core/parsers/gemini/rpc/parseList.js': {},
    });
    bridge.init({ onStreamComplete: (key: unknown) => keys.push(key) });
    const event = { source: global.window, origin: global.location.origin, data: { type: 'GEMINI_STREAM_GENERATE_COMPLETE', payload: { slot: 'u0', requestAccountObservation: { providerId: 'gemini', providerAccountId: 'gaia' }, id: 'abcdef123456' } } };
    const operation = bridge.handleWindowMessage(event);
    await Promise.resolve(); assert.equal(commits, 0);
    finish(); await operation;
    assert.equal(commits, 1);
    assert.deepEqual(keys, [{ accountId: uuid, conversationId: 'abcdef123456' }]);
});

test('Live Save debounce preserves the event Key after Account switches and input mutation', async () => {
    global.window = contentWindow() as any;
    const other = '87654321-4321-4321-8321-cba987654321';
    let current = uuid;
    let sent: any;
    let feedback = 0;
    global.chrome = { runtime: { sendMessage: async (message: unknown) => {
        sent = message;
        return { ok: true, result: { exported: 1, skipped: 0, partial: 0, failed: [], aborted: false } };
    } } } as any;
    const coordinator = load('src/content/liveSaveCoordinator.ts', {
        'src/content/accountContext.js': { getAccountContext: () => ({ accountId: current }), resolveCurrentAccount: () => assert.fail('Do not rediscover Account during save') },
    });
    coordinator.init({ badge: { showLiveSaveFeedback: () => { feedback++; } } });
    const observer = load('src/content/liveSaveObserver.ts', {});
    let complete!: () => void;
    const done = new Promise<void>(resolve => { complete = resolve; });
    observer.init({ debounceMs: 1, onTurnComplete: (key: unknown) => { void coordinator.executeLiveSave(key).then(complete); } });
    const key = { accountId: uuid, conversationId: 'old-conversation' };
    observer.notifyStreamComplete(key);
    current = other; key.accountId = other;
    await done;
    assert.deepEqual(sent.key, { accountId: uuid, conversationId: 'old-conversation' });
    assert.equal(feedback, 0);
    observer.cleanup(); coordinator.cleanup();
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
        global.chrome.runtime.lastError = { message: 'Document closed' }; callback(); delete global.chrome.runtime.lastError;
    }) as any;
    await assert.rejects(guard.requireCurrentContentAccount(sender, uuid), /Document closed/);
});

test('both active Background ports reject a different current Account before Export or Index query', async () => {
    let listener!: Function;
    global.chrome = { ...chromeBase(), runtime: { id: 'ext', onMessage: { addListener: (fn: Function) => { listener = fn; } } } } as any;
    global.chrome.tabs.sendMessage = ((_id: unknown, _message: unknown, _options: unknown, callback: Function) => callback({ ok: true, accountContext: { accountId: 'other', providerId: 'gemini' } })) as any;
    load('src/background/background.ts', {
        'src/background/domainStorageHandler.js': { handleDomainIngestionMessage: () => false },
        'src/background/accountRegistryHandler.js': { handleAccountRegistryMessage: () => false },
        'src/background/lifecycle.js': { initSessionAccessLevel: () => {}, initLifecycleListeners: () => {}, initUninstallUrl: () => {} },
        'src/background/tabAction.js': { initTabActionListeners: () => {} },
        'src/background/readiness.js': ready, 'src/background/contentSender.js': security(),
        'src/core/storage/storageService.js': { listIndexes: () => assert.fail('Must reject before reading Index') },
        'src/background/liveSaveHandler.js': { runLiveSave: () => assert.fail('Must reject before writing files') },
    });
    for (const request of [{ action: 'getLocalIndexCount', accountId: uuid }, { action: 'runLiveSave', key: { accountId: uuid, conversationId: 'abc' } }]) {
        const result = await invoke(listener, request);
        assert.equal(result.ok, false); assert.match(result.error, /sending Tab/);
    }
});

test('CI scripts no longer reference Runtime modules removed by this PR', () => {
    const fs = require('node:fs');
    const files = JSON.parse(fs.readFileSync(path.join(root, 'scripts/zero-any-files.json'), 'utf8'));
    for (const deleted of ['src/background/batchFetcher.ts', 'src/background/abortManager.ts',
        'src/content/geminiIndexCapture.ts', 'src/content/domScraper.ts', 'src/content/syncEngine.ts']) {
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
    const protocol = require('../src/core/protocol/protocol.js');
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
    const source = fs.readFileSync(path.join(root, 'src/content/hookCredentials.ts'), 'utf8')
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
    const bridge = load('src/content/messageBridge.ts', {
        'src/core/api/accountRegistry.js': { getAccount: async () => account },
        'src/content/accountContext.js': { resolveRequestAccount: async () => context, resolveCurrentAccount: async () => context },
        'src/core/api/domainIngestion.js': { ingestIndexes: async () => {}, ingestDetail: commitDetail },
        'src/core/provider/gemini/listObservation.js': {},
        'src/core/parsers/gemini/rpc/parseConversation.js': { parseGeminiRpcConversation: () => parsed },
        'src/core/parsers/gemini/rpc/mergePages.js': { mergeConversationPages: () => parsed },
        'src/core/parsers/gemini/parseIndexObservation.js': { parseGeminiIndexObservation: () => ({ conversationId: 'abcdef123456', fields: {} }) },
        'src/core/parsers/gemini/dom/parseIndex.js': { parseGeminiDomIndex: () => ({}) },
        'src/core/utils/utils.js': { isDevMode: () => false },
        'src/core/parsers/gemini/rpc/parseList.js': {},
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
    const runExport = load('src/core/application/export/runExport.ts', {
        'src/core/domain/readConversation.js': { readConversation: async () => conversation },
        'src/core/api/accountRegistry.js': { getAccount: async () => account },
        'src/core/storage/storageService.js': { getIndex: async () => conversation.index, getExportRecord: async () => record,
            putExportRecord: async (_: unknown, value: unknown) => { record = value; }, getDirectoryHandle: async () => ({}) },
        'src/core/provider/sourceResources.js': { createSourceResourceContext: () => ({ release() {} }) },
        'src/core/provider/taskProvider.js': { createTaskProvider: () => assert.fail('Fresh admitted Detail requires no fetch') },
        'src/core/application/export/prepareExportResources.js': { prepareExportResources: async () => new Map() },
        'src/core/export/delivery/index.js': { writeToFolder: async (files: { content: string }[]) => { markdown.push(...files.map(file => file.content)); } },
        'src/core/renderers/html/renderHtml.js': {}, 'src/core/renderers/json/serializeDomainJson.js': {},
        'src/core/export/pdf/compileDocumentPdf.js': {}, 'src/core/export/typst/typstSandboxCompiler.js': {},
        'src/core/export/typst/fonts/localFontProvider.js': {}, 'src/core/export/typst/fonts/mountRuntimeFonts.js': {},
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
    let exported: Promise<any> | undefined;
    harness.bridge.init({ onDetailChanged: key => { exported = app.save(key); } });
    const detail = harness.detail();
    await harness.complete(); // Stream Complete alone never starts Live Save.
    assert.equal(exported, undefined);
    assert.equal(app.markdown.length, 1);
    commit(); await detail;
    assert.ok(exported);
    assert.equal((await exported).exported, 1);
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
    load('src/content/messageRouter.ts', {
        'src/content/accountContext.js': { resolveCurrentAccount: async () => context, isCurrentAccount: () => true },
        'src/content/assetFetcher.js': { AssetFetcher: { handleGetImageBlob: async (_: unknown, cb: Function) => cb(result) } },
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
    const { IDBFactory } = require('fake-indexeddb');
    global.indexedDB = new IDBFactory();
    delete (global as any).window;
    global.location = { protocol: 'chrome-extension:' } as any;
    const data = structuredClone(initial);
    const writes: Record<string, unknown>[] = [];
    let listener!: Function, installed!: Function;
    let opened = 0;
    global.chrome = { ...chromeBase(), storage: { local: {
        get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(data[key])])),
        set: async (patch: Record<string, unknown>) => { await beforeWrite(patch); writes.push(structuredClone(patch)); Object.assign(data, structuredClone(patch)); },
    } }, runtime: { id: 'ext', getManifest: () => ({ version: '2.0.0' }), openOptionsPage: async () => { opened++; },
        onInstalled: { addListener: (fn: Function) => { installed = fn; } },
        onMessage: { addListener: (fn: Function) => { listener = fn; } },
        sendMessage: async (message: unknown) => invoke(listener, message),
    } } as any;
    delete require.cache[require.resolve('../src/core/migration/upgradeV1.ts')];
    const readiness = load('src/background/readiness.ts', {});
    const settings = load('src/core/application/settings/index.ts', {});
    const lifecycle = load('src/background/lifecycle.ts', { 'src/background/readiness.js': readiness,
        'src/core/application/settings/index.js': settings });
    const guards = load('src/background/contentSender.ts', {});
    const registryHandler = load('src/background/accountRegistryHandler.ts', {
        'src/background/readiness.js': readiness, 'src/background/contentSender.js': guards,
    });
    load('src/background/background.ts', {
        'src/background/readiness.js': readiness, 'src/background/lifecycle.js': lifecycle,
        'src/background/contentSender.js': guards, 'src/background/accountRegistryHandler.js': registryHandler,
        'src/background/domainStorageHandler.js': { handleDomainIngestionMessage: () => false },
        'src/background/tabAction.js': { initTabActionListeners() {} },
        'src/background/liveSaveHandler.js': { runLiveSave: () => assert.fail('No export requested') },
    });
    const readyApi = load('src/core/api/runtimeReady.ts', { 'src/background/readiness.js': readiness });
    const accounts = load('src/core/api/accountRegistry.ts', { 'src/core/api/runtimeReady.js': readyApi });
    return { data, writes, readiness, readyApi, accounts, settings, opened: () => opened,
        install: (reason: string, previousVersion?: string) => installed({ reason, previousVersion }),
        message: (message: unknown) => invoke(listener, message),
        store: load('src/core/storage/storageService.ts', {}),
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
        defaultFormat: 'html', useZip: false, skipExported: true, includeAssets: true,
        enabledDisk: false, developerMode: false, tourShown: true, lastSeenFeatureVersion: baseline || '1.8.1',
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
