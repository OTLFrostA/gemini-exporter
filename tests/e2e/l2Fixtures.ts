import { launchChromeExtension } from '../../scripts/playwright-chrome.mjs';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
export { seedRegistryAccounts } from './fixtures';

interface L2WorkerSession {
    context: BrowserContext;
    extensionId: string;
    anchor: Page;
}

/** Isolated L2 browser harness: reuses one minimal L2 extension context per worker. */
export const test = base.extend<
    { context: BrowserContext; extensionId: string },
    { _l2Session: L2WorkerSession }
>({
    _l2Session: [async ({}, use) => {
        const extension = await mkdtemp(join(tmpdir(), 'exporter-l2-'));
        let context: BrowserContext | undefined;
        try {
            await mkdir(join(extension, 'src/ui/options'), { recursive: true });
            await writeFile(join(extension, 'src/ui/options/options.html'), '<!doctype html><title>L2 admission test</title>');
            await writeFile(join(extension, 'manifest.json'), JSON.stringify({
                manifest_version: 3, name: 'L2 admission test', version: '1.0.0', permissions: ['storage'],
                background: { service_worker: 'background.js' },
            }));
            await build({ stdin: { resolveDir: resolve(__dirname, '../..'), loader: 'ts', contents: `
                import { handleAccountRegistryMessage } from './src/runtime/background/accountRegistryHandler.ts';
                import { handleDomainIngestionMessage } from './src/runtime/background/domainStorageHandler.ts';
                import { ensureV2Ready } from './src/runtime/background/readiness.ts';
                chrome.runtime.onMessage.addListener((message, sender, respond) => {
                    if (message?.action === 'ensureV2Ready') {
                        void ensureV2Ready().then(() => respond({ ok: true }), error => respond({ ok: false, error: String(error) }));
                        return true;
                    }
                    return handleAccountRegistryMessage(message, sender, respond) || handleDomainIngestionMessage(message, sender, respond);
                });
            ` }, bundle: true, platform: 'browser', format: 'iife', outfile: join(extension, 'background.js') });
            ({ context } = await launchChromeExtension(extension));
            await context.route(/^https?:\/\//, route => route.abort('blockedbyclient'));
            const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
            const extensionId = new URL(worker.url()).host;
            const anchor = context.pages()[0] ?? await context.newPage();
            await anchor.goto('about:blank').catch(() => {});
            await use({ context, extensionId, anchor });
        } finally {
            await context?.close();
            await rm(extension, { recursive: true, force: true });
        }
    }, { scope: 'worker' }],
    context: async ({ _l2Session }, use) => {
        for (const page of _l2Session.context.pages()) {
            if (page !== _l2Session.anchor) await page.close({ runBeforeUnload: false }).catch(() => {});
        }
        await _l2Session.context.unrouteAll({ behavior: 'ignoreErrors' });
        await _l2Session.context.route(/^https?:\/\//, route => route.abort('blockedbyclient'));
        const worker = _l2Session.context.serviceWorkers()[0] ?? await _l2Session.context.waitForEvent('serviceworker');
        await worker.evaluate(async () => {
            await chrome.storage.local.clear();
            if (typeof indexedDB?.databases === 'function') {
                for (const info of await indexedDB.databases()) {
                    if (!info.name) continue;
                    await new Promise<void>(r => {
                        const del = indexedDB.deleteDatabase(info.name!);
                        del.onsuccess = del.onerror = del.onblocked = () => r();
                    });
                }
            }
        });
        await use(_l2Session.context);
    },
    extensionId: async ({ _l2Session }, use) => {
        await use(_l2Session.extensionId);
    },
});
export { expect };
