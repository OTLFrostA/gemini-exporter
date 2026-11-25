import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { mount, read } from './helpers/uiPortHarness.js';

let browser: Browser;
before(async () => {
    browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true, headless: true });
});
after(async () => {
    await browser?.close();
});

async function withPage(fn: (page: Page) => Promise<void>): Promise<void> {
    const context = await browser.newContext();
    try {
        await fn(await context.newPage());
    } finally {
        await context.close();
    }
}

test('failed Scan releases Options controls and reports the Runtime/Sync error', () => withPage(async page => {
    await mount(page, 'options', { failScan: true });
    await page.locator('#btnSyncAll').click();
    await page.waitForFunction(() => document.body.dataset.busy !== 'true');
    assert.equal(await page.locator('#scanStatus').textContent(), 'Operation failed. Please retry; details are available in the logs or diagnostic report.');
    assert.equal(await page.locator('#btnSyncAll').isEnabled(), true);
}));

test('Popup passes a bounded v2 current-context request and releases busy state on error', () => withPage(async page => {
    await mount(page, 'popup');
    await page.waitForFunction(() => !(document.getElementById('btnCurrent') as HTMLButtonElement).disabled);
    const first = await read(page, 'tabRequests');
    assert.deepEqual(first, [{ tabId: 1, message: { action: 'getAccountContext' }, timeoutMs: 3000 }]);
    await page.evaluate(() => {
        chrome.tabs.sendMessage = (async () => { throw new Error('Context request timed out'); }) as typeof chrome.tabs.sendMessage;
    });
    await page.locator('#btnCurrent').click();
    await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Operation failed. Please retry; details are available in the logs or diagnostic report.');
    assert.equal(await page.locator('#btnCurrent').isEnabled(), true);
    const second = await read(page, 'tabRequests');
    assert.deepEqual(second.at(-1), { tabId: 1, message: { action: 'getAccountContext' }, timeoutMs: 3000 });
    assert.equal(second.length, 2);
}));
