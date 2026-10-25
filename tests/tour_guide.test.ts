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
    await page.getByRole('button', { name: 'Back', exact: true }).click(); assert.equal(await page.locator('.tour-popover h2').textContent(), 'Authorize AI platforms');
    await page.evaluate(() => Reflect.get(window, 'testUi').tour.goToStep(6)); await page.getByRole('button', { name: 'Start using', exact: true }).click();
    assert.equal(await page.locator('[role=dialog]').count(), 0); assert.deepEqual(await read(page, 'patches'), []);
});
async function choose(platforms: string[]) {
    for (const platform of ['Gemini', 'ChatGPT', 'Claude']) {
        await page.getByRole('checkbox', { name: platform, exact: true }).setChecked(platforms.includes(platform));
    }
}

test('Authorization shows one button above a default-selected platform list without opening websites', async () => {
    await open({ geminiAccess: false }); await start();
    for (const name of ['Gemini', 'ChatGPT', 'Claude'])
        assert.equal(await page.getByRole('checkbox', { name, exact: true }).isChecked(), true);
    assert.equal(await page.locator('.platform-authorization button').count(), 1);
    assert.deepEqual(await read(page, 'events'), []);
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
    await page.evaluate(() => Reflect.get(window, 'testUi').tour.nextStep());
    assert.equal(await page.locator('.tour-popover h2').textContent(), 'Authorize AI platforms');
    await page.locator('#btnAuthorizePlatforms').click();
    await page.waitForFunction(() => !(document.querySelector('#tourNextBtn') as HTMLButtonElement)?.disabled);
    assert.deepEqual(await read(page, 'connectionRequests'), [[['gemini', 'chatgpt', 'claude'], true]]);
    assert.deepEqual(await read(page, 'openedUrls') ?? [], []);
    assert.equal(await page.locator('.platform-permission-state[data-authorized="true"]').count(), 3);
    assert.equal(await page.locator('.tour-popover h2').textContent(), 'Authorize AI platforms');
    await page.locator('#tourNextBtn').click();
    assert.equal(await page.locator('.tour-popover h2').textContent(), 'Scan conversations');
});

test('Authorization requests only the selection, disables empty selection, and can retry denial', async () => {
    await open({ geminiAccess: false, permissionDenied: true }); await start();
    await choose([]);
    assert.equal(await page.locator('#btnAuthorizePlatforms').isDisabled(), true);
    await choose(['ChatGPT', 'Claude']);
    await page.locator('#btnAuthorizePlatforms').click();
    await page.waitForFunction(() => document.querySelector('.platform-authorization [role=status]')?.textContent?.includes('not granted'));
    assert.deepEqual(await read(page, 'connectionRequests'), [[['chatgpt', 'claude'], true]]);
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
    assert.deepEqual(await read(page, 'discoveryCalls'), []);
    await page.evaluate(() => { Reflect.get(window, 'harness').permissionDenied = false; });
    await page.locator('#btnAuthorizePlatforms').click();
    await page.waitForFunction(() => !(document.querySelector('#tourNextBtn') as HTMLButtonElement)?.disabled);
    assert.equal(await page.locator('.platform-permission-row[data-platform="gemini"] .platform-permission-state').textContent(), 'Not authorized');
});

for (const [provider, name] of [['chatgpt', 'ChatGPT'], ['claude', 'Claude']]) {
    test(`Authorization can select an existing ${name} account without requiring login for the grant`, async () => {
        const account = { id: B, providerId: provider, providerAccountId: `${provider}-account` };
        await open({ accounts: [{ id: A, providerId: 'gemini', providerAccountId: 'A' }, account],
            [`${provider}Accounts`]: [account], tabs: [{ id: 2, url: provider === 'chatgpt' ? 'https://chatgpt.com/' : 'https://claude.ai/' }] });
        await page.locator('#btnTourGuide').click();
        await choose([name]);
        await page.locator('#btnAuthorizePlatforms').click();
        await page.waitForFunction(() => document.querySelector('.platform-authorization [role=status]')?.textContent?.includes('Selected platforms authorized'));
        assert.deepEqual(await read(page, 'connectionRequests'), [[[provider], true]]);
        assert.deepEqual(await read(page, 'discoveryCalls'), [provider]);
        assert.equal(await page.locator('#accountIdSelect').inputValue(), B);
    });
}

test('Existing access enables Next; unchecking never revokes access, and revocation refreshes the view', async () => {
    await open(); await start();
    await page.waitForFunction(() => !(document.querySelector('#tourNextBtn') as HTMLButtonElement)?.disabled);
    await choose([]);
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), false);
    assert.deepEqual(await read(page, 'connectionRequests'), []);
    await page.evaluate(() => { const h = Reflect.get(window, 'harness'); h.geminiAccess = false; h.accessListener(); });
    await page.waitForFunction(() => (document.querySelector('#tourNextBtn') as HTMLButtonElement)?.disabled);
    assert.equal(await page.locator('.platform-permission-state[data-authorized="true"]').count(), 0);
});

