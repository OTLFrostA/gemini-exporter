import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { sendTypedMessage } from '../src/runtime/ipc/messaging.js';
import { sendTabMessage } from '../src/runtime/capabilities/tabService.js';
import { mount } from './helpers/uiPortHarness.js';
const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
test.afterEach(() => { if (previous) Object.defineProperty(globalThis, 'chrome', previous); else Reflect.deleteProperty(globalThis, 'chrome'); });
function install(runtime: object, tabs: object = {}) { Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime, tabs } }); }

test('S3 - typed runtime request resolves when the response arrives', async () => {
    install({ sendMessage: (_message: unknown, callback: (reply: unknown) => void) => callback({ ok: true }) });
    assert.deepEqual(await sendTypedMessage({ action: 'ping' }, 100), { ok: true });
});
test('S3 - typed runtime request rejects a lost callback on its own timeout', async () => {
    install({ sendMessage: () => {} });
    await assert.rejects(sendTypedMessage({ action: 'ping' }, 25), /timeout/);
});
test('S3 - current Tab context transport rejects lost responses on its physical timeout', async () => {
    install({}, { sendMessage: () => {} }); const started = Date.now();
    await assert.rejects(sendTabMessage(1, { action: 'getAccountContext' }, 25), /timed out/);
    assert.ok(Date.now() - started < 1000);
});
test('S3 - typed runtime requests reject chrome.runtime.lastError', async () => {
    install({ lastError: { message: 'Receiving end does not exist.' }, sendMessage: (_message: unknown, callback: () => void) => callback() });
    await assert.rejects(sendTypedMessage({ action: 'ping' }, 100), /Receiving end/);
});
test('S3 - failed Scan releases workbench controls and reports the actual error', async () => {
    const browser = await chromium.launch({ headless: true }); try {
        const page = await browser.newPage(); await mount(page, 'options', { failScan: true }); await page.locator('#btnSyncAll').click();
        await page.waitForFunction(() => document.body.dataset.busy !== 'true');
        assert.equal(await page.locator('#status').textContent(), 'Injected scan failure'); assert.equal(await page.locator('#btnSyncAll').isEnabled(), true);
    } finally { await browser.close(); }
});
test('S3 - Popup uses bounded current-context transport and releases its guard on a context rejection', async () => {
    const source = readFileSync('src/ui/popup/popup.ts', 'utf8'); assert.match(source, /await sendTabMessage\(tab\.id, \{ action: 'getAccountContext' \}, 3000\)/);
    const browser = await chromium.launch({ headless: true }); try {
        const page = await browser.newPage(); await mount(page, 'popup'); await page.waitForFunction(() => !(document.getElementById('btnCurrent') as HTMLButtonElement).disabled);
        await page.evaluate(() => { chrome.tabs.sendMessage = (async () => { throw new Error('Context request timed out'); }) as typeof chrome.tabs.sendMessage; });
        await page.locator('#btnCurrent').click(); await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Context request timed out');
        assert.equal(await page.locator('#btnCurrent').isEnabled(), true);
    } finally { await browser.close(); }
});
