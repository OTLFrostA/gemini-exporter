import { describe as __suiteDescribe } from 'node:test';
import { account } from "./helpers/applicationHarness.js";
import { key } from "./helpers/applicationHarness.js";
import { reset } from "./helpers/applicationHarness.js";
import { stubModule } from "./helpers/applicationHarness.js";
import { provider } from "./helpers/applicationHarness.js";
import { state } from "./helpers/applicationHarness.js";
import test from "node:test";
import assert from "node:assert/strict";
import { type StreamCoverage } from "../src/l2/streamCoverage.js";
import { type ScanHead } from "../src/l2/coverageAdmission.js";
import { type ListEnd } from "../src/l1/client/aiProvider.js";
import { chatgptAccount } from "./helpers/applicationHarness.js";
import { OperationError } from "../src/shared/errors/operationError.js";
import { importTakeout } from "../src/application/imports/importTakeout.js";
import { importOpenAI } from "../src/application/imports/importOpenAI.js";
import { createSourceResourceContext } from "../src/application/resources.js";
import { events } from "./helpers/applicationHarness.js";
import { getSettings } from "../src/application/settings/index.js";
import { updateSettings } from "../src/application/settings/index.js";
import { isLiveSaveEffective } from "../src/application/settings/index.js";
import { clearLocalScanRecords } from "../src/application/localCleanup.js";
import { clearLocalExportRecords } from "../src/application/localCleanup.js";

