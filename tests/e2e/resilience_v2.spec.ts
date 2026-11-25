import { test, expect, seedRegistryAccounts, getActiveServiceWorker } from './fixtures';
import { accountId, openOptions, seedConversations, storedSettings } from './uiFixture';
import { listGen as geminiListGen } from '../fixtures/providers/gemini.js';
import { requestGen as geminiListRequestGen } from '../fixtures/providers/geminiListRequest.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
);

test.beforeEach(async ({ context }) => {
    await seedRegistryAccounts(context);
});

test('includeAssets: true recovers via credential-less CORS fallback and records 404 expired asset in report.json', async ({ context, extensionId }) => {
    const imageUrl = 'https://lh3.googleusercontent.com/cors-fallback-e2e.png';
    const expiredUrl = 'https://lh3.googleusercontent.com/expired-asset-e2e.png';
    let attempt = 0;
    let expiredAttempts = 0;
    await context.route('https://gemini.google.com/**', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: '<!doctype html><html><head><script>window.WIZ_global_data={qDCSke:"10000000001",SNlM0e:"test",cfb2h:"build"};</script></head><body><h1>Gemini</h1></body></html>',
        });
    });
    const geminiTab = await context.newPage();
    await geminiTab.goto('https://gemini.google.com/app/cors-img-chat');
    await expect(geminiTab.locator('#geminiExportBadge')).toBeVisible();

    const page = await openOptions(context, extensionId);
    await page.route(imageUrl, async route => {
        attempt++;
        if (attempt === 1) {
            // Simulate wildcard-CORS rejection on credentialed fetch -> triggers credentials: 'omit' retry
            await route.abort('failed');
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'image/png',
            headers: { 'access-control-allow-origin': '*' },
            body: TINY_PNG,
        });
    });
    await page.route(expiredUrl, async route => {
        expiredAttempts++;
        await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Expired' });
    });
    await page.locator('#devToggle').check();
    await page.locator('#includeAssets').check();
    await expect.poll(async () => (await storedSettings(page)).includeAssets).toBe(true);
    await page.evaluate(async ({ id, url, expired }) => {
        const api = Reflect.get(globalThis, 'uiFixture');
        await api.ingestDetail(id, 'cors-img-chat', {
            savedAt: 100,
            quality: { status: 'complete' },
            assets: [
                { id: 'img-1', kind: 'image', name: 'diagram.png', mediaType: 'image/png', sourceUri: url },
                { id: 'img-2', kind: 'image', name: 'expired.png', mediaType: 'image/png', sourceUri: expired },
            ],
            messages: [
                { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Show diagram' }] }] },
                { role: 'assistant', content: [{ type: 'image', assetId: 'img-1' }, { type: 'image', assetId: 'img-2' }] },
            ],
        }, { title: 'CORS Fallback Chat', titleSource: 'provider', updatedAt: 100 });
        window.dispatchEvent(new Event('focus'));
    }, { id: accountId, url: imageUrl, expired: expiredUrl });
    await expect(page.locator('#list .item')).toHaveCount(1);

    await page.locator('#btnSelectAll').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const download = await downloadPromise;
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
    expect(attempt).toBe(2);
    expect(expiredAttempts).toBe(1);

    const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));
    const zip = await JSZip.loadAsync(await readFile((await download.path())!));
    const pngEntry = Object.keys(zip.files).find(name => name.endsWith('.png'));
    expect(pngEntry).toBeTruthy();
    const bytes = Buffer.from(await zip.file(pngEntry).async('uint8array'));
    expect(bytes.equals(TINY_PNG)).toBe(true);
    const reportPath = Object.keys(zip.files).find(name => name.endsWith('/report.json'));
    expect(reportPath).toBeTruthy();
    const report = JSON.parse(await zip.file(reportPath).async('string'));
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].httpStatus).toBe(404);
    await geminiTab.close();
});

test('async UI interleaving: overlapping settings writes and rapid toggles converge to the last user choice', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'interleave-1', title: 'Interleave Chat' }]);
    await page.locator('#devToggle').check();

    // Introduce artificial latency on the first chrome.storage.local.set call to simulate slow persistence
    await page.evaluate(() => {
        const origSet = chrome.storage.local.set.bind(chrome.storage.local);
        let first = true;
        Object.defineProperty(chrome.storage.local, 'set', {
            configurable: true,
            value: async (items: Record<string, unknown>) => {
                if (first) {
                    first = false;
                    await new Promise(resolve => setTimeout(resolve, 120));
                }
                return origSet(items);
            },
        });
    });

    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    // Rapidly interleave settings toggles without waiting for each write
    await page.locator('#includeAssets').check();
    await page.locator('#skipExported').uncheck();
    await page.locator('#format').selectOption('html');
    await page.locator('#skipExported').check();

    await expect.poll(async () => {
        const s = await storedSettings(page);
        return { includeAssets: s.includeAssets, skipExported: s.skipExported, defaultFormat: s.defaultFormat };
    }).toEqual({ includeAssets: true, skipExported: true, defaultFormat: 'html' });

    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
    await expect(page.locator('#includeAssets')).toBeChecked();
    await expect(page.locator('#skipExported')).toBeChecked();
    await expect(page.locator('#format')).toHaveValue('html');
    expect(pageErrors).toEqual([]);
});

