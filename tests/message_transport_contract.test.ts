import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTypedMessage, isMessageAction, getErrorMessage } from '../src/core/utils/messaging.js';
import { sendToGeminiTab, sendToAITab, checkGeminiStatus, openGeminiPage, reloadGeminiTab } from '../src/core/utils/tabService.js';
import { isScanResponse, readPopupFetchResult } from '../src/core/utils/messageResponses.js';
import type { PopupFetchResult, PopupExportInput } from '../src/core/utils/messageResponses.js';
import { startDeepScan, startIncrementalScan, isScanning, setScanRunning } from '../src/ui/controllers/syncController.js';
import type { BaseMessage, FetchChatMessage } from '../src/types/messages.js';
import type { ScanCallbacks, ScanResponse } from '../src/types/ui.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ArbitraryResponseSender = <T extends BaseMessage, R>(message: T, timeout?: number) => Promise<R>;
type Contracts = [
    Assert<Equal<Awaited<ReturnType<typeof sendTypedMessage>>, unknown>>,
    Assert<Equal<Awaited<ReturnType<typeof sendToGeminiTab>>, unknown>>,
    Assert<Equal<Awaited<ReturnType<typeof sendToAITab>>, unknown>>,
    Assert<Equal<Parameters<typeof sendToGeminiTab>[0], unknown>>,
    Assert<Equal<typeof sendTypedMessage extends ArbitraryResponseSender ? true : false, false>>,
    Assert<Equal<Parameters<typeof startDeepScan>[1], ScanCallbacks | undefined>>,
    Assert<Equal<Parameters<typeof startIncrementalScan>[1], ScanCallbacks | undefined>>,
    Assert<Equal<ReturnType<typeof readPopupFetchResult>, PopupFetchResult>>,
    Assert<Equal<Awaited<ReturnType<typeof openGeminiPage>>, unknown>>,
    Assert<Equal<Awaited<ReturnType<typeof reloadGeminiTab>>, unknown>>,
    Assert<Equal<PopupExportInput['messages'][number], unknown>>
];
const contracts: Contracts = [true, true, true, true, true, true, true, true, true, true, true];
function actionOnly(input: unknown): void {
    if (isMessageAction(input, 'fetchChat')) {
        const narrow: Assert<Equal<typeof input, { action: 'fetchChat' }>> = true;
        const notPayload: Assert<Equal<typeof input extends FetchChatMessage ? true : false, false>> = true;
        void narrow; void notPayload;
    }
}
void actionOnly;

function replaceGlobal(key: string, value: unknown): () => void {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    return () => {
        if (previous) Object.defineProperty(globalThis, key, previous);
        else Reflect.deleteProperty(globalThis, key);
    };
}

test('transport contract leaves arbitrary replies opaque and action guards only prove action', async () => {
    assert.ok(contracts.every(Boolean));
    const reply = { arbitrary: ['not a known response'] };
    const restore = replaceGlobal('chrome', { runtime: {
        sendMessage(_message: unknown, callback: (value: unknown) => void) { callback(reply); }
    } });
    try { assert.equal(await sendTypedMessage({ action: 'ping' }, 100), reply); }
    finally { restore(); }
    assert.equal(isMessageAction({ action: 'fetchChat' }, 'fetchChat'), true);
    assert.equal(isMessageAction({}, 'fetchChat'), false);
    assert.equal(getErrorMessage({ message: 123 }), '[object Object]');
});

