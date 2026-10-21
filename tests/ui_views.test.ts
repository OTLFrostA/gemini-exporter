import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { mount, read, A, B } from './helpers/uiPortHarness.js';
let browser: Browser, page: Page;
before(async () => { browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await page?.close(); });
after(async () => { await browser?.close(); });
async function open(patch: Record<string, unknown> = {}) {
    page = await browser.newPage(); await mount(page, 'options', patch);
    // Multi-account v2 blanks #accountName; zero-account first imports have
    // no selector options either. Wait for the actual ready state in each case.
    await page.waitForFunction(() => {
        const harness = Reflect.get(window, 'harness');
        const count = harness?.accounts?.length ?? 0;
        const select = document.getElementById('accountIdSelect') as HTMLSelectElement;
        if (count > 0) return select.options.length === count;
        // Before readSettings finishes, the Takeout action is disabled.
        // Only an initialized zero-account Options view enables first import.
        return !(document.getElementById('btnImportTakeout') as HTMLButtonElement).disabled;
    });
    return page;
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
        return [tour.showTakeoutPrompt(151, () => {}, () => {}, () => {}), tour.showTakeoutPrompt(151, () => {}, () => {}, () => {})]; });
    assert.deepEqual(started, [true, false]); assert.equal(await page.locator('[role=dialog]').count(), 1);
    await page.getByRole('button', { name: 'Got it, don’t show again', exact: true }).click(); assert.equal(await page.locator('[role=dialog]').count(), 0);
});
test('export status and canonical conversation titles cannot inject HTML', async () => {
    await open(); await page.locator('#list .item').waitFor();
    assert.equal(await page.locator('#list img').count(), 0);
    assert.equal(await page.locator('#list .item .chat-title').textContent(), '<img src=x onerror=alert(1)>');
    await page.locator('#btnSelectAll').click(); await page.locator('#btnExport').click();
    await page.waitForFunction(() => document.body.dataset.busy !== 'true'); assert.equal(await page.locator('#status img').count(), 0);
});
test('list displays source activity and latest ExportRecord without inferring another updated state', async () => {
    await open({ indexes: rows, records }); await page.locator('#list .item').first().waitFor();
    assert.deepEqual(await page.locator('#list .item .chat-title').allTextContents(), ['Beta', 'Alpha']);
    assert.match(await page.locator('[data-chat-id=one] small').textContent() ?? '', /Last export.*markdown.*Partial export/);
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
    await open({ indexes: rows }); await page.locator('[data-chat-id=one] .chat-title').click();
    assert.equal(await page.locator('[data-chat-id=one] input').isChecked(), true);
    assert.equal(await page.locator('#selectedStat').textContent(), '1 of 2 selected');
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
    assert.equal(await page.locator('#btnStopScan').isVisible(), true);
    assert.equal(await page.locator('#btnStopScan').isEnabled(), true);
    assert.equal(await page.locator('#btnCancel').isVisible(), false);
    await page.evaluate(() => Reflect.get(window, 'harness').finishScan());
    await page.waitForFunction(() => document.body.dataset.busy !== 'true'); assert.equal(await page.locator('#btnSyncAll').isEnabled(), true);
});
test('record filters distinguish only persisted record presence; partial records count as present', async () => {
    await open({ indexes: rows, records }); await page.locator('#chatFilterSelect').selectOption('has_record');
    assert.deepEqual(await page.locator('#list .item .chat-title').allTextContents(), ['Alpha']);
    await page.locator('#chatFilterSelect').selectOption('no_record');
    assert.deepEqual(await page.locator('#list .item .chat-title').allTextContents(), ['Beta']);
    await page.locator('#chatFilterSelect').selectOption('all');
    assert.deepEqual(await page.locator('#list .item .chat-title').allTextContents(), ['Beta','Alpha']);
});
test('select visible selects only matching rows and clearing selection leaves hidden rows unselected', async () => {
    await open({ indexes: rows }); await page.locator('#chatSearchInput').fill('Alpha'); await page.locator('#btnSelectAll').click();
    await page.locator('#chatSearchInput').fill('');
    assert.equal(await page.locator('[data-chat-id=one] input').isChecked(), true); assert.equal(await page.locator('[data-chat-id=two] input').isChecked(), false);
    await page.locator('#btnSelectNone').click(); assert.equal(await page.locator('#list input:checked').count(), 0);
});
test('Select All replaces hidden selections with currently visible conversation keys', async () => {
    await open({ indexes: rows, records }); await page.locator('#list [data-chat-id=one] input').check();
    await page.locator('#chatFilterSelect').selectOption('no_record');
    await page.locator('#btnSelectAll').click();
    await page.locator('#chatFilterSelect').selectOption('all');
    assert.equal(await page.locator('[data-chat-id=one] input').isChecked(), false);
    assert.equal(await page.locator('[data-chat-id=two] input').isChecked(), true);
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

test('zero-account Takeout creates the first Gemini default only after ZIP selection', async () => {
    await open({ accounts: [], indexes: [], records: {} });
    await page.waitForFunction(() => !(document.getElementById('btnImportTakeout') as HTMLButtonElement).disabled);
    assert.equal(await page.locator('#btnSyncAll').isEnabled(), true);
    assert.equal((await read(page, 'events')).includes('create'), false);
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#btnImportTakeout').click();
    const chooser = await chooserPromise;
    assert.equal((await read(page, 'events')).includes('create'), false, 'Opening the picker must not create an account');
    await chooser.setFiles({ name: 'Takeout.zip', mimeType: 'application/zip', buffer: Buffer.from('fixture') });
    await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('Imported 2'));
    assert.deepEqual(await read(page, 'imports'), [A]);
    assert.equal((await read(page, 'events')).filter((value: string) => value === 'create').length, 1);
    assert.equal((await read(page, 'accounts')).length, 1);
    assert.equal(await page.locator('#accountName').textContent(), 'default');
    assert.deepEqual((await read(page, 'patches')).at(-1), { takeoutPromptCompleted: true });
});

test('Badge refreshes on visibility restoration and visible timer, never while hidden', async () => {
    page = await browser.newPage();
    await page.clock.install();
    await mount(page, 'badge');
    await page.waitForFunction(() => Reflect.get(window, 'harness').countRequests === 1);
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(60_000);
    assert.equal(await read(page, 'countRequests'), 1);
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => Reflect.get(window, 'harness').countRequests === 2);
    await page.clock.fastForward(60_000);
    await page.waitForFunction(() => Reflect.get(window, 'harness').countRequests === 3);
});

