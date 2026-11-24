import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { v2LiveSaveHost } from './helpers/v2LiveSaveHost.js';
import { sessionGen } from './fixtures/providers/chatgptSession.js';
import { getOrCreateAccount } from '../src/runtime/api/accountRegistry.js';
import { ingestIndexes } from '../src/l2/ingestion.js';
import { updateSettings } from '../src/application/settings/index.js';
import { runLiveSave } from '../src/runtime/background/liveSaveHandler.js';

test('Live Save badge preserves the real ChatGPT 429 cooldown across the worker JSON reply', async t => {
    v2LiveSaveHost(t);
    const session = sessionGen('C_EXPORT_CANCEL_429_SOURCE_SESSION');
    const account = await getOrCreateAccount('chatgpt', JSON.stringify(['export-user', 'export-space']));
    const key = { accountId: account.id, conversationId: 'limited' };
    await ingestIndexes(account.id, [{ conversationId: key.conversationId, fields: {
        title: 'Limited', titleSource: 'provider', updatedAt: 100,
    } }]);
    await updateSettings({ enabledDisk: true, exportDelivery: 'folderWriter', defaultFormat: 'markdown', language: 'en' });
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        if (String(input).endsWith('/api/auth/session')) return Response.json(session);
        calls++;
        return new Response(null, { status: 429, headers: { 'Retry-After': '24' } });
    });
    const browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.route('https://chatgpt.com/**', route => route.fulfill({
        contentType: route.request().url().endsWith('/api/auth/session') ? 'application/json' : 'text/html',
        body: route.request().url().endsWith('/api/auth/session') ? JSON.stringify(session) : '<!doctype html><body></body>',
    }));
    await page.goto('https://chatgpt.com/c/limited');
    await page.exposeFunction('saveInWorker', async (received: typeof key) => {
        assert.deepEqual(received, key);
        const result = await runLiveSave(received);
        assert.equal(result?.aborted, true);
        assert.ok(result?.rateLimitedUntil && result.rateLimitedUntil >= Date.now() + 3_590_000);
        return JSON.parse(JSON.stringify({ ok: true, result }));
    });
    const bundle = await build({ stdin: { contents: `
        import { BadgeView } from './src/ui/badge/badgeView.ts';
        import { init, executeLiveSave } from './src/runtime/content/liveSaveCoordinator.ts';
        import { configureAccountAdapter, resolveCurrentAccount } from './src/runtime/content/accountContext.ts';
        import { createChatGPTAccountAdapter } from './src/runtime/content/adapters/chatgptAccountAdapter.ts';
        configureAccountAdapter(createChatGPTAccountAdapter());
        const account = ${JSON.stringify(account)};
        globalThis.chrome = {
            runtime: { id: 'test-extension', async sendMessage(message) {
                if (message.action === 'runLiveSave') return globalThis.saveInWorker(message.key);
                if (message.action === 'accountRegistry') return { ok: true, value: account };
                if (message.action === 'getLocalIndexCount') return { ok: true, count: 1 };
                return { ok: true };
            } },
            storage: { local: { get: async () => ({ gemini_exporter_v2_settings: { language: 'en' } }) },
                onChanged: { addListener() {}, removeListener() {} } }
        };
        globalThis.runSave = async () => {
            await resolveCurrentAccount({ providerId: account.providerId, providerAccountId: account.providerAccountId });
            BadgeView.ensureBadge();
            await BadgeView.refreshAccount();
            init({ badge: BadgeView });
            await executeLiveSave(${JSON.stringify(key)});
        };
    `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => Reflect.get(window, 'runSave')());
    const title = await page.locator('#geminiExportBadge').getAttribute('title');
    assert.match(title ?? '', /ChatGPT rate limited \(429\): export stopped; account cooling down until/);
    assert.doesNotMatch(title ?? '', /Cancelled/);
    assert.equal(calls, 1, 'the provider must not retry after HTTP 429');
});
