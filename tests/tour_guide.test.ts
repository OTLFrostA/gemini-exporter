import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { mount, read } from './helpers/uiPortHarness.js';
import { assertUiNodeIsolation, installUiV2Mocks } from './helpers/uiV2Mocks.js';

installUiV2Mocks();
const { STEPS } = require('../src/ui/guidance/tourSteps.js') as
    typeof import('../src/ui/guidance/tourSteps.js');
assertUiNodeIsolation();
let browser: Browser, page: Page;
before(async () => { browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await page?.close(); }); after(async () => { await browser?.close(); });
async function open(patch: Record<string, unknown> = {}, query = '') { page = await browser.newPage(); await mount(page, 'options', { tabs: [], ...patch }, query); await page.locator('#list .item').waitFor(); }
async function start(index = 0) { await page.evaluate(async index => { const tour = Reflect.get(window, 'testUi').tour; await tour.startTour(); await tour.goToStep(index); }, index); }

test('tourGuide - module structure and all current steps remain available', () => {
    assert.deepEqual(STEPS.map(step => step.id), ['connect', 'sync', 'select', 'format', 'export', 'live_save', 'feedback']);
    for (const step of STEPS) { assert.equal(typeof step.target, 'function'); assert.ok(step.title()); assert.ok(step.description()); }
});
test('tourGuide - navigation, back and completion operate on current in-page state', async () => {
    await open(); await start(); assert.equal(await page.locator('.tour-popover h2').textContent(), 'Connect Gemini');
    await page.getByRole('button', { name: 'Next', exact: true }).click(); assert.equal(await page.locator('.tour-popover h2').textContent(), 'Scan conversations');
    await page.getByRole('button', { name: 'Back', exact: true }).click(); assert.equal(await page.locator('.tour-popover h2').textContent(), 'Connect Gemini');
    await page.evaluate(() => Reflect.get(window, 'testUi').tour.goToStep(6)); await page.getByRole('button', { name: 'Start using', exact: true }).click();
    assert.equal(await page.locator('[role=dialog]').count(), 0); assert.deepEqual(await read(page, 'patches'), []);
});
test('Tour connection checks distinguish missing tabs, unavailable Content and connected source without automatic navigation', async () => {
    await open(); await start(); await page.getByRole('button', { name: 'Open Gemini', exact: true }).waitFor();
    assert.deepEqual(await read(page, 'events'), []); await page.getByRole('button', { name: 'Open Gemini', exact: true }).click(); assert.ok((await read(page, 'events')).includes('open'));
    await page.evaluate(async () => { const h = Reflect.get(window, 'harness'); h.tabs = [{ id: 1 }]; chrome.tabs.sendMessage = (async () => { throw Error('No receiver'); }) as typeof chrome.tabs.sendMessage; await Reflect.get(window, 'testUi').tour.goToStep(0); });
    await page.getByRole('button', { name: 'Refresh Gemini', exact: true }).waitFor();
    await page.evaluate(async () => { chrome.tabs.sendMessage = (async () => ({ ok: true, accountContext: { accountId: 'trusted' } })) as typeof chrome.tabs.sendMessage; await Reflect.get(window, 'testUi').tour.goToStep(0); });
    await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Scan conversations');
});
test('Tour startup intent is consumed once from URL with no durable completion preference', async () => {
    await open({}, '?startTour=1&keep=yes'); assert.equal(await page.locator('[role=dialog]').count(), 1);
    assert.equal(new URL(page.url()).searchParams.has('startTour'), false); assert.equal(new URL(page.url()).searchParams.get('keep'), 'yes');
    await page.evaluate(() => Reflect.get(window, 'testUi').tour.finishTour());
    assert.equal(await page.evaluate(() => Reflect.get(window, 'testUi').tour.consumeTourIntent()), false);
    assert.deepEqual(await read(page, 'patches'), []);
});
test('Takeout prompt marks Settings only on explicit acknowledgement', async () => {
    await open(); await page.evaluate(() => { Reflect.get(window, 'harness').scanCount = 151; });
    await page.locator('#btnSyncAll').click(); await page.locator('.tour-popover').waitFor(); assert.deepEqual(await read(page, 'patches'), []);
    await page.getByRole('button', { name: 'Got it, don’t show again', exact: true }).click();
    assert.deepEqual(await read(page, 'patches'), [{ takeoutPromptCompleted: true }]);
});
test('tourGuide - action-driven advancement covers scan, selection, format, export, Live Save and feedback', async () => {
    await open(); await start(1); await page.locator('#btnSyncAll').click();
    await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Select conversations');
    await page.locator('#list .item input').first().check(); await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Choose a format');
    await page.locator('#format').selectOption('html'); await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Export selected conversations');
    await page.locator('#btnExport').click(); await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Live Save');
    // A directory click is also a legitimate step action, even if the user cancels the picker.
    await page.locator('#btnSetDir').click(); await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Optional feedback');
    // Prevent external navigation; the actual DOM click still advances the current step.
    await page.locator('#feedbackBox').evaluate(el => el.addEventListener('click', event => event.preventDefault()));
    await page.locator('#feedbackBox').click(); await page.waitForFunction(() => !document.querySelector('.tour-popover'));
});
test('tourGuide - navigating backwards cleans the previous action listener and delayed timer', async () => {
    await open(); await start(2);
    await page.locator('#list .item input').first().check(); await page.evaluate(() => Reflect.get(window, 'testUi').tour.prevStep());
    await page.waitForTimeout(350); assert.equal(await page.locator('.tour-popover h2').textContent(), 'Scan conversations');
    await page.locator('#list input').first().dispatchEvent('change'); await page.waitForTimeout(350);
    assert.equal(await page.locator('.tour-popover h2').textContent(), 'Scan conversations');
});
test('tourGuide - clicking actual backdrop dismisses the tour and cleans up', async () => {
    await open(); await start(); await page.locator('.tour-backdrop').first().dispatchEvent('click');
    assert.equal(await page.locator('.tour-overlay-container').count(), 0);
    assert.equal(await page.evaluate(() => Reflect.get(window, 'testUi').tour.isActive()), false);
    assert.deepEqual(await read(page, 'patches'), []);
});

