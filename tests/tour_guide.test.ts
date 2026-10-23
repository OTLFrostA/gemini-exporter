import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { A, B, mount, read } from './helpers/uiPortHarness.js';
import { assertUiNodeIsolation, installUiV2Mocks } from './helpers/uiV2Mocks.js';

installUiV2Mocks();
const { STEPS } = require('../src/ui/guidance/tourSteps.js') as
    typeof import('../src/ui/guidance/tourSteps.js');
assertUiNodeIsolation();
let browser: Browser, page: Page;
before(async () => { browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await page?.close(); }); after(async () => { await browser?.close(); });
async function open(patch: Record<string, unknown> = {}, query = '') { page = await browser.newPage(); await mount(page, 'options', { tabs: [], ...patch }, query); await page.locator('#list .item').waitFor(); }
async function start(index = 0) { await page.evaluate(async index => { const tour = Reflect.get(window, 'testUi').tour; await tour.startTour(); if (index) await tour.goToStep(index); }, index); }

test('tourGuide - module structure and all current steps remain available', () => {
    assert.deepEqual(STEPS.map(step => step.id), ['connect', 'sync', 'select', 'format', 'export', 'live_save', 'feedback']);
    for (const step of STEPS) { assert.equal(typeof step.target, 'function'); assert.ok(step.title()); assert.ok(step.description()); }
});
test('tourGuide - navigation, back and completion operate on current in-page state', async () => {
    await open(); await start(1); assert.equal(await page.locator('.tour-popover h2').textContent(), 'Scan conversations');
    await page.getByRole('button', { name: 'Next', exact: true }).click(); assert.equal(await page.locator('.tour-popover h2').textContent(), 'Select conversations');
    await page.getByRole('button', { name: 'Back', exact: true }).click(); assert.equal(await page.locator('.tour-popover h2').textContent(), 'Scan conversations');
    await page.getByRole('button', { name: 'Back', exact: true }).click(); assert.equal(await page.locator('.tour-popover h2').textContent(), 'Connect an AI platform');
    await page.evaluate(() => Reflect.get(window, 'testUi').tour.goToStep(6)); await page.getByRole('button', { name: 'Start using', exact: true }).click();
    assert.equal(await page.locator('[role=dialog]').count(), 0); assert.deepEqual(await read(page, 'patches'), []);
});
test('Tour requires a verified connection and exposes all three platforms without automatic navigation', async () => {
    await open(); await start();
    for (const name of ['Gemini', 'ChatGPT', 'Claude']) await page.locator('.tour-popover').getByRole('button', { name: `Connect ${name}`, exact: true }).waitFor();
    assert.deepEqual(await read(page, 'events'), []);
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
    await page.locator('#tourNextBtn').evaluate(button => (button as HTMLButtonElement).click());
    await page.evaluate(() => Reflect.get(window, 'testUi').tour.nextStep());
    assert.equal(await page.locator('.tour-popover h2').textContent(), 'Connect an AI platform');
    await page.getByRole('button', { name: 'Connect Gemini', exact: true }).click();
    assert.deepEqual(await read(page, 'openedUrls'), ['https://gemini.google.com/app']);
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
    await page.evaluate(({ A }) => {
        const h = Reflect.get(window, 'harness');
        h.tabs = [{ id: 1, url: 'https://gemini.google.com/app' }];
        h.contextReply = { ok: true, accountContext: { accountId: A, providerId: 'gemini' } };
        window.dispatchEvent(new Event('focus'));
    }, { A });
    await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Scan conversations');
});

