import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount } from './helpers/uiPortHarness.js';
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