test('Takeout prompt exposes three actions and closes before delivering their callbacks', async () => {
    await open();
    const cases = [
        { name: 'Import Takeout ZIP', want: ['closed', 'import'] },
        { name: 'Open Google Takeout', want: ['closed', 'web'] },
        { name: 'Got it, don’t show again', want: ['closed'] },
        { name: '×', want: ['closed'] }
    ];
    for (const item of cases) {
        const shown = await page.evaluate(() => {
            const events: string[] = [];
            Reflect.set(window, 'takeoutEvents', events);
            return Reflect.get(window, 'testUi').tour.showTakeoutPrompt(151,
                () => events.push('closed'), () => events.push('import'), () => events.push('web'));
        });
        assert.equal(shown, true);
        assert.match(await page.locator('.tour-popover').textContent() ?? '', /This scan fetched 151 conversations/);
        await page.locator('.tour-popover').getByRole('button', { name: item.name, exact: true }).click();
        assert.equal(await page.locator('.tour-popover').count(), 0);
        assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'takeoutEvents')), item.want);
    }
});

test('Takeout prompt does not queue or mark a blocked modal; Escape closes a visible prompt', async () => {
    await open(); await start(1);
    const blocked = await page.evaluate(() =>
        Reflect.get(window, 'testUi').tour.showTakeoutPrompt(151, () => { throw Error('Must not be called'); },
            () => { throw Error('Must not be called'); }, () => { throw Error('Must not be called'); }));
    assert.equal(blocked, false);
    assert.equal(await page.locator('.tour-popover h2').textContent(), 'Scan conversations');
    await page.keyboard.press('Escape');
    const shown = await page.evaluate(() => {
        const events: string[] = [];
        Reflect.set(window, 'takeoutEvents', events);
        return Reflect.get(window, 'testUi').tour.showTakeoutPrompt(151,
            () => events.push('closed'), () => events.push('import'), () => events.push('web'));
    });
    assert.equal(shown, true);
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'takeoutEvents')), ['closed']);
    assert.equal(await page.locator('.tour-popover').count(), 0);
    assert.deepEqual(await read(page, 'patches'), [], 'Guidance never owns Settings write');
});

test('tourGuide - Select All is physically clickable and advances from selection step', async () => {
    await open(); await start(2);
    await page.locator('#btnSelectAll').click();
    await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Choose a format');
    assert.equal(await page.evaluate(() => Reflect.get(window, 'testUi').tour.isActive()), true);
});
