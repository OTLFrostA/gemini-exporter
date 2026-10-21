import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, openPopup, storedSettings, exposeUIStorage } from './uiFixture';

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
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');

    await optionsSwitch.click();
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(options.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 252)');
    await expect.poll(async () => (await storedSettings(options)).theme).toBe('light');
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(popup.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 252)');

    await options.reload();
    await exposeUIStorage(options);
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(optionsSwitch).toBeEnabled();

    await popupSwitch.click();
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(popup.locator('body')).toHaveCSS('background-color', 'rgb(9, 10, 16)');
    await expect.poll(async () => (await storedSettings(options)).theme).toBe('dark');
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(options.locator('body')).toHaveCSS('background-color', 'rgb(9, 10, 16)');

    await popup.reload();
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
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
