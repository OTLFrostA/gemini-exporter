import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, openPopup, storedSettings } from './uiFixture';

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