__suiteDescribe("application_sync", () => {
let baseline: StreamCoverage | null;
let boundary: boolean;
let reads = 0;
const checks: { baseline: StreamCoverage; head: ScanHead }[] = [];
stubModule('../../src/l2/coverageAdmission.js', { __esModule: true, default: {
    async getCoverage(accountId: string, streamId: string) {
        assert.equal(accountId, key().accountId); assert.equal(streamId, 'recent'); reads++; return baseline;
    },
    async hasTrustedBoundary(_account: string, baseline: StreamCoverage, head: ScanHead) { checks.push({ baseline, head }); return boundary; },
    resetAccountCoverage() {},
} });
const { scanAll } = require('../src/application/sync/scanController.js') as typeof import('../src/application/sync/scanController.js');
const head: ScanHead = { streamId: 'recent', requestKnown: true, requestCursor: null, nextCursor: 'next',
    valid: true, ordered: true, requestedAt: 1, keys: [{ id: 'first', time: 100 }] };
function trusted(): StreamCoverage {
    // L2 evidence is opaque to Application; use a real-shaped frozen historical range.
    return { range: { head: { id: 'old', time: 90 }, tail: { id: 'older', time: 10 } } } as StreamCoverage;
}
test.beforeEach(() => { reset(); baseline = null; boundary = false; reads = 0; checks.length = 0; });
test('Scan All fails closed on an invalid UUID or unverified online Account before Coverage or L1', async () => {
    let listCalls = 0;
    provider.listConversations = async () => { listCalls++; return 'source_end'; };
    assert.deepEqual(await scanAll({ accountId: 'not-a-uuid' }), {
        status: 'error', pagesFetched: 0, conversationsFetched: 0, reason: 'Invalid account UUID',
    });
    for (const unavailable of [null, { ...account, providerAccountId: 'default' }, { ...account, providerId: 'unsupported' }]) {
        state.accountOverride = unavailable;
        assert.deepEqual(await scanAll({ accountId: account.id }), {
            status: 'error', pagesFetched: 0, conversationsFetched: 0, reason: 'Verified provider account unavailable',
        });
    }
    assert.equal(reads, 0);
    assert.equal(listCalls, 0);
    state.accountOverride = undefined;
    assert.equal((await scanAll({ accountId: account.id })).status, 'complete', 'rejected attempts do not block later valid scans');
});
test('trusted empty Recent result can be complete without manufacturing a Coverage boundary', async () => {
    provider.listConversations = async () => 'source_end';
    const progress: unknown[] = [];
    assert.deepEqual(await scanAll({ accountId: account.id }, { onProgress: value => progress.push(value) }), {
        status: 'complete', pagesFetched: 0, conversationsFetched: 0,
    });
    assert.deepEqual(progress, []);
    assert.equal(reads, 1); assert.equal(checks.length, 0);
});

test('Scan All accepts a verified ChatGPT account and passes its UUID to the registered provider', async () => {
    state.accountOverride = { ...account, providerId: 'chatgpt', providerAccountId: '["user","workspace"]' };
    provider.listConversations = async options => {
        assert.equal(options.accountId, account.id);
        await options.onPageCommitted!({ page: 1, totalObserved: 2, scanHead: head });
        return 'source_end';
    };
    assert.deepEqual(await scanAll({ accountId: account.id }), {
        status: 'complete', pagesFetched: 1, conversationsFetched: 2,
    });
});
test('Scan All aggregates actual committed metadata admissions instead of source row counts', async () => {
    provider.listConversations = async options => {
        await options.onPageCommitted!({ page: 1, totalObserved: 25, indexChanges: { added: 12, updated: 8 } });
        await options.onPageCommitted!({ page: 2, totalObserved: 40, indexChanges: { added: 0, updated: 1 } });
        return 'source_end';
    };
    assert.deepEqual(await scanAll({ accountId: account.id }), {
        status: 'complete', pagesFetched: 2, conversationsFetched: 40, indexChanges: { added: 12, updated: 9 },
    });
});
test('unexpected Provider termination becomes a structured error, never undefined', async () => {
    provider.listConversations = async () => 'unknown_end' as ListEnd;
    assert.deepEqual(await scanAll({ accountId: account.id }), {
        status: 'error', pagesFetched: 0, conversationsFetched: 0, reason: 'Unknown provider list termination',
    });
});
test('already-aborted Scan does not read Coverage or enter the Provider', async () => {
    const controller = new AbortController(); controller.abort();
    let listCalls = 0;
    provider.listConversations = async () => { listCalls++; return 'source_end'; };
    assert.deepEqual(await scanAll({ accountId: account.id }, { signal: controller.signal }), {
        status: 'aborted', pagesFetched: 0, conversationsFetched: 0,
    });
    assert.equal(reads, 0); assert.equal(listCalls, 0);
});
for (const [end, status, reason] of [ ['source_end', 'complete', undefined], ['provider_limit', 'partial_limit', 'provider_limit'],
    ['max_pages', 'partial_limit', 'max_pages'], ['stopped', 'error', 'Unverified scan stop'] ] as const) {
    test(`L1 ${end} maps to ${status} using only committed counters`, async () => {
        provider.listConversations = async options => {
            assert.equal(options.streamId, 'recent'); assert.equal(options.accountId, key().accountId);
            assert.equal('cursor' in options, false); assert.equal('maxPages' in options, false);
            await options.onPageCommitted!({ page: 1, totalObserved: 25, scanHead: head });
            await options.onPageCommitted!({ page: 2, totalObserved: 40 });
            return end as ListEnd;
        };
        const progress: unknown[] = [];
        const result = await scanAll({ accountId: key().accountId }, { onProgress: p => progress.push(p) });
        assert.deepEqual(result, { status, pagesFetched: 2, conversationsFetched: 40, ...(reason ? { reason } : {}) });
        assert.deepEqual(progress, [{ pagesFetched: 1, conversationsFetched: 25 }, { pagesFetched: 2, conversationsFetched: 40 }]);
        assert.equal(checks.length, 0); assert.equal(reads, 1);
    });
}
test('historical range never skips the head request; trusted L2 connection stops the same sequential pipeline', async () => {
    baseline = trusted(); boundary = true;
    provider.listConversations = async options => {
        assert.equal(checks.length, 0);
        assert.equal(await options.onPageCommitted!({ page: 1, totalObserved: 1, scanHead: head }), true);
        return 'stopped';
    };
    assert.equal((await scanAll({ accountId: key().accountId })).status, 'up_to_date');
    assert.equal(checks.length, 1); assert.equal(checks[0].head, head);
});
test('baseline is cloned once; fresh coverage cannot replace startup history', async () => {
    baseline = trusted(); const original = structuredClone(baseline);
    provider.listConversations = async options => {
        baseline!.range = null;
        await options.onPageCommitted!({ page: 1, totalObserved: 2, scanHead: head });
        await options.onPageCommitted!({ page: 2, totalObserved: 4 });
        return 'source_end';
    };
    await scanAll({ accountId: key().accountId });
    assert.equal(checks.length, 2); assert.deepEqual(checks[0].baseline, original); assert.equal(reads, 1);
});
test('Force Full only bypasses boundary stopping and still calls the same Recent provider', async () => {
    baseline = trusted(); boundary = true;
    provider.listConversations = async options => {
        assert.equal(await options.onPageCommitted!({ page: 1, totalObserved: 1, scanHead: head }), false);
        return 'source_end';
    };
    assert.equal((await scanAll({ accountId: key().accountId, forceFull: true })).status, 'complete');
    assert.equal(checks.length, 0);
});
test('no baseline or no scanHead cannot produce trusted early stop', async () => {
    baseline = trusted(); boundary = true;
    provider.listConversations = async options => {
        assert.equal(await options.onPageCommitted!({ page: 1, totalObserved: 0 }), false); return 'source_end';
    };
    assert.equal((await scanAll({ accountId: key().accountId })).status, 'complete'); assert.equal(checks.length, 0);
});
test('failed later admission reports error and retains only previously committed counts', async () => {
    provider.listConversations = async options => {
        await options.onPageCommitted!({ page: 1, totalObserved: 10 }); throw new Error('Index commit failed');
    };
    assert.deepEqual(await scanAll({ accountId: key().accountId }), { status: 'error', pagesFetched: 1, conversationsFetched: 10, reason: 'Index commit failed' });
});
test('AbortSignal reaches L1; cancellation preserves committed pages and releases reentry guard', async () => {
    const controller = new AbortController();
    provider.listConversations = async options => {
        assert.equal(options.signal, controller.signal);
        await options.onPageCommitted!({ page: 1, totalObserved: 5 }); controller.abort(); options.signal!.throwIfAborted(); return 'source_end';
    };
    assert.deepEqual(await scanAll({ accountId: key().accountId }, { signal: controller.signal }), { status: 'aborted', pagesFetched: 1, conversationsFetched: 5 });
    provider.listConversations = async () => 'source_end';
    assert.equal((await scanAll({ accountId: key().accountId })).status, 'complete');
});
test('same-account reentry fails without starting a second scan', async () => {
    let nested: unknown;
    provider.listConversations = async () => { nested = await scanAll({ accountId: key().accountId }); return 'source_end'; };
    await scanAll({ accountId: key().accountId });
    assert.deepEqual(nested, { status: 'error', pagesFetched: 0, conversationsFetched: 0, reason: 'Scan already running' });
});
});

