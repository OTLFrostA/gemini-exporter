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

