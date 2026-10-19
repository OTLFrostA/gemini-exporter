import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { mount, read, A, B } from './helpers/uiPortHarness.js';
import { isRealTitle } from '../src/core/utils/titleText.js';
let browser: Browser, page: Page;
before(async () => { browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await page?.close(); });
after(async () => { await browser?.close(); });
async function open(patch: Record<string, unknown> = {}) {
    page = await browser.newPage(); await mount(page, 'options', patch);
    await page.locator('#accountName').waitFor(); return page;
}
const rows = [
    { key: { accountId: A, conversationId: 'one' }, title: 'Alpha', updatedAt: 10 },
    { key: { accountId: A, conversationId: 'two' }, title: 'Beta', updatedAt: 20 },
];
const records = { [A]: { one: { status: 'partial', format: 'markdown', exportedAt: 100 } } };

test('account view displays multiple trusted UUIDs and hides the selector for a single account', async () => {
    await open(); assert.equal(await page.locator('#accountIdSelect').isVisible(), true);
    assert.deepEqual(await page.locator('#accountIdSelect option').evaluateAll(items => items.map(i => (i as HTMLOptionElement).value)), [A, B]);
    await page.close(); await open({ accounts: [{ id: A, providerId: 'gemini', providerAccountId: 'only' }] });
    assert.equal(await page.locator('#accountIdSelect').isVisible(), false); assert.equal(await page.locator('#accountName').textContent(), 'only');
});
test('badge view creates one real DOM badge and displays account-scoped count', async () => {
    page = await browser.newPage(); await mount(page, 'badge');
    await page.waitForFunction(() => document.getElementById('geminiExportBadgeText')?.textContent === '9 conversations indexed');
    await page.evaluate(() => Reflect.get(window, 'badge').ensureBadge());
    assert.equal(await page.locator('#geminiExportBadge').count(), 1); assert.equal(await read(page, 'countRequests'), 1);
});
test('guidance renders a real modal and prevents overlapping Takeout prompts', async () => {
    await open(); const started = await page.evaluate(() => { const tour = Reflect.get(window, 'testUi').tour;
        return [tour.showTakeoutPrompt(() => {}, () => {}), tour.showTakeoutPrompt(() => {}, () => {})]; });
    assert.deepEqual(started, [true, false]); assert.equal(await page.locator('[role=dialog]').count(), 1);
    await page.getByRole('button', { name: 'Got it', exact: true }).click(); assert.equal(await page.locator('[role=dialog]').count(), 0);
});
test('export status and canonical conversation titles cannot inject HTML', async () => {
    await open(); await page.locator('#list .item').waitFor();
    assert.equal(await page.locator('#list img').count(), 0);
    assert.equal(await page.locator('#list .item span').textContent(), '<img src=x onerror=alert(1)>');
    await page.locator('#btnSelectAll').click(); await page.locator('#btnExport').click();
    await page.waitForFunction(() => document.body.dataset.busy !== 'true'); assert.equal(await page.locator('#status img').count(), 0);
});
test('source title recognition retains placeholder, identifier and real-title cases at its current owner', () => {
    assert.equal(isRealTitle('Research report', 'abc'), true);
    for (const value of ['', 'New chat', 'Gemini', 'abc123456789']) assert.equal(isRealTitle(value, 'abc123456789'), false);
});
test('list displays source activity and latest ExportRecord without inferring another updated state', async () => {
    await open({ indexes: rows, records }); await page.locator('#list .item').first().waitFor();
    assert.deepEqual(await page.locator('#list .item span').allTextContents(), ['Beta', 'Alpha']);
    assert.match(await page.locator('[data-chat-id=one] small').textContent() ?? '', /Partial export.*markdown/);
    assert.match(await page.locator('[data-chat-id=two] small').textContent() ?? '', /No export record/);
});
test('new or updated conversations remain unselected until explicitly selected', async () => {
    await open({ indexes: rows, records }); await page.locator('#list .item').first().waitFor();
    assert.deepEqual(await page.locator('#list input').evaluateAll(inputs => inputs.map(i => (i as HTMLInputElement).checked)), [false, false]);
    assert.equal(await page.locator('#btnExport').isDisabled(), true);
});
test('list select all and deselect all operate on current view selection', async () => {
    await open({ indexes: rows }); await page.locator('#btnSelectAll').click();
    assert.equal(await page.locator('#list input:checked').count(), 2);
    await page.locator('#btnSelectNone').click(); assert.equal(await page.locator('#list input:checked').count(), 0);
});
test('list history refresh displays the latest persisted record after focus', async () => {
    await open({ indexes: rows }); await page.locator('#list .item').first().waitFor();
    await page.evaluate(({ A }) => { Reflect.get(window, 'harness').records = { [A]: { one: { status: 'ok', format: 'json', exportedAt: 200 } } }; window.dispatchEvent(new Event('focus')); }, { A });
    await page.waitForFunction(() => document.querySelector('[data-chat-id=one] small')?.textContent?.includes('Last export · json'));
});
test('clicking the actual list label toggles its checkbox and selection statistic', async () => {
    await open({ indexes: rows }); await page.locator('[data-chat-id=one] span').click();
    assert.equal(await page.locator('[data-chat-id=one] input').isChecked(), true);
    assert.equal(await page.locator('#selectedStat').textContent(), '1 selected');
});
test('status updates replace previous progress text instead of duplicating log rows', async () => {
    await open({ holdScan: true }); await page.locator('#btnSyncAll').click();
    await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('Committed 2 pages'));
    assert.equal(await page.locator('#status').count(), 1);
    await page.evaluate(() => Reflect.get(window, 'harness').finishScan());
    await page.waitForFunction(() => document.body.dataset.busy !== 'true');
    assert.doesNotMatch(await page.locator('#status').textContent() ?? '', /Committed 2 pages/);
});
test('failed export is displayed and a retry remains available after the task ends', async () => {
    await open({ failExport: true }); await page.locator('#btnSelectAll').click(); await page.locator('#btnExport').click();
    await page.waitForFunction(() => document.body.dataset.busy !== 'true');
    assert.match(await page.locator('#status').textContent() ?? '', /failed: 1/);
    assert.equal(await page.locator('#btnExport').isEnabled(), true);
});
test('scan progress exposes committed page counts and returns controls to idle', async () => {
    await open({ holdScan: true }); await page.locator('#btnSyncAll').click();
    await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('150 source entries'));
    assert.equal(await page.locator('#btnCancel').isEnabled(), true);
    await page.evaluate(() => Reflect.get(window, 'harness').finishScan());
    await page.waitForFunction(() => document.body.dataset.busy !== 'true'); assert.equal(await page.locator('#btnSyncAll').isEnabled(), true);
});
test('record filters show exported and unexported rows including partial history', async () => {
    await open({ indexes: rows, records }); await page.locator('#chatFilterSelect').selectOption('exported');
    assert.deepEqual(await page.locator('#list .item span').allTextContents(), ['Alpha']);
    await page.locator('#chatFilterSelect').selectOption('unexported'); assert.deepEqual(await page.locator('#list .item span').allTextContents(), ['Beta']);
});
test('select visible selects only matching rows and clearing selection leaves hidden rows unselected', async () => {
    await open({ indexes: rows }); await page.locator('#chatSearchInput').fill('Alpha'); await page.locator('#btnSelectAll').click();
    await page.locator('#chatSearchInput').fill('');
    assert.equal(await page.locator('[data-chat-id=one] input').isChecked(), true); assert.equal(await page.locator('[data-chat-id=two] input').isChecked(), false);
    await page.locator('#btnSelectNone').click(); assert.equal(await page.locator('#list input:checked').count(), 0);
});
test('partial record remains visible after newer source activity without a fabricated exported badge', async () => {
    await open({ indexes: [{ ...rows[0], updatedAt: 300 }], records }); await page.locator('#list .item').waitFor();
    assert.match(await page.locator('#list small').textContent() ?? '', /Partial export/);
    assert.equal(await page.locator('#list input').isChecked(), false);
});
test('pending export does not fabricate a persisted history record', async () => {
    await open({ holdExport: true }); await page.locator('#btnSelectAll').click(); await page.locator('#btnExport').click();
    await page.waitForFunction(() => document.body.dataset.busy === 'true');
    assert.match(await page.locator('#list small').textContent() ?? '', /No export record/);
    await page.evaluate(() => Reflect.get(window, 'harness').finishExport());
});
test('list selection and history do not implement Application skip or export-state rules', async () => {
    await open({ indexes: rows, records }); await page.locator('#btnSelectAll').click(); await page.locator('#btnExport').click();
    await page.waitForFunction(() => document.body.dataset.busy !== 'true');
    const request = (await read(page, 'exports'))[0]; assert.equal(request.skipUnchanged, true);
    assert.deepEqual(request.keys.map((k: { conversationId: string }) => k.conversationId).sort(), ['one', 'two']);
});
test('partial history never prevents an explicit retry selection', async () => {
    await open({ indexes: [rows[0]], records }); await page.locator('#list input').check();
    assert.equal(await page.locator('#btnExport').isEnabled(), true);
});
test('busy workbench disables conflicting actions and selection, then restores them after cancellation returns', async () => {
    await open({ holdExport: true }); await page.locator('#btnSelectAll').click(); await page.locator('#btnExport').click();
    await page.waitForFunction(() => document.body.dataset.busy === 'true');
    for (const selector of ['#accountIdSelect', '#btnSyncAll', '#btnSelectAll', '#list input']) assert.equal(await page.locator(selector).isDisabled(), true, selector);
    await page.locator('#btnCancel').click(); assert.equal(await page.locator('#btnSelectAll').isDisabled(), true);
    await page.evaluate(() => Reflect.get(window, 'harness').finishExport());
    await page.waitForFunction(() => document.body.dataset.busy !== 'true'); assert.equal(await page.locator('#list input').isEnabled(), true);
});