for (const [provider, name] of [['chatgpt', 'ChatGPT'], ['claude', 'Claude']]) {
    test(`Tour connects ${name} from its permission click and selects that account in the workbench`, async () => {
        const account = { id: B, providerId: provider, providerAccountId: `${provider}-account` };
        await open({ accounts: [{ id: A, providerId: 'gemini', providerAccountId: 'A' }, account],
            [`${provider}Access`]: true, [`${provider}Accounts`]: [account],
            tabs: [{ id: 1, url: 'https://gemini.google.com/app' },
                { id: 2, url: provider === 'chatgpt' ? 'https://chatgpt.com/' : 'https://claude.ai/' }],
            contextReply: { ok: true, accountContext: { accountId: A, providerId: 'gemini' } } });
        await page.locator('#btnTourGuide').click();
        await page.waitForFunction(() => !(document.querySelector('#tourNextBtn') as HTMLButtonElement)?.disabled);
        assert.equal(await page.locator('.tour-popover h2').textContent(), 'Connect an AI platform');
        await page.locator('.tour-popover').getByRole('button', { name: `Connect ${name}`, exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Scan conversations');
        assert.deepEqual(await read(page, 'connectionRequests'), [[provider, true]], 'Permission starts in the click gesture');
        assert.deepEqual(await read(page, 'discoveryCalls'), [provider]);
        assert.equal(await page.locator('#accountIdSelect').inputValue(), B);
    });
    test(`Tour keeps Next disabled when ${name} access is denied`, async () => {
        await open(); await start();
        await page.locator('.tour-popover').getByRole('button', { name: `Connect ${name}`, exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.tour-popover [role=status]')?.textContent?.includes('Allow access'));
        assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
        assert.deepEqual(await read(page, 'discoveryCalls'), []);
        assert.deepEqual(await read(page, 'events'), []);
    });
    test(`Tour opens ${name} for sign-in and checks once when the user returns`, async () => {
        const url = provider === 'chatgpt' ? 'https://chatgpt.com/' : 'https://claude.ai/';
        const account = { id: B, providerId: provider, providerAccountId: `${provider}-account` };
        await open({ accounts: [{ id: A, providerId: 'gemini', providerAccountId: 'A' }, account], [`${provider}Access`]: true });
        await page.locator('#btnTourGuide').click();
        await page.locator('.tour-popover').getByRole('button', { name: `Connect ${name}`, exact: true }).click();
        await page.waitForFunction(() => Reflect.get(window, 'harness').openedUrls?.length === 1);
        assert.deepEqual(await read(page, 'openedUrls'), [url]);
        assert.deepEqual(await read(page, 'discoveryCalls'), [], 'No session request before a provider tab exists');
        assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
        await page.evaluate(({ provider, account, url }) => {
            const h = Reflect.get(window, 'harness'); h.tabs = [{ id: 2, url }]; h[`${provider}Accounts`] = [account];
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
        }, { provider, account, url });
        await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Scan conversations');
        assert.deepEqual(await read(page, 'discoveryCalls'), [provider]);
        assert.equal(await page.locator('#accountIdSelect').inputValue(), B);
    });
}

test('Tour does not retry a rate-limited connection automatically and allows another platform', async () => {
    await open({ tabs: [{ id: 2, url: 'https://chatgpt.com/' }], contextReply: { ok: false },
        chatgptAccess: true, discoveryError: 'ChatGPT session failed: 429' });
    await start();
    await page.locator('.tour-popover').getByRole('button', { name: 'Connect ChatGPT', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tour-popover [role=status]')?.textContent?.includes('Connection unavailable'));
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
    await page.waitForTimeout(1700);
    assert.deepEqual(await read(page, 'discoveryCalls'), ['chatgpt']);
    await page.evaluate(() => { const h = Reflect.get(window, 'harness'); h.discoveryError = undefined; h.tabs = []; });
    await page.locator('#tourBtnOpenGemini').click();
    assert.deepEqual(await read(page, 'openedUrls'), ['https://gemini.google.com/app']);
});

test('Tour connection choices and disabled Next remain visible in both languages and a narrow viewport', async () => {
    fs.mkdirSync('tests/output/visual_audit', { recursive: true });
    for (const language of ['en', 'zh']) {
        await open({ settings: { language } });
        await page.setViewportSize({ width: 360, height: 640 });
        await start();
        for (const id of ['tourBtnOpenGemini', 'tourBtnConnectChatGPT', 'tourBtnConnectClaude', 'tourNextBtn']) {
            const bounds = await page.locator(`#${id}`).boundingBox();
            assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 360 && bounds.y + bounds.height <= 640);
        }
        assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
        await page.screenshot({ path: `tests/output/visual_audit/onboarding-platforms-${language}.png`, animations: 'disabled' });
        await page.close();
    }
});

test('Tour rejects unknown, placeholder and wrong-provider connection evidence', async () => {
    for (const context of [null, { accountId: 'unknown', providerId: 'gemini' },
        { accountId: A, providerId: 'chatgpt' }, { accountId: B, providerId: 'gemini' }]) {
        await open({ tabs: [{ id: 1, url: 'https://gemini.google.com/app' }],
            accounts: [{ id: A, providerId: 'gemini', providerAccountId: 'A' }, { id: B, providerId: 'gemini', providerAccountId: 'default' }],
            contextReply: { ok: true, accountContext: context } });
        await start();
        await page.waitForFunction(() => document.querySelector('.tour-popover [role=status]')?.textContent?.includes('at least one'));
        assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
        await page.close();
    }
});

test('Tour connection checks do not poll provider sessions, and closing discards pending evidence', async () => {
    await open({ tabs: [{ id: 1, url: 'https://chatgpt.com/' }], contextReply: { ok: false },
        accounts: [{ id: A, providerId: 'gemini', providerAccountId: 'A' }, { id: B, providerId: 'chatgpt', providerAccountId: 'B' }] });
    await start();
    await page.waitForFunction(() => document.querySelector('.tour-popover [role=status]')?.textContent?.includes('at least one'));
    const calls = (await read(page, 'tabRequests')).length;
    await page.waitForTimeout(1700);
    assert.equal((await read(page, 'tabRequests')).length, calls);
    assert.deepEqual(await read(page, 'discoveryCalls'), []);
    await page.evaluate(async () => {
        chrome.tabs.sendMessage = (() => new Promise(resolve => Reflect.set(window, 'resolveTourContext', resolve))) as typeof chrome.tabs.sendMessage;
        await Reflect.get(window, 'testUi').tour.goToStep(0);
    });
    await page.waitForFunction(() => Reflect.has(window, 'resolveTourContext'));
    await page.keyboard.press('Escape');
    await page.evaluate(({ B }) => Reflect.get(window, 'resolveTourContext')({ ok: true, accountContext: { accountId: B, providerId: 'chatgpt' } }), { B });
    assert.equal(await page.locator('.tour-popover').count(), 0);
    assert.equal(await page.locator('#accountIdSelect').inputValue(), A);
});
test('Tour startup intent is consumed once from URL with no durable completion preference', async () => {
    await open({}, '?startTour=1&keep=yes'); assert.equal(await page.locator('[role=dialog]').count(), 1);
    assert.equal(new URL(page.url()).searchParams.has('startTour'), false); assert.equal(new URL(page.url()).searchParams.get('keep'), 'yes');
    await page.evaluate(() => Reflect.get(window, 'testUi').tour.finishTour());
    assert.equal(await page.evaluate(() => Reflect.get(window, 'testUi').tour.consumeTourIntent()), false);
    assert.deepEqual(await read(page, 'patches'), []);
});
test('Takeout prompt marks Settings when shown, including before dismissal', async () => {
    await open(); await page.evaluate(() => { Reflect.get(window, 'harness').scanCount = 151; });
    await page.locator('#btnSyncAll').click(); await page.locator('.tour-popover').waitFor();
    await page.waitForFunction(() => Reflect.get(window, 'harness').patches.some((patch: { takeoutPromptCompleted?: boolean }) => patch.takeoutPromptCompleted));
    assert.deepEqual(await read(page, 'patches'), [{ takeoutPromptCompleted: true }]);
    await page.getByRole('button', { name: 'Got it, don’t show again', exact: true }).click();
    assert.deepEqual(await read(page, 'patches'), [{ takeoutPromptCompleted: true }]);
});
test('tourGuide - action-driven advancement covers scan, selection, format, export, Live Save and feedback', async () => {
    await open(); await start(1); await page.locator('#btnSyncAll').click();
    await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Select conversations');
    await page.locator('#list .item input').first().check(); await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Choose a format');
    await page.locator('#format').selectOption('html'); await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Export selected conversations');
    await page.locator('#btnExport').click(); await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Live Save');
    // The tour now shows the folder card: select the local destination first.
    await page.locator('input[name="delivery"][value="folderWriter"]').check();
    // A directory click advances the step once the folder is selected.
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

test('tourGuide - a replaced list row becomes the live spotlight target after scanning', async () => {
    await open(); await start(2);
    await page.evaluate(() => {
        const list = document.getElementById('list')!;
        const old = list.querySelector<HTMLElement>('.item')!;
        const replacement = old.cloneNode(true) as HTMLElement;
        replacement.style.marginTop = '64px';
        list.replaceChildren(replacement);
    });
    await page.waitForFunction(() => {
        const current = document.querySelector('#list .item')?.getBoundingClientRect();
        const spotlight = document.querySelector<HTMLElement>('.tour-spotlight');
        return !!current && !!spotlight && Math.abs(parseFloat(spotlight.style.top) - (current.top - 6)) < 2;
    });
    await page.locator('#list .item input').check();
    await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Choose a format');
    assert.equal(await page.evaluate(() => Reflect.get(window, 'testUi').tour.isActive()), true);
});


test('tourGuide - final action stays inside the viewport immediately after resize', async () => {
    await open();
    await page.setViewportSize({ width: 1280, height: 1080 });
    await start(6);
    await page.waitForTimeout(350);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 640, height: 360 }]) {
        await page.setViewportSize(viewport);
        const card = await page.locator('.tour-popover').boundingBox();
        const finish = await page.getByRole('button', { name: 'Start using', exact: true }).boundingBox();
        assert.ok(card && card.x >= 11 && card.y >= 11);
        assert.ok(card.x + card.width <= viewport.width - 11 && card.y + card.height <= viewport.height - 11);
        assert.ok(finish && finish.y >= 0 && finish.y + finish.height <= viewport.height,
            'Completion must be visible without Playwright scrolling it into view');
    }
    await page.getByRole('button', { name: 'Start using', exact: true }).click();
    assert.equal(await page.locator('.tour-overlay-container').count(), 0);
});