test('scan validation rejects malformed fields while preserving valid diagnostics and identity', () => {
    const reply = { success: true, count: 2, diagnostics: { hitGoogleLimit: true,
        stopReason: 'quota', pageHistory: [{ page: 1 }] } };
    assert.equal(isScanResponse(reply), true);
    if (isScanResponse(reply)) {
        const count: number | undefined = reply.count;
        void count;
        assert.equal(reply.diagnostics.pageHistory.length, 1);
    }
    for (const bad of [null, [], {}, { success: 'true' }, { success: true, count: '2' },
        { success: true, total: Infinity }, { success: true, count: NaN },
        { success: false, error: {} }, { success: true, hitGoogleLimit: 'yes' },
        { success: true, diagnostics: null }, { success: true, diagnostics: { stopReason: 4 } },
        { success: true, diagnostics: { hitGoogleLimit: 'false' } }]) {
        assert.equal(isScanResponse(bad), false);
    }
    assert.equal(isScanResponse({ success: false, error: 'HTTP 429' }), true);
});

test('popup validation preserves rich envelope/direct replies and rejects false success shapes', () => {
    const chat = { id: 'abc', title: 'Report', messages: [{ role: 'model', content: 'body' }],
        rawProviderEvidence: { keep: true } };
    for (const value of [{ success: true, data: chat }, { success: true, ...chat }]) {
        const parsed = readPopupFetchResult(value);
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.chat, 'data' in value ? chat : value);
            assert.equal(parsed.chat.rawProviderEvidence, chat.rawProviderEvidence);
        }
    }
    for (const bad of [null, [], {}, { success: 'true', data: chat }, { success: true, data: 'bad' },
        { success: true, data: {} }, { success: true, data: { id: 123, messages: [] } },
        { success: true, data: { title: {}, messages: [] } },
        { success: true, data: { messages: 'not an array' } }]) {
        assert.equal(readPopupFetchResult(bad).success, false);
    }
    assert.deepEqual(readPopupFetchResult({ success: false, error: 'offline' }), { success: false, error: 'offline' });
});

test('scan consumer never completes malformed replies and always releases its running state', async () => {
    const restoreDoc = replaceGlobal('document', { getElementById: () => null });
    try {
        for (const reply of [{ success: 'true', count: 2 }, { success: true, count: '2' }, null]) {
            const restoreChrome = replaceGlobal('chrome', { runtime: {
                sendMessage(_message: unknown, callback: (value: unknown) => void) { callback(reply); }
            } });
            try {
                let completed = false;
                const err = await new Promise<Error>(resolve => startDeepScan('u0', {
                    onFinished() { completed = true; resolve(new Error('Unexpected successful completion')); },
                    onError(error) { resolve(error); }
                }));
                assert.match(err.message, /unreadable sync data/);
                assert.equal(completed, false);
                assert.equal(isScanning(), false);
            } finally { restoreChrome(); }
        }
        const reply: ScanResponse = { success: true, count: 2, diagnostics: { hitGoogleLimit: true } };
        const restoreChrome = replaceGlobal('chrome', { runtime: {
            sendMessage(_message: unknown, callback: (value: unknown) => void) { callback(reply); }
        } });
        try {
            const result = await new Promise<Parameters<NonNullable<ScanCallbacks['onFinished']>>[0]>((resolve, reject) =>
                startIncrementalScan('u0', { onFinished: resolve, onError: reject }));
            assert.equal(result.res, reply);
            assert.equal(result.hitGoogleLimit, true);
            assert.equal(isScanning(), false);
        } finally { restoreChrome(); }
    } finally { setScanRunning(false); restoreDoc(); }
});

test('ping connection status requires an actual boolean acknowledgement', async () => {
    for (const reply of [{ ok: 'true' }, { ok: 1 }, [], null, { ok: true, version: 'test' }]) {
        const restore = replaceGlobal('chrome', {
            tabs: { query: async () => [{ id: 1, active: true, url: 'https://gemini.google.com/app' }],
                sendMessage(_id: number, _message: unknown, callback: (value: unknown) => void) { callback(reply); } },
            runtime: {}
        });
        try {
            const status = await checkGeminiStatus();
            assert.equal(status.status, reply && 'ok' in reply && reply.ok === true ? 'CONNECTED' : 'NEED_REFRESH');
        } finally { restore(); }
    }
});
