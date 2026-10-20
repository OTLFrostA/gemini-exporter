import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { assertRuntimeUnitBoundary, v2Settings } from './helpers/runtimeV2ContractMocks.js';

const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const key = { accountId: '12345678-1234-4234-8234-123456789abc', conversationId: 'abc123' };

// Isolate Runtime from business-layer implementations undergoing v2 migration.
// Stubs preserve the published Settings, Storage and Application contracts.
function load(file: string, stubs: Record<string, unknown> = {}) {
    const original = Module._load;
    Module._load = function(request: string, parent: { filename: string }, ...args: unknown[]) {
        const resolved = request.startsWith('.') ? path.resolve(path.dirname(parent.filename), request).replace(/\.ts$/, '.js') : request;
        const dependency = Object.keys(stubs).find(name => resolved === path.resolve(root, name).replace(/\.ts$/, '.js'));
        if (dependency) return stubs[dependency];
        if (request.startsWith('.')) assertRuntimeUnitBoundary(resolved, root);
        return original.call(this, request, parent, ...args);
    };
    try {
        const filename = path.resolve(root, file);
        delete require.cache[require.resolve(filename)];
        return require(filename);
    } finally { Module._load = original; }
}

test('KeepAlive does nothing without the necessary Worker API', () => {
    const originalChrome = globalThis.chrome;
    const originalInterval = globalThis.setInterval;
    let intervals = 0;
    try {
        (globalThis as any).chrome = { runtime: {} };
        (globalThis as any).setInterval = () => { intervals++; return 1; };
        const { startKeepAlive } = load('src/runtime/background/keepAlive.ts');
        startKeepAlive()();
        assert.equal(intervals, 0);
    } finally {
        globalThis.chrome = originalChrome;
        globalThis.setInterval = originalInterval;
    }
});

test('KeepAlive pings only during an active task and stops exactly once', () => {
    const originalChrome = globalThis.chrome;
    const originalInterval = globalThis.setInterval;
    const originalClear = globalThis.clearInterval;
    let pulse!: () => void;
    const periods: number[] = [];
    const cleared: unknown[] = [];
    let pings = 0;
    try {
        (globalThis as any).chrome = { runtime: { getPlatformInfo: (callback: Function) => { pings++; callback({}); } } };
        (globalThis as any).setInterval = (callback: () => void, period: number) => { pulse = callback; periods.push(period); return 91; };
        (globalThis as any).clearInterval = (id: unknown) => { cleared.push(id); };
        const { startKeepAlive } = load('src/runtime/background/keepAlive.ts');
        const stop = startKeepAlive();
        assert.deepEqual(periods, [20000]);
        assert.equal(pings, 0);
        pulse();
        assert.equal(pings, 1);
        stop();
        assert.deepEqual(cleared, [91]);
    } finally {
        globalThis.chrome = originalChrome;
        globalThis.setInterval = originalInterval;
        globalThis.clearInterval = originalClear;
    }
});

test('TabAction marks production Gemini tabs active and unrelated tabs inactive', async () => {
    const originalChrome = globalThis.chrome;
    const icons: unknown[] = [];
    const titles: unknown[] = [];
    try {
        (globalThis as any).chrome = { action: {
            setIcon: async (value: unknown) => { icons.push(value); },
            setTitle: async (value: unknown) => { titles.push(value); }
        } };
        const action = load('src/runtime/background/tabAction.ts');
        assert.equal(action.isGeminiTabUrl('https://gemini.google.com/u/1/app'), true);
        assert.equal(action.isGeminiTabUrl('https://example.com/gemini.google.com'), false);
        action.updateTabActionState(7, 'https://gemini.google.com/app');
        action.updateTabActionState(8, 'https://other.example/path');
        assert.equal(icons.length, 2);
        assert.deepEqual(icons[0], { tabId: 7, path: action.ACTION_COLOR_ICONS });
        assert.deepEqual(icons[1], { tabId: 8, path: action.ACTION_GRAY_ICONS });
        assert.match((titles[0] as any).title, /Active/);
    } finally { globalThis.chrome = originalChrome; }
});

test('disabled and non-Markdown Live Save never check directory or invoke an export', async () => {
    for (const settings of [
        { enabledDisk: false, defaultFormat: 'markdown', includeAssets: true },
        { enabledDisk: true, defaultFormat: 'pdf', includeAssets: false },
    ]) {
        const live = load('src/runtime/background/liveSaveHandler.ts', {
            'src/application/settings/index.js': { getSettings: async () => ({ ...v2Settings, ...settings }) },
            'src/l3a/storageService.js': { getDirectoryHandle: () => assert.fail('No directory lookup for inactive Live Save') },
            'src/application/export/runExport.js': { runExport: () => assert.fail('Unexpected second writer') },
            'src/runtime/background/keepAlive.js': { startKeepAlive: () => assert.fail('No keepalive for inactive export') },
        });
        assert.equal(await live.runLiveSave(key), null);
    }
});

test('missing or ungranted directory fails without mutating user Settings or prompting', async () => {
    const settings = { enabledDisk: true, defaultFormat: 'markdown', includeAssets: true };
    for (const handle of [null, { queryPermission: async () => 'prompt', requestPermission: () => assert.fail('Worker must not request user permission') }]) {
        const live = load('src/runtime/background/liveSaveHandler.ts', {
            'src/application/settings/index.js': { getSettings: async () => ({ ...v2Settings, ...settings }) },
            'src/l3a/storageService.js': { getDirectoryHandle: async () => handle },
            'src/application/export/runExport.js': { runExport: () => assert.fail('Export must not run') },
            'src/runtime/background/keepAlive.js': { startKeepAlive: () => assert.fail('KeepAlive must not start') },
        });
        await assert.rejects(live.runLiveSave(key), /directory|Reauthorize/);
        assert.equal(settings.enabledDisk, true);
    }
});

test('Live Save calls the single Application Export with fixed Markdown/Folder and releases KeepAlive', async () => {
    const result = { exported: 1, skipped: 0, partial: 0, failed: [], aborted: false };
    const steps: string[] = [];
    const live = load('src/runtime/background/liveSaveHandler.ts', {
        'src/application/settings/index.js': { getSettings: async () => ({ ...v2Settings, enabledDisk: true, includeAssets: false }) },
        'src/l3a/storageService.js': { getDirectoryHandle: async () => ({ queryPermission: async (request: unknown) => {
            assert.deepEqual(request, { mode: 'readwrite' });
            return 'granted';
        } }) },
        'src/application/export/runExport.js': { runExport: async (request: unknown) => {
            steps.push('export');
            assert.deepEqual(request, { keys: [key], format: 'markdown', delivery: 'folderWriter', includeAssets: false, skipUnchanged: false });
            return result;
        } },
        'src/runtime/background/keepAlive.js': { startKeepAlive: () => { steps.push('keepAlive'); return () => steps.push('stop'); } },
    });
    assert.strictEqual(await live.runLiveSave(key), result);
    assert.deepEqual(steps, ['keepAlive', 'export', 'stop']);
});