test('MV3 Service Worker stop and restart recovers readiness and content-script domain ingestion without data loss', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'before-sw-stop', title: 'Before SW Stop', body: 'Persisted before stop' }]);

    await context.route('https://gemini.google.com/**', async route => {
        if (route.request().url().includes('batchexecute')) {
            await route.fulfill({ status: 200, contentType: 'application/json', body: geminiListGen('G_DYNAMIC_PAGE_SYNC_01') });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: '<!doctype html><html><head><title>Gemini</title><script>window.WIZ_global_data={qDCSke:"10000000001",SNlM0e:"test",cfb2h:"build"};</script></head><body><h1>Gemini</h1></body></html>',
        });
    });
    const geminiTab = await context.newPage();
    await geminiTab.goto('https://gemini.google.com/app/c_39d5b41870e49a67');
    await expect(geminiTab.locator('#geminiExportBadge')).toBeVisible();

    // Physically terminate the active MV3 Service Worker via Chrome DevTools Protocol
    const workerBefore = await getActiveServiceWorker(context);
    await workerBefore.evaluate(() => { Reflect.set(globalThis, '__swBootNonce', 'before-stop'); });
    const cdp = await context.newCDPSession(page);
    const versions: Array<{ versionId: string; runningStatus: string; scriptURL: string }> = [];
    cdp.on('ServiceWorker.workerVersionUpdated', (event: { versions: Array<{ versionId: string; runningStatus: string; scriptURL: string }> }) => {
        versions.push(...event.versions);
    });
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => versions.some(v => v.scriptURL.includes(extensionId) && v.runningStatus === 'running'), { timeout: 5000 }).toBe(true);
    const running = versions.filter(v => v.scriptURL.includes(extensionId) && v.runningStatus === 'running').pop()!;
    await cdp.send('ServiceWorker.stopWorker', { versionId: running.versionId });
    await expect.poll(async () => {
        const workers = context.serviceWorkers();
        if (workers.length === 0) return true;
        try {
            return (await workers[0].evaluate(() => Reflect.get(globalThis, '__swBootNonce'))) === undefined;
        } catch {
            return true;
        }
    }, { timeout: 10000 }).toBe(true);
    await cdp.detach();

    // Trigger real MAIN-world sniffer -> content-script domainIngest IPC -> cold-starts a fresh Service Worker
    await geminiTab.evaluate(async body => fetch('/_/BardChatUi/data/batchexecute', {
        method: 'POST', body: new URLSearchParams(body),
    }), geminiListRequestGen('G_E2E_PAGE_SYNC_LIST_REQUEST_01'));

    await expect.poll(async () => {
        return page.evaluate(async (id) => {
            const index = await Reflect.get(globalThis, 'uiFixture').getIndex({ accountId: id, conversationId: '39d5b41870e49a67' });
            return index?.title ?? null;
        }, accountId);
    }, { timeout: 10000 }).toBe('量子纠缠物理原理深度解析');

    const workerAfter = await getActiveServiceWorker(context);
    expect(await workerAfter.evaluate(() => Reflect.get(globalThis, '__swBootNonce'))).toBeUndefined();

    // Verify both pre-stop and post-restart conversations survive intact in IndexedDB & UI
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#list')).toContainText('Before SW Stop');
    await expect(page.locator('#list')).toContainText('量子纠缠物理原理深度解析');
    await geminiTab.close();
});

test('Cross-context diagnostic export captures background/popup events, settings, and account summary', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'diag-conv-1', title: 'Diag Test Chat' }]);
    await page.locator('#devToggle').check();

    // Send a cross-context diagnostic event from Popup/extension origin into the Background ring buffer
    const recorded = await page.evaluate(async () => {
        return chrome.runtime.sendMessage({
            action: 'recordDiagnosticEvent',
            source: 'popup',
            severity: 'error',
            code: 'POPUP_DIAG_TEST_EVENT',
            message: 'Simulated popup failure for diagnostic capture',
            error: { name: 'Error', message: 'outer', code: 'TEST', stack: 'Error: outer', cause: { name: 'Error', message: 'inner' } },
            details: { providerId: 'claude', blockType: 'artifact_v9', cookie: 'secret-session' },
        });
    });
    expect(recorded).toEqual({ ok: true });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btnExportDiag').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('gemini-exporter-ui-diagnostics.json');

    const diag = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(diag.schemaVersion).toBe(3);
    expect(diag.diagnosticRevision).toBe(3);
    expect(diag.settings).toMatchObject({ developerMode: true });
    expect(diag.accountSummary.totalAccounts).toBeGreaterThanOrEqual(1);
    expect(diag.accountSummary.activeAccountStats.totalIndexes).toBe(1);
    expect(diag.runtimeEvents).toBeTruthy();
    const match = diag.runtimeEvents.events.find((e: { code: string }) => e.code === 'POPUP_DIAG_TEST_EVENT');
    expect(match).toMatchObject({
        source: 'popup',
        severity: 'error',
        message: 'Simulated popup failure for diagnostic capture',
        error: { name: 'Error', message: 'outer', code: 'TEST', stack: 'Error: outer', cause: { name: 'Error', message: 'inner' } },
        details: { providerId: 'claude', blockType: 'artifact_v9', cookie: '<redacted-credential>' },
    });
});
