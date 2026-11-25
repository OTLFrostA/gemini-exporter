import { launchChromeExtension } from '../../scripts/playwright-chrome.mjs';
import { platformOrigins, PLATFORM_HOSTS } from '../../src/shared/platformHosts';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { domainFixtureBrowser } from './domainFixtureBrowser';
import { test as base, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import * as path from 'path';

const pathToExtension = path.resolve(__dirname, '../../');

let authorizedExtensionPath: string | undefined;

const isHeaded = process.argv.includes('--headed');

export async function launchExtensionContext(grantGemini = true): Promise<BrowserContext> {
    let extensionPath = pathToExtension;
    if (grantGemini && !authorizedExtensionPath) {
        const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'exporter-authorized-'));
        for (const name of ['src', 'dist', 'icons', 'lib', '_locales'])
            fs.cpSync(path.join(pathToExtension, name), path.join(staged, name), { recursive: true });
        const manifest = JSON.parse(fs.readFileSync(path.join(pathToExtension, 'manifest.json'), 'utf8'));
        const origins = platformOrigins('gemini');
        manifest.host_permissions = origins;
        manifest.optional_host_permissions = manifest.optional_host_permissions.filter((origin: string) => !origins.includes(origin));
        fs.writeFileSync(path.join(staged, 'manifest.json'), JSON.stringify(manifest));
        authorizedExtensionPath = staged;
        process.once('exit', () => fs.rmSync(staged, { recursive: true, force: true }));
    }
    if (grantGemini) extensionPath = authorizedExtensionPath!;
    const { context } = await launchChromeExtension(extensionPath, { headless: !isHeaded });
    await context.route(/^https?:\/\//, route => route.abort('blockedbyclient'));
    if (grantGemini) {
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        await worker.evaluate(async () => {
            for (let attempt = 0; attempt < 100; attempt++) {
                if ((await chrome.scripting.getRegisteredContentScripts()).some(script => script.id === 'gemini-source-content')) return;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw new Error('Gemini staging content registration timed out');
        });
    }
    await context.addInitScript({ content: domainFixtureBrowser });
    return context;
}

export async function getActiveServiceWorker(context: BrowserContext, anchor?: Page, extensionId?: string): Promise<Worker> {
    let [worker] = context.serviceWorkers();
    if (!worker && anchor && extensionId) {
        const pending = context.waitForEvent('serviceworker', { timeout: 10000 });
        await anchor.goto(`chrome-extension://${extensionId}/manifest.json`).catch(() => {});
        worker = context.serviceWorkers()[0] || await pending;
        await anchor.goto('about:blank').catch(() => {});
    } else if (!worker) {
        worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    return worker;
}

const GEMINI_SCRIPTS = PLATFORM_HOSTS.gemini.contentScripts;
const GEMINI_PAGES = [...PLATFORM_HOSTS.gemini.pages];

async function resetWorkerExtensionState(
    context: BrowserContext,
    anchor: Page,
    extensionId: string,
    grantGemini: boolean,
): Promise<void> {
    for (const page of context.pages()) {
        if (page === anchor) continue;
        await page.close({ runBeforeUnload: false }).catch(() => {});
    }
    await anchor.unrouteAll({ behavior: 'ignoreErrors' });
    const manifestUrl = `chrome-extension://${extensionId}/manifest.json`;
    if (anchor.url() !== manifestUrl) {
        await anchor.goto(manifestUrl).catch(() => {});
    }
    await anchor.evaluate(() => {
        try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
    }).catch(() => {});
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.route(/^https?:\/\//, route => route.abort('blockedbyclient'));

    const worker = await getActiveServiceWorker(context, anchor, extensionId);
    await worker.evaluate(async ({ grantGemini, geminiScripts, geminiPages }) => {
        await Promise.all([
            chrome.storage.local.clear(),
            chrome.storage.session.clear(),
        ]);
        const currentVersion = chrome.runtime.getManifest().version;
        await chrome.storage.local.set({
            gemini_exporter_v2_initialized: true,
            gemini_exporter_source_versions_v1: true,
            gemini_exporter_v2_settings: {
                lastSeenFeatureVersion: currentVersion,
                theme: 'light',
            },
        });

        if (typeof indexedDB?.databases === 'function') {
            const dbs = await indexedDB.databases();
            for (const info of dbs) {
                const name = info.name;
                if (!name) continue;
                if (name !== 'gemini_exporter_v2' && name !== 'gemini_exporter_cloud_v2') {
                    await new Promise<void>(resolve => {
                        const del = indexedDB.deleteDatabase(name);
                        del.onsuccess = () => resolve();
                        del.onerror = () => resolve();
                        del.onblocked = () => resolve();
                    });
                    continue;
                }
                await new Promise<void>((resolve, reject) => {
                    const req = indexedDB.open(name);
                    req.onsuccess = () => {
                        const db = req.result;
                        const stores = Array.from(db.objectStoreNames);
                        if (stores.length === 0) {
                            db.close();
                            resolve();
                            return;
                        }
                        const tx = db.transaction(stores, 'readwrite');
                        for (const storeName of stores) {
                            tx.objectStore(storeName).clear();
                        }
                        tx.oncomplete = () => { db.close(); resolve(); };
                        tx.onerror = () => { db.close(); reject(tx.error); };
                        tx.onabort = () => { db.close(); reject(tx.error); };
                    };
                    req.onerror = () => reject(req.error);
                });
            }
        }

        if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
            try {
                const root = await navigator.storage.getDirectory();
                const entries: string[] = [];
                for await (const [entryName] of Reflect.get(root, 'entries').call(root)) {
                    entries.push(entryName);
                }
                for (const entryName of entries) {
                    await root.removeEntry(entryName, { recursive: true }).catch(() => {});
                }
            } catch { /* ignore OPFS cleanup errors */ }
        }

        const allPerms = await chrome.permissions.getAll();
        const removableOrigins = (allPerms.origins ?? []).filter(origin =>
            !grantGemini || (!origin.includes('gemini.google.com') && !origin.includes('googleusercontent.com')));
        if (removableOrigins.length > 0) {
            await chrome.permissions.remove({ origins: removableOrigins }).catch(() => {});
        }

        const registered = await chrome.scripting.getRegisteredContentScripts();
        if (!grantGemini) {
            if (registered.length > 0) {
                await chrome.scripting.unregisterContentScripts({ ids: registered.map(s => s.id) }).catch(() => {});
            }
        } else {
            const nonGemini = registered.filter(s => !s.id.startsWith('gemini-')).map(s => s.id);
            if (nonGemini.length > 0) {
                await chrome.scripting.unregisterContentScripts({ ids: nonGemini }).catch(() => {});
            }
            const after = await chrome.scripting.getRegisteredContentScripts({ ids: ['gemini-source-main', 'gemini-source-content'] });
            const missing = ['gemini-source-main', 'gemini-source-content'].filter(id => !after.some(s => s.id === id));
            if (missing.length > 0) {
                await chrome.scripting.registerContentScripts(missing.map(id => ({
                    id,
                    matches: geminiPages,
                    runAt: 'document_start',
                    allFrames: false,
                    persistAcrossSessions: true,
                    ...(id === 'gemini-source-content' ? { css: ['src/ui/badge/content.css'] } : {}),
                    js: [geminiScripts[id === 'gemini-source-main' ? 0 : 1]],
                    world: id === 'gemini-source-main' ? 'MAIN' : 'ISOLATED',
                }))).catch(() => {});
            }
        }
    }, { grantGemini, geminiScripts: GEMINI_SCRIPTS, geminiPages: GEMINI_PAGES });
}

interface WorkerExtensionSession {
    context: BrowserContext;
    extensionId: string;
    anchor: Page;
}

export const test = base.extend<
    {
        context: BrowserContext;
        extensionId: string;
    },
    {
        grantGemini: boolean;
        _workerSession: WorkerExtensionSession;
    }
>({
    grantGemini: [true, { option: true, scope: 'worker' }],
    _workerSession: [async ({ grantGemini }, use) => {
        const context = await launchExtensionContext(grantGemini);
        try {
            let [background] = context.serviceWorkers();
            if (!background) {
                background = await context.waitForEvent('serviceworker', { timeout: 10000 });
            }
            await background.evaluate(async () => {
                for (let attempt = 0; attempt < 100; attempt++) {
                    const data = await chrome.storage.local.get(['gemini_exporter_v2_initialized', 'gemini_exporter_v2_settings']);
                    const settings = data.gemini_exporter_v2_settings as { theme?: string } | undefined;
                    if (data.gemini_exporter_v2_initialized === true && settings?.theme === 'light') return;
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            });
            const extensionId = background.url().split('/')[2]!;
            const anchor = context.pages()[0] ?? await context.newPage();
            await anchor.goto(`chrome-extension://${extensionId}/manifest.json`).catch(() => {});
            await use({ context, extensionId, anchor });
        } finally {
            await context.close();
        }
    }, { scope: 'worker' }],
    context: async ({ _workerSession, grantGemini }, use) => {
        await resetWorkerExtensionState(
            _workerSession.context,
            _workerSession.anchor,
            _workerSession.extensionId,
            grantGemini,
        );
        await use(_workerSession.context);
    },
    extensionId: async ({ _workerSession }, use) => {
        await use(_workerSession.extensionId);
    },
});

export { expect };

const seedBundle = require('esbuild').buildSync({
    stdin: {
        contents: `
            import { ensureV2Ready } from './src/runtime/background/readiness.ts';
            import * as storage from './src/l3a/storageService.ts';
            globalThis.__fixtureSeedAccounts = async () => {
                await ensureV2Ready();
                await chrome.storage.local.set({
                    gemini_exporter_v2_initialized: true,
                    gemini_exporter_source_versions_v1: true,
                });
                await storage.putAccount({ id: '10000000-0000-4000-8000-000000000001', providerId: 'gemini', providerAccountId: '10000000001', displayName: 'Fixture account' });
                await storage.putAccount({ id: '10000000-0000-4000-8000-000000000002', providerId: 'gemini', providerAccountId: '10000000002', displayName: 'Other account' });
                await storage.putAccount({ id: '10000000-0000-4000-8000-000000000003', providerId: 'gemini', providerAccountId: 'default' });
            };
        `,
        resolveDir: path.resolve(__dirname, '../..'),
        loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
}).outputFiles[0].text;

export async function seedRegistryAccounts(context: BrowserContext): Promise<void> {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async bundleCode => {
        if (typeof Reflect.get(globalThis, '__fixtureSeedAccounts') !== 'function') {
            (0, eval)(bundleCode);
        }
        await Reflect.get(globalThis, '__fixtureSeedAccounts')();
    }, seedBundle);
}
