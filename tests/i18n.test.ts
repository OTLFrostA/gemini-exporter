import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { mount, read } from './helpers/uiPortHarness.js';
let browser: Browser, page: Page;
before(async () => { browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await page?.close(); }); after(async () => { await browser?.close(); });
async function open(kind: 'options' | 'popup' = 'options') { page = await browser.newPage(); await mount(page, kind); await page.locator(kind === 'options' ? '#accountName' : '#currentChatTitle').waitFor(); }

test('i18n - every current inline UI label has nonempty English and Chinese text', async () => {
    for (const kind of ['options', 'popup'] as const) {
        await open(kind);
        const labels = await page.locator('[data-en], [data-zh]').evaluateAll(nodes => nodes.map(node => [node.getAttribute('data-en'), node.getAttribute('data-zh')]));
        assert.ok(labels.length > 0); for (const pair of labels) assert.ok(pair.every(text => typeof text === 'string' && text.length > 0), JSON.stringify(pair));
        await page.close();
    }
});
test('i18n - all declared inline labels render their selected language', async () => {
    await open(); await page.locator('#language').selectOption('zh'); await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    const labels = await page.locator('[data-en][data-zh]').evaluateAll(nodes => nodes.map(node => [node.textContent, node.getAttribute('data-zh')]));
    for (const [actual, expected] of labels) assert.equal(actual, expected);
});
test('i18n - visible current controls have accessible names, including search and account selectors', async () => {
    await open(); assert.equal(await page.locator('#chatSearchInput').getAttribute('aria-label'), 'Search title or ID');
    assert.equal(await page.locator('#accountIdSelect').getAttribute('aria-label'), 'Account');
    for (const button of await page.locator('button:visible').all()) assert.ok((await button.textContent())?.trim());
});
test('i18n - parametric scan counts render through the selected UI language', async () => {
    await open(); await page.locator('#language').selectOption('zh'); await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    await page.evaluate(() => { Reflect.get(window, 'harness').holdScan = true; }); await page.locator('#btnSyncAll').click();
    await page.waitForFunction(() => document.getElementById('status')?.textContent === '已接纳 2 页、150 条来源记录');
    await page.evaluate(() => Reflect.get(window, 'harness').finishScan());
});
test('i18n - Settings observer handles local changes and removes its listener on cleanup', async () => {
    await open();
    const calls = await page.evaluate(() => {
        const settings = Reflect.get(window, 'testUi').settings, h = Reflect.get(window, 'harness'); let count = 0;
        const stop = settings.observeSettings(() => count++); h.fireSettingsChange('sync'); assertCount(0);
        h.fireSettingsChange('local'); assertCount(1); stop(); h.fireSettingsChange('local'); return count;
        function assertCount(expected: number) { if (count !== expected) throw Error('Unexpected observer calls'); }
    }); assert.equal(calls, 1);
});
test('i18n - inline language attributes are not duplicated within a source element', () => {
    for (const kind of ['options', 'popup']) {
        const source = readFileSync(`src/ui/${kind}/${kind}.html`, 'utf8');
        for (const tag of source.match(/<[^>]+>/g) ?? []) for (const attr of ['data-en', 'data-zh']) assert.ok((tag.match(new RegExp(`\\b${attr}=`, 'g')) ?? []).length <= 1, tag);
    }
});
test('i18n - current labels recover when switching back from Chinese to English', async () => {
    await open(); await page.locator('#language').selectOption('zh'); await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    await page.locator('#language').selectOption('en'); await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(await page.locator('#btnSyncAll').textContent(), 'Scan All'); assert.equal(await page.locator('#btnSelectAll').textContent(), 'Select visible');
});
test('i18n - labelPage translates descendants as text without interpreting translation markup', async () => {
    await open(); const result = await page.evaluate(() => {
        const root = document.createElement('div'), child = document.createElement('span');
        root.dataset.en = '<img src=x onerror=alert(1)>'; root.dataset.zh = '安全'; child.dataset.en = 'Child'; child.dataset.zh = '子元素';
        // Root and descendant are separate entries. Root text replacement must never execute HTML.
        document.body.append(root, child); Reflect.get(window, 'testUi').settings.labelPage();
        return { text: root.textContent, child: child.textContent, images: root.querySelectorAll('img').length };
    }); assert.deepEqual(result, { text: '<img src=x onerror=alert(1)>', child: 'Child', images: 0 });
});
test('i18n - language selector updates the single Settings owner and document language', async () => {
    await open(); await page.locator('#language').selectOption('zh'); await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    assert.ok((await read(page, 'patches')).some((patch: { language?: string }) => patch.language === 'zh'));
    assert.equal(await page.locator('#language').inputValue(), 'zh');
});
test('i18n - business Settings stays independent from DOM translation and document labeling', () => {
    const source = readFileSync('src/core/application/settings/index.ts', 'utf8');
    assert.doesNotMatch(source, /\b(?:document|HTMLElement|querySelector|createElement|navigator)\b/);
    assert.match(readFileSync('src/ui/utils/settings.ts', 'utf8'), /export function labelPage/);
});