__suiteDescribe("application_imports", () => {
test.beforeEach(reset);

const dummyFile = () => ({ size: 16 } as unknown as File);

test('Application Takeout import admits parsed conversations to L2, notifies Runtime, and retains lazy archive readers only on acceptance', async () => {
    let entryReads = 0;
    state.takeoutParsed = [{
        conversationId: 'takeout-1',
        conversation: {
            index: { title: 'Offline title', titleSource: 'derived' },
            detail: {
                quality: { status: 'complete' },
                messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hi' }] }] }],
                assets: [{ id: 'img-1', kind: 'image', mediaType: 'image/png' }],
            },
        },
        diagnostics: [],
        acquisitionHints: {},
        archiveResources: {
            'img-1': {
                entry: { async: async () => { entryReads++; return Uint8Array.of(9, 8, 7); } },
                path: 'Takeout/Gemini/picture.png',
            },
        },
    }];
    const progress: number[] = [];
    const resources = createSourceResourceContext();
    state.detailDecision = { accepted: true, changed: true, indexAdded: true };
    const result = await importTakeout(dummyFile(), account.id, p => progress.push(p), resources);
    assert.deepEqual(result, { imported: 1, added: 1, status: 'ok' });
    assert.equal(state.admittedDetails.length, 1);
    assert.equal(state.admittedDetails[0].accountId, account.id);
    assert.equal(state.admittedDetails[0].conversationId, 'takeout-1');
    assert.deepEqual(state.notifications, [account.id]);
    assert.equal(progress.at(-1), 100);
    assert.equal(entryReads, 0);
    const key = { accountId: account.id, conversationId: 'takeout-1' };
    assert.deepEqual((await resources.acquire(key, { id: 'img-1', kind: 'image' })).bytes, Uint8Array.of(9, 8, 7));
    assert.equal(entryReads, 1);

    // Rejected L2 detail does not retain readers
    reset();
    state.takeoutParsed = [{
        conversationId: 'takeout-2',
        conversation: {
            index: {},
            detail: { quality: { status: 'complete' }, messages: [{ role: 'user', content: [] }], assets: [{ id: 'img-2', kind: 'image' }] },
        },
        diagnostics: [],
        acquisitionHints: {},
        archiveResources: { 'img-2': { entry: { async: async () => Uint8Array.of(1) }, path: 'a.png' } },
    }];
    state.detailDecision = { accepted: false, changed: false };
    const rejectedResources = createSourceResourceContext();
    const rejected = await importTakeout(dummyFile(), account.id, undefined, rejectedResources);
    assert.equal(rejected.added, 0, 'a rejected detail cannot count as a new local conversation');
    assert.equal(rejectedResources.has({ accountId: account.id, conversationId: 'takeout-2' }, 'img-2'), false);
});

test('Application Takeout import rejects foreign providers with GEMINI_ACCOUNT_REQUIRED and propagates L2 errors', async () => {
    await assert.rejects(
        importTakeout(dummyFile(), chatgptAccount.id),
        (err: unknown) => err instanceof OperationError && err.code === 'GEMINI_ACCOUNT_REQUIRED',
    );
    assert.equal(state.admittedDetails.length, 0);

    state.takeoutParsed = [{
        conversationId: 'takeout-err',
        conversation: { index: {}, detail: { quality: { status: 'complete' }, messages: [{ role: 'user', content: [] }], assets: [] } },
        diagnostics: [],
        acquisitionHints: {},
        archiveResources: {},
    }];
    state.detailError = new Error('L2 commit failed');
    await assert.rejects(importTakeout(dummyFile(), account.id), /L2 commit failed/);
});

test('Application OpenAI import orchestrates L1 archive parsing, L2 admission, lazy resource retention and empty/partial status', async () => {
    await assert.rejects(
        importOpenAI(new Uint8Array([1]), account.id),
        (err: unknown) => err instanceof OperationError && err.code === 'CHATGPT_ACCOUNT_REQUIRED',
    );

    state.openaiParsed = { conversationCount: 0, conversations: [], skippedEmpty: 0, missingAssets: 0 };
    assert.equal((await importOpenAI(new Uint8Array([1]), chatgptAccount.id)).status, 'empty');
    state.notifications.length = 0;

    const assetEntry = {
        path: 'file-1.dat',
        size: 3,
        text: async () => 'abc',
        bytes: async () => Uint8Array.of(1, 2, 3),
    };
    state.openaiParsed = {
        conversationCount: 1,
        skippedEmpty: 0,
        missingAssets: 0,
        conversations: [{
            conversationId: 'gpt-1',
            parsed: {
                conversationId: 'gpt-1',
                conversation: {
                    index: { title: 'GPT Chat', titleSource: 'provider', updatedAt: 1000 },
                    detail: {
                        quality: { status: 'complete' },
                        messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello' }] }] }],
                        assets: [{ id: 'asset-1', kind: 'file', name: 'doc.txt' }],
                    },
                },
                diagnostics: [],
                acquisitionHints: {},
            },
            boundEntries: new Map([['asset-1', assetEntry]]),
            missingAssets: 0,
        }],
    };
    const resources = createSourceResourceContext();
    const progress: number[] = [];
    state.detailDecision = { accepted: true, changed: true, indexAdded: true };
    const okResult = await importOpenAI(new Uint8Array([1]), chatgptAccount.id, p => progress.push(p), resources);
    assert.deepEqual(okResult, { read: 1, imported: 1, added: 1, skipped: 0, missingAssets: 0, status: 'ok' });
    assert.equal(progress.at(-1), 100);
    assert.deepEqual(state.notifications, [chatgptAccount.id]);
    assert.ok(resources.has({ accountId: chatgptAccount.id, conversationId: 'gpt-1' }, 'asset-1'));

    // Rejected detail increments skipped and marks partial
    state.detailDecision = { accepted: false, changed: false };
    const skippedResult = await importOpenAI(new Uint8Array([1]), chatgptAccount.id);
    assert.deepEqual(skippedResult, { read: 1, imported: 0, added: 0, skipped: 1, missingAssets: 0, status: 'partial' });
});
});

