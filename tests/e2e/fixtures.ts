import { test as base, chromium, expect, type BrowserContext } from '@playwright/test';
import * as path from 'path';

interface IndexSeed {
  id: string; title?: string; titleSource?: string; timestamp?: number; updatedAt?: number;
  createdAt?: number; messageCount?: number; cloudAvailability?: string; hasTakeoutImport?: boolean;
}
declare global {
  /** Explicit fixture builder; production readers do not normalize historical seeds. */
  function canonicalIndexFixture(row: IndexSeed): Record<string, unknown>;
}

const pathToExtension = path.resolve(__dirname, '../../');

const isHeaded = process.argv.includes('--headed');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // Use full Chromium binary to support extensions in true headless
      headless: !isHeaded,
      args: [
        ...(isHeaded ? [] : ['--headless=new']),
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ],
    });
    await context.addInitScript(() => {
      globalThis.canonicalIndexFixture = row => ({
        providerId: 'gemini', id: row.id.replace(/^c_/, ''),
        title: row.titleSource === 'default' ? '' : row.title || '',
        titleSource: row.titleSource === 'default' || !row.title ? 'default' : row.titleSource || 'legacy',
        cloudAvailability: row.cloudAvailability || 'unknown',
        hasTakeoutImport: row.hasTakeoutImport ?? row.titleSource === 'takeout',
        ...((row.updatedAt ?? row.timestamp) !== undefined ? { updatedAt: row.updatedAt ?? row.timestamp } : {}),
        ...(row.createdAt !== undefined ? { createdAt: row.createdAt } : {}),
        ...(row.messageCount !== undefined ? { messageCount: row.messageCount } : {}),
      });
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    const extensionId = background.url().split('/')[2]!;
    await use(extensionId);
  },
});

export { expect };


/** Seed explicit current-schema Accounts for UI fixtures that seed UUID partitions. */
export async function seedRegistryAccounts(context: BrowserContext): Promise<void> {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const readiness = await context.newPage();
  try {
    await readiness.goto(`chrome-extension://${worker.url().split('/')[2]}/src/ui/options/options.html?notour=1`);
    const reply = await readiness.evaluate(() => chrome.runtime.sendMessage({ action: 'accountRegistry', command: 'list' }));
    if (!reply?.ok) throw new Error(`Registry fixture initialization failed: ${reply?.error}`);
  } finally { await readiness.close(); }
  await worker.evaluate(async () => {
    const open = indexedDB.open('gemini_exporter_domain');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('accounts', 'readwrite');
        const store = tx.objectStore('accounts');
        store.put({id:'10000000-0000-4000-8000-000000000001',providerId:'gemini',providerAccountId:'10000000001',displayName:'Fixture account'});
        store.put({id:'10000000-0000-4000-8000-000000000002',providerId:'gemini',providerAccountId:'10000000002',displayName:'Other account'});
        store.put({id:'10000000-0000-4000-8000-000000000003',providerId:'gemini',providerAccountId:'default'});
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      });
    } finally {db.close();}
  });
}
