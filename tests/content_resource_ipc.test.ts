import test from 'node:test';
import assert from 'node:assert/strict';
import { accountRuntime, ACCOUNT_UUID, ACCOUNT_OBSERVATION } from './helpers/accountRuntime.js';
import { resolveCurrentAccount } from '../src/runtime/content/accountContext.js';
import { init } from '../src/runtime/content/messageRouter.js';
import { runCleanups } from '../src/runtime/content/cleanupRegistry.js';
import { AssetFetcher, handleGetImageBlob } from '../src/l1/resources/gemini/assetFetcher.js';
import { liveCoordinatorHost } from './helpers/liveCoordinatorHost.js';
import { executeLiveSave } from '../src/runtime/content/liveSaveCoordinator.js';
import { createHookSandbox } from './helpers/hookSandbox.js';
import { listGen as geminiListGen } from './fixtures/providers/gemini.js';
import { requestGen as geminiListRequestGen } from './fixtures/providers/geminiListRequest.js';
import { mount, read } from './helpers/uiPortHarness.js';

async function router(t: import('node:test').TestContext) {
    const runtime = accountRuntime();
    await resolveCurrentAccount(ACCOUNT_OBSERVATION, 'u0');
    type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
    const listeners = new Set<Listener>();
    Object.assign(chrome.runtime, {
        id: 'own',
        onMessage: {
            addListener: (fn: Listener) => listeners.add(fn),
            removeListener: (fn: Listener) => listeners.delete(fn),
        },
    });
    init();
    t.after(() => { runCleanups(); runtime.restore(); });
    return {
        listeners,
        request: () => new Promise<Record<string, unknown>>(resolve => {
            [...listeners][0](
                { action: 'getFileBlob', accountId: ACCOUNT_UUID, url: 'https://lh3.googleusercontent.com/a' },
                { id: 'own' } as chrome.runtime.MessageSender,
                value => resolve(value as Record<string, unknown>),
            );
        }),
    };
}

test('missing resource replies terminate with failure while valid replies survive', async t => {
    const host = await router(t);
    for (const payload of [undefined, { success: true, dataBase64: 'AQID', size: 3 }]) {
        t.mock.method(AssetFetcher, 'handleGetFileBlob', async (_message: unknown, reply: (v: unknown) => void) => {
            if (payload !== undefined) reply(payload);
        });
        const result = await host.request();
        assert.equal(result.success, (payload && payload.success) || false);
        if (!payload) assert.match(String(result.error), /no result|Invalid resource/);
        t.mock.restoreAll();
    }
});

test('resource IPC rejects oversized replies before delivering bytes and deduplicates repeated callbacks', async t => {
    const h = await router(t);
    t.mock.method(AssetFetcher, 'handleGetFileBlob', async (_message: unknown, reply: (v: unknown) => void) => {
        reply({ success: true, size: 51 * 1024 * 1024, dataBase64: 'AQID' });
    });
    const oversized = await h.request();
    assert.equal(oversized.success, false);
    assert.match(String(oversized.error), /IPC size limit/);
    assert.equal('dataBase64' in oversized, false);
    t.mock.restoreAll();

    let calls = 0;
    t.mock.method(AssetFetcher, 'handleGetFileBlob', async (_m: unknown, reply: (v: unknown) => void) => {
        reply({ success: true, size: 1, dataBase64: 'AQ==' });
        reply({ success: true, size: 1, dataBase64: 'Ag==' });
    });
    const done = new Promise<void>(resolve => [...h.listeners][0](
        { action: 'getFileBlob', accountId: ACCOUNT_UUID, url: 'https://lh3.googleusercontent.com/a' },
        { id: 'own' } as chrome.runtime.MessageSender,
        () => { calls++; resolve(); },
    ));
    await done;
    await Promise.resolve();
    assert.equal(calls, 1);
});

