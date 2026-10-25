import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { mount, read } from './helpers/uiPortHarness.js';

let browser: Browser;
let page: Page;
before(async () => { browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await page?.close(); });
after(async () => { await browser?.close(); });

test('Popup on an ungranted site reuses the tutorial selector and preselects only that provider', async () => {
    for (const [provider, url] of [
        ['gemini', 'https://gemini.google.com/app/example'],
        ['chatgpt', 'https://chatgpt.com/c/example'],
        ['chatgpt', 'https://chat.openai.com/c/example'],
        ['claude', 'https://claude.ai/chat/example'],
        ['grok', 'https://grok.com/c/example'],
    ]) {
        page = await browser.newPage();
        await mount(page, 'popup', { tabs: [{ id: 9, active: true, url }],
            geminiAccess: false, chatgptAccess: false, claudeAccess: false, grokAccess: false });
        await page.locator('#popupPermission').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#popupMain').isVisible(), false);
        assert.equal(await page.locator('#popupPermissionTitle').textContent(), 'Authorize AI platforms');
        assert.equal(await page.locator('#popupPermission .platform-permission-row').count(), 4);
        for (const candidate of ['gemini', 'chatgpt', 'claude', 'grok']) {
            const checked = await page.locator(
                '#popupPermission .platform-permission-row[data-platform="' + candidate + '"] input').isChecked();
            assert.equal(checked, candidate === provider, url + ' incorrectly selected ' + candidate);
        }
        assert.deepEqual(await read(page, 'tabRequests'), []);
        await page.close();
    }
});

test('Popup stays in authorization after denial and switches to export after current-site permission', async () => {
    page = await browser.newPage();
    await mount(page, 'popup', { tabs: [{ id: 9, active: true, url: 'https://chatgpt.com/c/one' }],
        chatgptAccess: false, permissionDenied: true });
    await page.locator('#popupPermission').waitFor({ state: 'visible' });
    await page.locator('#btnAuthorizePlatforms').click();
    await page.waitForFunction(() => document.querySelector('#popupPermission [role="status"]')?.textContent?.includes('not granted'));
    assert.equal(await page.locator('#popupMain').isVisible(), false);
    assert.deepEqual(await read(page, 'connectionRequests'), [[['chatgpt'], true]]);

    await page.evaluate(() => { Reflect.get(window, 'harness').permissionDenied = false; });
    await page.locator('#btnAuthorizePlatforms').click();
    await page.locator('#popupMain').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#popupPermission').isVisible(), false);
    assert.deepEqual(await read(page, 'connectionRequests'), [[['chatgpt'], true], [['chatgpt'], true]]);
    assert.deepEqual(await read(page, 'activatedPlatforms'), ['chatgpt']);
});

test('Popup remains normal for already-authorized providers and unrelated sites', async () => {
    for (const [url, granted] of [
        ['https://gemini.google.com/app/a', true],
        ['https://example.com/', false],
        ['chrome://extensions/', false],
    ] as const) {
        page = await browser.newPage();
        await mount(page, 'popup', { tabs: [{ id: 1, active: true, url }], geminiAccess: granted });
        await page.locator('#popupMain').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#popupPermission').isVisible(), false);
        assert.equal(await page.locator('#btnAuthorizePlatforms').count(), 0);
        await page.close();
    }
});

test('A grant for a different provider does not bypass authorization for the current site', async () => {
    page = await browser.newPage();
    await mount(page, 'popup', { tabs: [{ id: 1, active: true, url: 'https://claude.ai/chat/test' }],
        claudeAccess: false, geminiAccess: true });
    await page.locator('#popupPermission').waitFor({ state: 'visible' });
    await page.getByRole('checkbox', { name: 'Claude', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'Grok', exact: true }).check();
    await page.locator('#btnAuthorizePlatforms').click();
    await page.waitForFunction(() => document.querySelector('.platform-permission-state[data-authorized="true"]'));
    assert.equal(await page.locator('#popupPermission').isVisible(), true);
    assert.equal(await page.locator('#popupMain').isVisible(), false);
    assert.deepEqual(await read(page, 'connectionRequests'), [[['grok'], true]]);
});