test('Badge drag writes only through Runtime position IPC, never Content Settings', async () => {
    page = await browser.newPage();
    await mount(page, 'badge');
    await page.waitForFunction(() => document.getElementById('geminiExportBadgeText')?.textContent === '9 conversations indexed');
    const badge = page.locator('#geminiExportBadge');
    const rect = await badge.boundingBox();
    assert.ok(rect);
    await page.mouse.move(rect.x + 15, rect.y + 10);
    await page.mouse.down();
    await page.mouse.move(rect.x - 80, rect.y - 60, { steps: 4 });
    assert.deepEqual(await read(page, 'patches'), []);
    await page.mouse.up();
    const messages = await read(page, 'messages');
    const updates = messages.filter((m: { action: string }) => m.action === 'updateBadgePosition');
    assert.equal(updates.length, 1);
    assert.ok(Number.isFinite(updates[0].position.left));
    assert.ok(Number.isFinite(updates[0].position.top));
    assert.deepEqual(await read(page, 'patches'), [], 'Content must not call Application Settings directly');
    await badge.click();
    assert.equal((await read(page, 'messages')).filter((m: { action: string }) => m.action === 'updateBadgePosition').length, 1);
});

test('Export retry uses only current failed ConversationKeys and disables skip', async () => {
    await open({ partial: true, failExport: true, indexes: [
        { key: { accountId: A, conversationId: 'delivered' }, title: 'Delivered with missing assets' },
        { key: { accountId: A, conversationId: 'failed' }, title: 'Not delivered' }
    ] });
    await page.locator('#btnSelectAll').click();
    await page.locator('#btnExport').click();
    await page.waitForFunction(() => document.body.dataset.busy !== 'true');
    assert.equal(await page.locator('#btnRetryFailed').isVisible(), true);
    assert.match(await page.locator('#status').textContent() ?? '', /Other incomplete conversations: 1; Skipped: 0; Conversation export failed: 1/);
    await page.evaluate(() => {
        const h = Reflect.get(window, 'harness'); h.partial = false; h.failExport = false;
    });
    await page.locator('#btnRetryFailed').click();
    await page.waitForFunction(() => document.body.dataset.busy !== 'true');
    const requests = await read(page, 'exports');
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].keys.map((key: { conversationId: string }) => key.conversationId), ['delivered', 'failed']);
    assert.deepEqual(requests[1].keys, [{ accountId: A, conversationId: 'failed' }]);
    assert.equal(requests[1].skipUnchanged, false);
});
