import { chromium, expect, test, type Worker } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const legacyDatabase = 'gemini_exporter_cloud_v1';
const legacySlots = ['ge_cloud_key_v1:local:vault', 'ge_cloud_key_v1:fixture-owner'];
const unrelatedSetting = 'fixture-sync-preference';

function keyCopies(worker: Worker) {
    return worker.evaluate(async ({ legacyDatabase, legacySlots, unrelatedSetting }) => {
        const names = await chrome.storage.sync.getKeys();
        return new Promise<{ sync: boolean[]; mirror: number; outbox: number; unrelatedSync: boolean }>((resolve, reject) => {
            const open = indexedDB.open(legacyDatabase);
            open.onupgradeneeded = () => open.transaction?.abort();
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
                const db = open.result;
                const stores = db.objectStoreNames.contains('localKeys') ? ['localKeys', 'outbox'] : ['outbox'];
                const tx = db.transaction(stores);
                const mirror = stores.length === 2 ? tx.objectStore('localKeys').count() : undefined;
                const outbox = tx.objectStore('outbox').count();
                tx.oncomplete = () => {
                    db.close();
                    resolve({
                        sync: legacySlots.map(slot => names.includes(slot)),
                        mirror: mirror?.result ?? 0,
                        outbox: outbox.result,
                        unrelatedSync: names.includes(unrelatedSetting),
                    });
                };
                tx.onabort = () => { db.close(); reject(tx.error); };
            };
        });
    }, { legacyDatabase, legacySlots, unrelatedSetting });
}

test('upgrading an existing extension purges retired Vault key copies without clearing other data', async ({}, testInfo) => {
    const installed = testInfo.outputPath('installed');
    await fs.mkdir(installed, { recursive: true });
    await fs.writeFile(path.join(installed, 'manifest.json'), JSON.stringify({
        manifest_version: 3, name: 'Legacy Vault profile fixture', version: '0.0.1',
        permissions: ['storage'], background: { service_worker: 'legacy.js' },
    }));
    await fs.writeFile(path.join(installed, 'legacy.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
    const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
        channel: 'chromium', headless: true, chromiumSandbox: true,
        args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${installed}`, `--load-extension=${installed}`],
    });
    try {
        const cdp = await context.browser()!.newBrowserCDPSession();
        const old = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 10000 });
        const extensionId = new URL(old.url()).hostname;
        await old.evaluate(async ({ legacyDatabase, legacySlots, unrelatedSetting }) => {
            await chrome.storage.local.set({ gemini_exporter_v2_initialized: true });
            await chrome.storage.sync.set({
                [legacySlots[0]]: 'synthetic-local-copy', [legacySlots[1]]: 'synthetic-owner-copy',
                [unrelatedSetting]: true,
            });
            await new Promise<void>((resolve, reject) => {
                const open = indexedDB.open(legacyDatabase, 2);
                open.onupgradeneeded = () => {
                    const db = open.result;
                    const keys = db.createObjectStore('localKeys', { keyPath: 'ownerSubject' });
                    keys.put({ ownerSubject: 'local:vault', recoveryKey: 'synthetic-local-copy' });
                    keys.put({ ownerSubject: 'fixture-owner', recoveryKey: 'synthetic-owner-copy' });
                    db.createObjectStore('outbox', { keyPath: ['accountId', 'conversationId'] })
                        .put({ accountId: 'fixture-account', conversationId: 'fixture-conversation' });
                };
                open.onsuccess = () => { open.result.close(); resolve(); };
                open.onerror = () => reject(open.error);
            });
        }, { legacyDatabase, legacySlots, unrelatedSetting });
        expect(await keyCopies(old)).toEqual({ sync: [true, true], mirror: 2, outbox: 1, unrelatedSync: true });

        const root = path.resolve(__dirname, '../..');
        for (const name of ['src', 'dist', 'icons', 'lib', '_locales', 'manifest.json']) {
            await fs.cp(path.join(root, name), path.join(installed, name), { recursive: true });
        }
        const upgraded = context.waitForEvent('serviceworker', {
            predicate: worker => worker.url().endsWith('/dist/background/background.js'), timeout: 10000,
        });
        expect((await cdp.send('Extensions.loadUnpacked', { path: installed })).id).toBe(extensionId);
        const current = await upgraded;
        expect(await current.evaluate(() => chrome.runtime.getManifest().version)).not.toBe('0.0.1');
        const purged = { sync: [false, false], mirror: 0, outbox: 1, unrelatedSync: true };
        await expect.poll(() => keyCopies(current)).toEqual(purged);

        // Chrome Sync can deliver a legacy slot after the upgraded worker has started.
        await current.evaluate(slot => chrome.storage.sync.set({ [slot]: 'synthetic-late-copy' }), legacySlots[1]);
        await expect.poll(() => keyCopies(current)).toEqual(purged);
    } finally {
        await context.close();
    }
});
