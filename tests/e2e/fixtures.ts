import { domainFixtureBrowser } from './domainFixtureBrowser';
import { test as base, chromium, expect, type BrowserContext } from '@playwright/test';
import * as path from 'path';

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
    await context.addInitScript({ content: domainFixtureBrowser });
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


/** Explicit v2 physical fixtures; ordinary Extension reads use direct APIs, not Content IPC. */
const seedBundle = require('esbuild').buildSync({
  stdin: { contents: `import * as storage from './src/l3a/storageService.ts'; globalThis.fixtureStorage = storage;`,
    resolveDir: path.resolve(__dirname, '../..'), loader: 'ts' }, bundle: true, write: false, format: 'iife',
}).outputFiles[0].text;
export async function seedRegistryAccounts(context: BrowserContext): Promise<void> {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${worker.url().split('/')[2]}/src/ui/options/options.html`);
    const reply = await page.evaluate(() => chrome.runtime.sendMessage({ action: 'ensureV2Ready' }));
    if (!reply?.ok) throw new Error('Fixture readiness failed');
    await page.evaluate(seedBundle);
    await page.evaluate(async () => {
      const storage = Reflect.get(globalThis, 'fixtureStorage');
      await storage.putAccount({id:'10000000-0000-4000-8000-000000000001',providerId:'gemini',providerAccountId:'10000000001',displayName:'Fixture account'});
      await storage.putAccount({id:'10000000-0000-4000-8000-000000000002',providerId:'gemini',providerAccountId:'10000000002',displayName:'Other account'});
      await storage.putAccount({id:'10000000-0000-4000-8000-000000000003',providerId:'gemini',providerAccountId:'default'});
    });
  } finally { await page.close(); }
}
