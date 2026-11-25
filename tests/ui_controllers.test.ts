import test from 'node:test';
import assert from 'node:assert/strict';
import { A, B, assertUiNodeIsolation, installUiV2Mocks } from './helpers/uiV2Mocks.js';

// Only load UI code after replacing the Application/Runtime/L1/Storage modules
// with their v2 public ports. No Application Export engine is executed here.
installUiV2Mocks();
const { startSync } = require('../src/ui/options/controllers/syncController.js') as
    typeof import('../src/ui/options/controllers/syncController.js');
const { handleTakeoutImport } = require('../src/ui/options/controllers/takeoutController.js') as
    typeof import('../src/ui/options/controllers/takeoutController.js');
const { createBackoffNotice } = require('../src/ui/shared/backoffNotice.js') as
    typeof import('../src/ui/shared/backoffNotice.js');
const { errorText } = require('../src/ui/shared/settings.js') as
    typeof import('../src/ui/shared/settings.js');
assertUiNodeIsolation();

test('syncController aborts after resolving source but before launching the mocked Scan', async () => {
    const controller = new AbortController();
    let scans = 0;
    const operation = startSync(A, { signal: controller.signal, onTarget: async () => controller.abort() }, {
        resolveScanTarget: async () => A,
        scanAll: async () => { scans++; throw Error('Unexpected Scan'); },
    });
    await assert.rejects(operation, { name: 'AbortError' });
    assert.equal(scans, 0);
});

test('syncController uses the verified source, ScanRequest and committed v2 progress', async () => {
    const seen: unknown[] = [];
    const signal = new AbortController().signal;
    const result = await startSync(B, { signal, forceFull: true,
        onTarget: async id => { seen.push(['target', id]); },
        onProgress: progress => { seen.push(progress); } }, {
        resolveScanTarget: async preferred => { assert.equal(preferred, B); return A; },
        scanAll: async (scanRequest, options) => {
            seen.push(scanRequest);
            assert.strictEqual(options?.signal, signal);
            options?.onProgress?.({ pagesFetched: 2, conversationsFetched: 151 });
            return { status: 'partial_limit', reason: 'max_pages', pagesFetched: 2, conversationsFetched: 151 };
        },
    });
    assert.deepEqual(seen, [['target', A], { accountId: A, forceFull: true },
        { pagesFetched: 2, conversationsFetched: 151 }]);
    assert.equal(result.reason, 'max_pages');
});

test('syncController passes source resolution errors through without starting a Scan', async () => {
    const failure = new Error('Receiving end does not exist');
    let scans = 0;
    await assert.rejects(startSync(A, { signal: new AbortController().signal, onTarget: async () => {} }, {
        resolveScanTarget: async () => { throw failure; },
        scanAll: async () => { scans++; throw Error('Unexpected Scan'); },
    }), error => error === failure);
    assert.equal(scans, 0);
    assert.equal(errorText(failure), 'Operation failed. Please retry; details are available in the logs or diagnostic report.');
    assert.equal(failure.message, 'Receiving end does not exist', 'the diagnostic error stays intact');
});

test('native picker cancellation is readable and never exposes the browser API exception', () => {
    assert.equal(errorText(new DOMException("Failed to execute 'showDirectoryPicker' on 'Window': The user aborted a request.", 'AbortError')),
        'Operation cancelled. You can try again.');
});

test('takeoutController uses v2 Account/Settings/Import mocks with selected Account UUID', async () => {
    const file = new File(['fixture'], 'takeout.zip');
    const seen: unknown[] = [];
    const account = { id: A, providerId: 'gemini', providerAccountId: 'fixture' };
    const result = await handleTakeoutImport(file, A, {
        onTarget: async id => { seen.push(['target', id]); },
        onProgress: value => { seen.push(['progress', value]); },
    }, {
        listAccounts: async () => [account],
        getAccount: async id => { assert.equal(id, A); return account; },
        getOrCreateAccount: async () => { throw Error('Unexpected account creation'); },
        updateSettings: async patch => { seen.push(['settings', patch]); },
        importTakeout: async (actual, id, progress) => {
            assert.strictEqual(actual, file);
            assert.equal(id, A);
            progress?.(100);
            return { imported: 1, added: 0, status: 'ok' as const };
        },
    });
    assert.deepEqual(seen, [['target', A], ['settings', { takeoutPromptCompleted: true }], ['progress', 100]]);
    assert.deepEqual(result, { imported: 1, added: 0, status: 'ok' });
});

test('createBackoffNotice handles provider-agnostic rate-limit and backoff codes with boolean observation feedback', () => {
    const notice = createBackoffNotice();
    assert.equal(notice.observe({ code: 'UNRELATED_EVENT', details: { requestId: 'r1', retryAt: Date.now() + 5000 } }), false);
    assert.equal(notice.message(), null);

    assert.equal(notice.observe({ code: 'CLAUDE_BACKOFF_WAIT', details: { requestId: 'r1', retryAt: Date.now() + 15000 } }), true);
    assert.match(notice.message() ?? '', /^Claude rate limited \(429\): backing off;/);
    assert.equal(notice.observe({ code: 'CLAUDE_BACKOFF_END', details: { requestId: 'r1' } }), true);
    assert.equal(notice.message(), null);

    assert.equal(notice.observe({ code: 'GROK_COOLDOWN_ACTIVE', details: { retryAt: Date.now() + 120000 } }), true);
    assert.match(notice.message() ?? '', /^Grok rate limited \(429\): export stopped;/);
});