test('>50 MiB image succeeds as a direct ArrayBuffer and is rejected over Base64', async () => {
    const originalFetch = globalThis.fetch;
    const bytes = new Uint8Array([1, 2, 3]);
    const oversize = {
        size: 51 * 1024 * 1024,
        type: 'image/png',
        arrayBuffer: async () => bytes.buffer,
    };
    globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        blob: async () => oversize,
    } as unknown as Response)) as typeof fetch;
    try {
        const replies: Array<{ success: boolean; dataBuffer?: ArrayBuffer; error?: string }> = [];
        await handleGetImageBlob(
            { url: 'https://lh3.googleusercontent.com/example', preferBuffer: true },
            reply => replies.push(reply),
        );
        assert.equal(replies.length, 1);
        assert.equal(replies[0].success, true);
        assert.deepEqual(new Uint8Array(replies[0].dataBuffer!), bytes);

        replies.length = 0;
        await handleGetImageBlob(
            { url: 'https://lh3.googleusercontent.com/example', preferBuffer: false },
            reply => replies.push(reply),
        );
        assert.equal(replies.length, 1);
        assert.equal(replies[0].success, false);
        assert.match(replies[0].error || '', /too large/i);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('runtime listener cleanup permits clean reinitialization and Live Save coordinator does not drop consecutive commits', async t => {
    const h = await router(t);
    assert.equal(h.listeners.size, 1);
    runCleanups();
    assert.equal(h.listeners.size, 0);
    init();
    assert.equal(h.listeners.size, 1);
    runCleanups();
    assert.equal(h.listeners.size, 0);

    const live = await liveCoordinatorHost(t);
    await executeLiveSave(live.key);
    await executeLiveSave(live.key);
    assert.equal(live.sent.length, 2);
});

test('sniffed batchexecute stream reader enforces capture byte cap, cancels the clone stream early, and marks payload truncated', async () => {
    const { posted, win } = createHookSandbox();
    const headerBytes = new TextEncoder().encode(geminiListGen('G_EXTRACTED_REGRESSION_FILTER_LIST_01'));
    const chunkBytes = new Uint8Array(256 * 1024).fill(32); // 256 KiB whitespace padding per pull
    let pulledChunks = 0;
    let cloneCancelled = false;

    // Install custom streaming upstream fetch before the wrapped hook calls origFetch.
    // Note: createHookSandbox wraps win.fetch at initialization; replace the underlying response source
    // by overriding Response.prototype.clone on a custom Response instance.
    const fullResponse = new Response(headerBytes);
    fullResponse.clone = () => {
        let sentHeader = false;
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (!sentHeader) {
                    sentHeader = true;
                    controller.enqueue(headerBytes);
                    return;
                }
                if (pulledChunks >= 40) {
                    controller.close();
                    return;
                }
                pulledChunks++;
                controller.enqueue(chunkBytes);
            },
            cancel() {
                cloneCancelled = true;
            },
        });
        return new Response(stream, { status: 200 });
    };

    // Intercept the sandbox's internal response factory via a custom Request flow:
    const prevResponse = globalThis.Response;
    let nextCustomResponse: Response | null = fullResponse;
    const origWinFetch = win.fetch;
    void origWinFetch;
    // hookSandbox's origFetch calls `new Response(win.__nextResponseText)` inside sandbox context,
    // where `Response` is globalThis.Response passed into vm context at creation time.
    const origClone = prevResponse.prototype.clone;
    prevResponse.prototype.clone = function(this: Response) {
        if (nextCustomResponse) {
            const target = nextCustomResponse;
            nextCustomResponse = null;
            return target.clone();
        }
        return origClone.call(this);
    };

    try {
        await win.fetch('https://gemini.google.com/u/0/batchexecute', {
            method: 'POST',
            body: geminiListRequestGen('G_HOOK_GENERIC_PROBE_REQUEST_01'),
        });
        const deadline = Date.now() + 1000;
        while (!posted.some(p => p.msg.type === 'GEMINI_NETWORK_BATCHEXECUTE') && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 10));
        }
    } finally {
        prevResponse.prototype.clone = origClone;
    }

    const relay = posted.find(p => p.msg.type === 'GEMINI_NETWORK_BATCHEXECUTE');
    assert.ok(relay, 'oversized batchexecute stream must still emit truncated event');
    assert.equal(relay.msg.payload.truncated, true, 'oversized response must be flagged truncated');
    assert.ok(typeof relay.msg.payload.text === 'string' && relay.msg.payload.text.length <= 3_000_000);
    assert.equal(cloneCancelled, true, 'cloned stream reader must be cancelled once capture cap is reached');
    assert.ok(pulledChunks < 20, `stream reader should stop pulling after ~3 MiB cap, pulled=${pulledChunks}`);
});

test('a thrown export releases Options UI busy state and permits the next export attempt', async () => {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true, headless: true });
    try {
        const page = await browser.newPage();
        await mount(page, 'options', { throwExport: true });
        await page.locator('#btnSelectAll').click();
        await page.locator('#btnExport').click();
        await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Operation failed. Please retry; details are available in the logs or diagnostic report.');
        assert.equal(await page.locator('#btnExport').isEnabled(), true);
        await page.evaluate(() => { Reflect.get(window, 'harness').throwExport = false; });
        await page.locator('#btnExport').click();
        await page.waitForFunction(() => document.body.dataset.busy !== 'true');
        assert.equal((await read(page, 'exports')).length, 2);
    } finally {
        await browser.close();
    }
});