test('Standalone authorization reuses the same list and stays outside the tutorial', async () => {
    await open({ geminiAccess: false });
    await page.locator('#btnPlatformPermissions').click();
    assert.equal(await page.locator('#tourNextBtn').count(), 0);
    assert.equal(await page.locator('.tour-step-badge').textContent(), 'Site access');
    await choose(['Gemini']);
    await page.locator('#btnAuthorizePlatforms').click();
    await page.waitForFunction(() => document.querySelector('.platform-permission-state[data-authorized="true"]'));
    await page.locator('#platformAuthorizationDone').click();
    assert.equal(await page.locator('.tour-popover').count(), 0);
    await page.locator('#btnPlatformPermissions').click();
    for (const name of ['Gemini', 'ChatGPT', 'Claude']) assert.equal(await page.getByRole('checkbox', { name, exact: true }).isChecked(), true);
    await page.keyboard.press('Escape');
    assert.deepEqual(await read(page, 'patches'), []);
});

test('Closing discards a pending authorization result and does not change account selection', async () => {
    await open({ geminiAccess: false, holdPermission: true }); await start();
    await page.locator('#btnAuthorizePlatforms').click();
    assert.equal(await page.getByRole('checkbox', { name: 'Gemini', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.evaluate(() => Reflect.get(window, 'harness').finishPermission(true));
    assert.equal(await page.locator('.tour-popover').count(), 0);
    assert.deepEqual(await read(page, 'discoveryCalls'), []);
    assert.equal(await page.locator('#accountIdSelect').inputValue(), A);
});

test('Slow account discovery does not block authorization and closing discards its late selection', async () => {
    await open({ geminiAccess: false, holdDiscovery: true });
    await page.locator('#btnTourGuide').click();
    await page.locator('#btnAuthorizePlatforms').click();
    await page.waitForFunction(() => typeof Reflect.get(window, 'harness').finishDiscovery === 'function');
    await page.waitForFunction(() => !(document.querySelector('#tourNextBtn') as HTMLButtonElement)?.disabled);
    assert.equal(await page.locator('#btnAuthorizePlatforms').isEnabled(), true);
    await page.keyboard.press('Escape');
    await page.evaluate(({ B }) => Reflect.get(window, 'harness').finishDiscovery(B), { B });
    assert.equal(await page.locator('#accountIdSelect').inputValue(), A);
});

test('Account discovery failure does not negate a successful authorization or cause polling', async () => {
    await open({ geminiAccess: false, tabs: [{ id: 2, url: 'https://chatgpt.com/' }], discoveryError: 'session failed: 429' });
    await page.locator('#btnTourGuide').click(); await choose(['ChatGPT']);
    await page.locator('#btnAuthorizePlatforms').click();
    await page.waitForFunction(() => !(document.querySelector('#tourNextBtn') as HTMLButtonElement)?.disabled);
    assert.deepEqual(await read(page, 'discoveryCalls'), ['chatgpt']);
    await page.waitForTimeout(1100);
    assert.deepEqual(await read(page, 'discoveryCalls'), ['chatgpt']);
    assert.deepEqual(await read(page, 'openedUrls') ?? [], []);
});

test('Authorization stays visible in both languages and a narrow viewport', async () => {
    fs.mkdirSync('tests/output/visual_audit', { recursive: true });
    for (const language of ['en', 'zh']) {
        await open({ settings: { language }, geminiAccess: false });
        await page.setViewportSize({ width: 360, height: 640 }); await start();
        await page.waitForFunction(() => {
            const popover = document.querySelector('.tour-popover') as HTMLElement | null;
            return !!popover?.style.top && popover.getBoundingClientRect().bottom <= innerHeight;
        });
        for (const selector of ['#btnAuthorizePlatforms', '.platform-permission-list', '#tourNextBtn']) {
            const bounds = await page.locator(selector).boundingBox();
            assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 360 && bounds.y + bounds.height <= 640, `${selector}: ${JSON.stringify(bounds)}`);
        }
        await page.screenshot({ path: `tests/output/visual_audit/authorization-${language}.png`, animations: 'disabled' });
        await page.close();
    }
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

test('tourGuide - a deselection change does not advance, while a checked input does', async () => {
    await open(); await start(2);
    await page.evaluate(() => {
        const input = document.querySelector('#list input');
        if (!(input instanceof HTMLInputElement)) throw new Error('Missing conversation checkbox');
        input.checked = false;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(350);
    assert.equal(await page.locator('.tour-popover h2').textContent(), 'Select conversations');
    await page.locator('#list .item input').first().check();
    await page.waitForFunction(() => document.querySelector('.tour-popover h2')?.textContent === 'Choose a format');
});

test('tourGuide - dismissal restores HTML and SVG focus, and nested SVG clicks stay inside the card', async () => {
    await open();
    for (const svg of [false, true]) {
        await page.evaluate(svg => {
            document.getElementById('focusOrigin')?.remove();
            const element = svg ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement('button');
            element.id = 'focusOrigin'; element.setAttribute('tabindex', '0');
            document.body.append(element); element.focus();
        }, svg);
        await start(1);
        await page.evaluate(() => {
            const next = document.getElementById('tourNextBtn');
            if (!next) throw new Error('Missing Next button');
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            next.append(icon);
            icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        assert.equal(await page.locator('.tour-popover h2').textContent(), 'Select conversations');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'focusOrigin');
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        assert.equal(await page.locator('.tour-overlay-container').count(), 0);
    }
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
