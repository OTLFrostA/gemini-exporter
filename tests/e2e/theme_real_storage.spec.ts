import { test, expect, seedRegistryAccounts } from './fixtures';
import { accountId, openOptions, openPopup, seedConversations, storedSettings, exposeUIStorage } from './uiFixture';

/**
 * Real extension test: shared Settings persistence and theme CSS must work across
 * actual chrome-extension:// Options and Popup pages, not only isolated UI mocks.
 */
test('Options and Popup theme toggle persists, repaints, and synchronizes across windows', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const options = await openOptions(context, extensionId);
    const popup = await openPopup(context, extensionId);
    const optionsSwitch = options.locator('#btnThemeToggle');
    const popupSwitch = popup.locator('#btnThemeToggle');

    await expect(optionsSwitch).toBeEnabled();
    await expect(popupSwitch).toBeEnabled();
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'light');

    await optionsSwitch.click();
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(options.locator('body')).toHaveCSS('background-color', 'rgb(16, 16, 17)');
    await expect.poll(async () => (await storedSettings(options)).theme).toBe('dark');
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(popup.locator('body')).toHaveCSS('background-color', 'rgb(16, 16, 17)');

    await options.reload();
    await exposeUIStorage(options);
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(optionsSwitch).toBeEnabled();

    await popupSwitch.click();
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(popup.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 252)');
    await expect.poll(async () => (await storedSettings(options)).theme).toBe('light');
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(options.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 252)');

    await popup.reload();
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(popupSwitch).toBeEnabled();
});


test('Stored Light theme is ready before either extension page becomes visible', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const setup = await openOptions(context, extensionId);
    await setup.evaluate(() => Reflect.get(globalThis, 'uiFixture').updateSettings({ theme: 'light' }));
    await expect.poll(async () => (await storedSettings(setup)).theme).toBe('light');
    await setup.close();

    for (const kind of ['options', 'popup']) {
        const page = await context.newPage();
        await page.addInitScript(() => {
            const original = chrome.storage.local.get.bind(chrome.storage.local);
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            Reflect.set(window, '__releaseThemeRead', release);
            Object.defineProperty(chrome.storage.local, 'get', {
                configurable: true,
                value: (...args: Parameters<typeof chrome.storage.local.get>) =>
                    args[0] === 'gemini_exporter_v2_settings'
                        ? gate.then(() => original(...args))
                        : original(...args),
            });
        });
        await page.goto(`chrome-extension://${extensionId}/src/ui/${kind}/${kind}.html`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'loading');
        await expect(page.locator('html')).toHaveCSS('visibility', 'hidden');
        await page.evaluate(() => Reflect.get(window, '__releaseThemeRead')());
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await expect(page.locator('html')).toHaveCSS('visibility', 'visible');
        await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 252)');
        await page.close();
    }
});


