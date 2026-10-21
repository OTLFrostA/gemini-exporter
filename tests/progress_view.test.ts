import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, A } from './helpers/uiPortHarness.js';
import { errorText } from '../src/ui/shared/settings.js';

test('headless UI status helpers preserve errors without requiring a DOM', () => {
    assert.equal(errorText(new Error('Offline')), 'Offline'); assert.equal(errorText('Aborted'), 'Aborted');
});
test('current progress status displays committed counts, final result and clears busy controls', async () => {
    const browser = await chromium.launch({ headless: true }); try {
        const page = await browser.newPage(); await mount(page, 'options', { holdScan: true });
        await page.locator('#btnSyncAll').click(); await page.waitForFunction(() => document.body.dataset.busy === 'true');
        assert.equal(await page.locator('#status').textContent(), 'Committed 2 pages, 150 source entries');
        assert.equal(await page.locator('#status').getAttribute('aria-live'), 'polite');
        assert.equal(await page.locator('#progWrap').isVisible(), true);
        assert.match(await page.locator('#progWrap').getAttribute('class') ?? '', /indeterminate/);
        assert.doesNotMatch(await page.locator('#status').textContent() ?? '', /%/);
        await page.evaluate(() => Reflect.get(window, 'harness').finishScan()); await page.waitForFunction(() => document.body.dataset.busy !== 'true');
        assert.match(await page.locator('#status').textContent() ?? '', /Local page budget reached/); assert.equal(await page.locator('#btnSyncAll').isEnabled(), true);
        assert.equal(await page.locator('#progWrap').isVisible(), false);
    } finally { await browser.close(); }
});
test('a subsequent operation keeps its current progress after the previous task completes; no stale delayed hide erases it', async () => {
    const browser = await chromium.launch({headless:true});try{
        const page=await browser.newPage();await page.clock.install();await mount(page,'options',{holdScan:true});
        await page.locator('#btnSyncAll').click();await page.evaluate(()=>Reflect.get(window,'harness').finishScan());await page.waitForFunction(()=>document.body.dataset.busy!=='true');
        await page.locator('#btnSyncAll').click();await page.clock.fastForward(1000);assert.equal(await page.locator('#status').textContent(),'Committed 2 pages, 150 source entries');assert.equal(await page.locator('#btnStopScan').isVisible(),true);
        await page.evaluate(()=>Reflect.get(window,'harness').finishScan());await page.waitForFunction(()=>document.body.dataset.busy!=='true');assert.equal(await page.locator('#btnStopScan').isVisible(),false);
    }finally{await browser.close();}
});


test('Browser export visibly stages each result before ZIP delivery without marking an ExportRecord', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await mount(page, 'options', { holdExport: true, indexes: [
            { key: { accountId: A, conversationId: 'one' }, title: 'One', updatedAt: 100 },
            { key: { accountId: A, conversationId: 'two' }, title: 'Two', updatedAt: 100 },
        ] });
        await page.locator('#btnSelectAll').click();
        await page.locator('#btnExport').click();
        await page.waitForFunction(() => typeof Reflect.get(window, 'harness').finishExport === 'function');

        await page.evaluate(() => {
            const h = Reflect.get(window, 'harness');
            h.exportOptions.onItemUpdate({ key: h.indexes[0].key, status: 'prepared' });
        });
        assert.equal(await page.locator('[data-chat-id="one"] .status-prepared').textContent(), 'Prepared for download');
        assert.equal(await page.locator('[data-chat-id="one"] .status-exported').count(), 0);
        assert.match(await page.locator('#bar').getAttribute('style') ?? '', /width:\s*45%/);
        assert.equal(await page.evaluate(() => Object.keys(Reflect.get(window, 'harness').records).length), 0);

        await page.evaluate(() => {
            const h = Reflect.get(window, 'harness');
            const record = { format: 'markdown', exportedAt: 200, chatTime: 100, status: 'ok' };
            h.records[A] = { one: record };
            h.exportOptions.onItemUpdate({ key: h.indexes[0].key, status: 'exported', record });
        });
        assert.equal(await page.locator('[data-chat-id="one"] .status-exported').textContent(), 'Last export complete');
        assert.equal(await page.locator('.status-prepared').count(), 0);
        await page.evaluate(() => Reflect.get(window, 'harness').finishExport());
        await page.waitForFunction(() => document.body.dataset.busy !== 'true');
        assert.equal(await page.locator('[data-chat-id="one"] .status-exported').count(), 1);
    } finally { await browser.close(); }
});

test('Folder export updates persisted item badges and the bar before the full batch finishes', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await mount(page, 'options', { holdExport: true, directoryName: 'exports',
            settings: { exportDelivery: 'folderWriter' }, indexes: [
                { key: { accountId: A, conversationId: 'one' }, title: 'One', updatedAt: 100 },
                { key: { accountId: A, conversationId: 'two' }, title: 'Two', updatedAt: 100 },
            ] });
        await page.locator('#btnSelectAll').click();
        await page.locator('#btnExport').click();
        await page.waitForFunction(() => typeof Reflect.get(window, 'harness').finishExport === 'function');

        await page.evaluate(() => {
            const h = Reflect.get(window, 'harness');
            const record = { format: 'markdown', exportedAt: 200, chatTime: 100, status: 'ok' };
            h.records[A] = { one: record };
            h.exportOptions.onItemUpdate({ key: h.indexes[0].key, status: 'exported', record });
        });
        assert.equal(await page.locator('[data-chat-id="one"] .status-exported').textContent(), 'Last export complete');
        assert.equal(await page.locator('[data-chat-id="two"] .status-exported').count(), 0);
        assert.match(await page.locator('#bar').getAttribute('style') ?? '', /width:\s*50%/);
        assert.match(await page.locator('#status').textContent() ?? '', /saved 1/);

        await page.evaluate(() => Reflect.get(window, 'harness').finishExport());
        await page.waitForFunction(() => document.body.dataset.busy !== 'true');
    } finally { await browser.close(); }
});
