import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { mount, read } from './helpers/uiPortHarness.js';
import { indexStorage } from './helpers/indexStorage.js';
import { getSettings, updateSettings } from '../src/application/settings/index.js';
import { isVersionGreater } from '../src/shared/utils/pathUtils.js';
import { getLatestEligibleFeature } from '../src/ui/guidance/featureReleases.js';
let browser: Browser, page: Page;
before(async () => { browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await page?.close(); }); after(async () => { await browser?.close(); });
test('feature version comparison uses numeric components at the current shared owner', () => {
    for (const [a, b, expected] of [['1.10.0', '1.9.0', true], ['1.5.0', '1.5.0', false], ['1.4.0', '1.5.0', false], ['2.0.0', '1.99.99', true]] as const) assert.equal(isVersionGreater(a, b), expected);
});
test('featureReleases - latest eligible release arbitration excludes old, future and unusable baselines', () => {
    assert.deepEqual(getLatestEligibleFeature('1.4.0', '1.8.1'), { version: '1.7.0', stepId: 'export' });
    assert.deepEqual(getLatestEligibleFeature('1.4.0', '1.5.0'), { version: '1.5.0', stepId: 'live_save' });
    for (const baseline of ['', 'invalid', '1.7.0', '1.8.1', '2.0.0']) assert.equal(getLatestEligibleFeature(baseline, '1.8.1'), null);
});
test('last seen feature version persists through Application Settings', async () => {
    const env = indexStorage(); try {
        await updateSettings({ lastSeenFeatureVersion: '1.5.0' }); assert.equal((await getSettings()).lastSeenFeatureVersion, '1.5.0');
        await updateSettings({ lastSeenFeatureVersion: '1.7.0' }); assert.equal((await getSettings()).lastSeenFeatureVersion, '1.7.0');
    } finally { env.restore(); }
});
test('TourGuide - Spotlight activates, excludes competing modals and dismisses exactly once', async () => {
    page = await browser.newPage(); await mount(page, 'options'); await page.locator('#list .item').waitFor();
    const result = await page.evaluate(() => { const tour = Reflect.get(window, 'testUi').tour; const h = Reflect.get(window, 'harness'); h.dismissed = 0;
        return [tour.startFeatureSpotlight('1.7.0', 'export', () => h.dismissed++), tour.startFeatureSpotlight('1.5.0', 'live_save', () => h.dismissed++)]; });
    assert.deepEqual(result, [true, false]); await page.getByRole('button', { name: 'Got it', exact: true }).click();
    assert.equal(await page.locator('[role=dialog]').count(), 0); assert.equal(await read(page, 'dismissed'), 1);
    await page.evaluate(() => Reflect.get(window, 'testUi').tour.dismissFeatureSpotlight()); assert.equal(await read(page, 'dismissed'), 1);
});
test('format Spotlight dismissal restores focus without initiating PDF/HTML export', async () => {
    page = await browser.newPage(); await mount(page, 'options'); await page.locator('#format').focus();
    await page.evaluate(() => Reflect.get(window, 'testUi').tour.startFeatureSpotlight('1.7.0', 'format', () => {}));
    assert.equal(await page.locator('[role=dialog]').count(), 1); await page.getByRole('button', { name: 'Got it', exact: true }).click();
    assert.equal(await page.locator('#format').evaluate(el => document.activeElement === el), true);
    assert.deepEqual(await read(page, 'exports'), []);
});
