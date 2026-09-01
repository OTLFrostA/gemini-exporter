const { test: base, chromium, expect } = require('@playwright/test');
const path = require('path');

const pathToExtension = path.resolve(__dirname, '../../');

const isHeaded = process.argv.includes('--headed');

const test = base.extend({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        ...(isHeaded ? [] : [
          '--window-position=-3000,-3000',
          '--window-size=1280,800',
          '--no-first-run',
          '--no-default-browser-check'
        ])
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },
});

module.exports = { test, expect };
