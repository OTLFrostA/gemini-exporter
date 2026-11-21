// L1 Sniffer request-time identity test moved out of Runtime's unit suite.
// All Runtime admission/account ports are mocked; the real L1 MessageBridge is the SUT.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const uuid = '12345678-1234-4234-8234-123456789abc';
const account = { id: uuid, providerId: 'gemini', providerAccountId: 'gaia' };
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
function contentWindow() {
    const target = new EventTarget();
    return Object.assign(target, { __gemExporterCleanups: [] as Function[] });
}

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
        'src/runtime/api/contentAccountRegistry.js': { getContentAccount: async () => account },
        'src/runtime/content/accountContext.js': { resolveRequestAccount: async () => { await pending; return context; }, resolveCurrentAccount: async () => current },
        'src/runtime/api/contentDomainIngestion.js': { ingestContentIndexes: async () => { commits++; current = { ...context, accountId: '87654321-4321-4321-8321-cba987654321' }; } },
        'src/l1/client/gemini/listObservation.js': {},
        'src/l1/parsers/gemini/rpc/parseConversation.js': {},
        'src/l1/parsers/gemini/rpc/mergePages.js': {},
        'src/l1/parsers/gemini/parseIndexObservation.js': { parseGeminiIndexObservation: () => ({ conversationId: 'abcdef123456', fields: {} }) },
        'src/l1/parsers/gemini/dom/parseIndex.js': { parseGeminiDomIndex: () => ({}) },
        'src/shared/utils/devMode.js': { isDevMode: () => false },
        'src/l1/parsers/gemini/rpc/parseList.js': {},
    });
    bridge.init({ onStreamComplete: (key: unknown) => keys.push(key) });
    const event = { source: global.window, origin: global.location.origin, data: { type: 'GEMINI_STREAM_GENERATE_COMPLETE', payload: { slot: 'u0', requestAccountObservation: { providerId: 'gemini', providerAccountId: 'gaia' }, id: 'abcdef123456' } } };
    const operation = bridge.handleWindowMessage(event);
    await Promise.resolve(); assert.equal(commits, 0);
    event.data.payload.id = 'mutated_after_ingress';
    finish(); await operation;
    assert.equal(commits, 1);
    assert.deepEqual(keys, [{ accountId: uuid, conversationId: 'abcdef123456' }]);
});
