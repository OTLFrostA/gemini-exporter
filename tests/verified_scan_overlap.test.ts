import { accountRuntime } from './helpers/accountRuntime.js';
const test = require('node:test');
const assert = require('node:assert');
const { __setModuleOverride, __clearModuleOverrides } = require('../src/shared/utils/moduleOverrides.js');
const { defaultGeminiProvider } = require('../src/l1/client/gemini/geminiProvider.js');
const { contentContext } = require('../src/runtime/content/contentContext.js');
const { syncConversations } = require('../src/runtime/content/syncEngine.js');

test('production scan entry admits one pagination call while another scan is pending', async () => {
    const oldDocument = (global as any).document;
    const oldLocation = (global as any).location;
    const oldChrome = (global as any).chrome;
    const originalList = defaultGeminiProvider.listConversations;
    const lifecycle = require('../src/application/sync/scanLifecycle.js');
    const begin = test.mock.method(lifecycle, 'beginScanCoverage', async () => ({ runId: 'test-run', previous: null }));
    const finish = test.mock.method(lifecycle, 'finishScanCoverage', async () => true);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let calls = 0;
    (global as any).document = { getElementById: () => null };
    (global as any).location = { href: 'https://gemini.google.com/app', pathname: '/app' };
    (global as any).chrome = { runtime: { sendMessage: async () => {} } };
    const runtime = accountRuntime();
    __setModuleOverride('StorageService', { beginScanCoverage: async () => ({ runId: 'test-run', previous: null }), finishScanCoverage: async () => true });
    defaultGeminiProvider.listConversations = async () => {
        calls++;
        entered();
        await gate;
        return { items: [], conversations: [], total: 0, stoppedEarly: true, exhaustive: false, completionReason: 'error', diagnostics: null } as any;
    };
    try {
        const first = syncConversations();
        await started;
        const second = await syncConversations();
        assert.strictEqual(second, null);
        assert.strictEqual(calls, 1);
        release();
        await first;
        assert.strictEqual(contentContext.getDeepScanPromise(), null, 'the first scan must release its scan lock');
        await syncConversations();
        assert.strictEqual(calls, 2, 'a completed scan must allow a subsequent fresh pagination request');
    } finally {
        begin.mock.restore(); finish.mock.restore();
        runtime.restore();
        release();
        defaultGeminiProvider.listConversations = originalList;
        contentContext.setDeepScanPromise(null);
        __clearModuleOverrides();
        (global as any).document = oldDocument;
        (global as any).location = oldLocation;
        (global as any).chrome = oldChrome;
    }
});