__suiteDescribe("application_settings_cleanup", () => {
test.beforeEach(reset);
test('Settings defaults are applied only on read; explicit choices are preserved', async () => {
    assert.deepEqual(await getSettings(), { defaultFormat: 'markdown', skipExported: true, includeAssets: false, enabledDisk: false, developerMode: false, exportDelivery: 'browserDownload' });
    assert.deepEqual(events, []);
    await updateSettings({ includeAssets: false, language: 'en' });
    await updateSettings({ enabledDisk: true });
    const settings = await getSettings();
    assert.equal(settings.includeAssets, false);
    await updateSettings({ includeAssets: true });
    assert.equal((await getSettings()).includeAssets, true);
    assert.equal(settings.language, 'en'); assert.equal(settings.enabledDisk, true);
});
test('sparse Settings patches preserve optional Spotlight, Takeout and Badge state', async () => {
    const badgePosition = { left: 12, top: 34 };
    await updateSettings({ lastSeenFeatureVersion: '1.8.0', takeoutPromptCompleted: true, badgePosition });
    await updateSettings({ includeAssets: false, skipExported: false });
    assert.deepEqual(await getSettings(), {
        defaultFormat: 'markdown', skipExported: false, includeAssets: false,
        enabledDisk: false, developerMode: false, exportDelivery: 'browserDownload',
        lastSeenFeatureVersion: '1.8.0', takeoutPromptCompleted: true, badgePosition,
    });
    assert.deepEqual(events, ['settings-write', 'settings-write']);
});
test('Live Save format and directory changes pause effectiveness without mutating user intent', async () => {
    await updateSettings({ enabledDisk: true });
    const markdown = await getSettings();
    assert.equal(markdown.exportDelivery, 'folderWriter', 'existing Live Save users retain the local folder mode');
    assert.equal(isLiveSaveEffective(markdown, true), true);
    assert.equal(isLiveSaveEffective(markdown, false), false);
    for (const defaultFormat of ['pdf', 'html', 'json'] as const) {
        await updateSettings({ defaultFormat });
        assert.equal(isLiveSaveEffective(await getSettings(), true), false);
        assert.equal((await getSettings()).enabledDisk, true);
    }
    await updateSettings({ defaultFormat: 'markdown' });
    assert.equal(isLiveSaveEffective(await getSettings(), true), true);
    await updateSettings({ exportDelivery: 'browserDownload' });
    assert.equal((await getSettings()).enabledDisk, true, 'browser mode pauses without clearing intent');
    assert.equal(isLiveSaveEffective(await getSettings(), true), false);
    await updateSettings({ exportDelivery: 'folderWriter' });
    assert.equal(isLiveSaveEffective(await getSettings(), true), true);
    assert.equal(events.filter(event => event === 'settings-write').length, 7);
});
test('Settings IO failures propagate instead of silently manufacturing defaults or claiming success', async () => {
    state.failSettingsRead = true; await assert.rejects(getSettings(), /read failed/);
    state.failSettingsWrite = true; await assert.rejects(updateSettings({ language: 'en' }), /write failed/);
    assert.deepEqual(events, []);
});
test('clearExportRecords delegates exactly once to the account-scoped Storage port', async () => {
    await clearLocalExportRecords(key().accountId);
    assert.deepEqual(events, ['clear-export:' + key().accountId]);
});
test('clearScanRecords delegates one combined Storage transaction, never separate Export cleanup', async () => {
    await clearLocalScanRecords(key().accountId);
    assert.deepEqual(events, ['clear-scan:' + key().accountId]);
});
test('clearExportRecords propagates a failed Storage transaction', async () => {
    state.failDelete = 'record';
    await assert.rejects(clearLocalExportRecords(key().accountId), /delete failed/);
    assert.deepEqual(events, ['clear-export:' + key().accountId]);
});
test('clearScanRecords propagates a failed Storage transaction without triggering another call', async () => {
    state.failDelete = 'coverage';
    await assert.rejects(clearLocalScanRecords(key().accountId), /coverage failed/);
    assert.deepEqual(events, ['clear-scan:' + key().accountId]);
});
});