test('Light first visible frame has no dark cards or initial background transitions', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const setup = await openOptions(context, extensionId);
    await setup.evaluate(() => Reflect.get(globalThis, 'uiFixture').updateSettings({ theme: 'light' }));
    await expect.poll(async () => (await storedSettings(setup)).theme).toBe('light');
    await setup.close();

    for (const kind of ['options', 'popup'] as const) {
        const page = await context.newPage();
        await page.addInitScript(() => {
            document.addEventListener('DOMContentLoaded', () => {
                const root = document.documentElement;
                const capture = () => {
                    if (root.dataset.theme !== 'light' || root.hasAttribute('data-theme-unready')) return;
                    const ghost = document.querySelector('#btnThemeToggle');
                    const block = document.querySelector('.delivery-card,.tab-group');
                    Reflect.set(window, '__firstVisiblePalette', {
                        theme: root.dataset.theme,
                        ghost: ghost ? getComputedStyle(ghost).backgroundColor : null,
                        block: block ? getComputedStyle(block).backgroundColor : null,
                        visibility: getComputedStyle(root).visibility,
                        bootstrap: root.hasAttribute('data-theme-bootstrap'),
                        ghostTransition: ghost ? getComputedStyle(ghost).transitionDuration : null,
                    });
                };
                const observer = new MutationObserver(() => {
                    capture();
                    if (Reflect.has(window, '__firstVisiblePalette')) observer.disconnect();
                });
                observer.observe(root, { attributes: true, attributeFilter: ['data-theme-unready'] });
                capture();
            }, { once: true });
        });
        await page.goto(`chrome-extension://${extensionId}/src/ui/${kind}/${kind}.html`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await expect(page.locator('html')).toHaveCSS('visibility', 'visible');
        const first = await page.evaluate(() => Reflect.get(window, '__firstVisiblePalette'));
        expect(first, `${kind}: first visible theme snapshot`).toBeTruthy();
        expect(first.visibility).toBe('visible');
        expect(first.bootstrap, 'transitions should still be disabled at first paint').toBe(true);
        expect(first.ghostTransition, 'no dark-to-light animation on first paint').toBe('0s');
        // Light buttons and cards should start light, not animate from their dark CSS defaults.
        for (const [name, color] of Object.entries({ ghost: first.ghost, block: first.block })) {
            const channels = String(color).match(/[0-9]+/g)?.slice(0, 3).map(Number) ?? [];
            expect(channels.length, `${kind}: ${name} background should be RGB`).toBe(3);
            expect(channels.every(channel => channel >= 215),
                `${kind}: ${name} was initially dark: ${color}`).toBe(true);
        }
        await expect.poll(() => page.locator('html').getAttribute('data-theme-bootstrap')).toBeNull();
        // Normal interaction animations are retained once initial appearance settles.
        expect(await page.locator('#btnThemeToggle').evaluate(node => getComputedStyle(node).transitionDuration)).not.toBe('0s');
        await page.close();
    }
});


test('Light list status chips stay light for every export state', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'exported' }, { id: 'updated', updatedAt: 300 }, { id: 'partial' }, { id: 'unavailable' }], {
        exported: { exportedAt: 200, format: 'markdown', status: 'ok', chatTime: 100 },
        updated: { exportedAt: 200, format: 'markdown', status: 'ok', chatTime: 100 },
        partial: { exportedAt: 200, format: 'markdown', status: 'partial', chatTime: 100 },
        unavailable: { exportedAt: 200, format: 'markdown', status: 'partial', chatTime: 100,
            attachmentIssues: [{ resourceId: 'photo', name: 'photo.png', code: 'RESOURCE_DOWNLOAD_FAILED', httpStatus: 503 }] },
    });
    // An index without a saved Detail cannot be exported offline, so the real export run marks it failed.
    await page.evaluate(async accountId => {
        await Reflect.get(globalThis, 'uiFixture').putIndexes([
            { key: { accountId, conversationId: 'failed' }, title: 'failed', titleSource: 'provider', updatedAt: 50 }]);
    }, accountId);
    await page.reload();
    await page.locator('#devToggle').check();
    await page.locator('[data-chat-id="failed"] .chat-title').click();
    await page.locator('#btnExport').click();
    await expect(page.locator('[data-chat-id="failed"] .status-failed')).toHaveText('Export failed');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    const palette = async (state: string) => page.locator(`[data-chat-id="${state}"] .status-${state}`)
        .evaluate(node => { const style = getComputedStyle(node); return [style.color, style.borderColor, style.backgroundColor]; });
    const dark: string[] = [];
    for (const state of ['exported', 'updated', 'partial', 'unavailable', 'failed']) {
        const [, , background] = await palette(state);
        const channels = background.match(/[0-9]+/g)?.slice(0, 3).map(Number) ?? [];
        if (!channels.every(channel => channel >= 215)) dark.push(`${state}: ${background}`);
    }
    expect(dark, 'light chips with dark backgrounds').toEqual([]);
    expect(await palette('unavailable')).toEqual(await palette('updated'));
    expect(await palette('failed')).toEqual(await palette('partial'));
});
