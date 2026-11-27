import { waitForAuthorization } from '../helpers/tourNavigation';
import { test, expect } from './fixtures';

test.use({ grantGemini: false });
test('shipping install has no platform access and leaves unconnected source pages untouched', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    const access = await options.evaluate(async () => ({ permissions: await chrome.permissions.getAll(), scripts: await chrome.scripting.getRegisteredContentScripts() }));
    expect(access.permissions.origins ?? []).toEqual([]);
    expect(access.permissions.permissions ?? []).not.toContain('identity');
    expect(access.scripts).toEqual([]);
    for (const url of ['https://gemini.google.com/app', 'https://chatgpt.com/', 'https://claude.ai/', 'https://grok.com/']) {
        const source = await context.newPage();
        await source.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><main>Unconnected source</main>' }));
        await source.goto(url);
        expect(await source.locator('#geminiExportBadge').count()).toBe(0);
        await source.close();
    }
    await options.locator('#btnTourGuide').click(); await waitForAuthorization(options);
    for (const platform of ['gemini', 'chatgpt', 'claude', 'grok']) {
        const group = options.locator(`.platform-permission-row[data-platform="${platform}"]`);
        await expect(group.locator('input[type=checkbox]')).toBeChecked();
        await group.locator('summary').click();
        await expect(group.locator('li').first()).toBeVisible();
    }
    await expect(options.locator('#tourNextBtn')).toBeDisabled();
});

test('unconnected ChatGPT shows the tutorial authorization selector instead of export actions in Popup', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    // Loading Popup directly cannot grant activeTab in headless E2E;
    // provide only the current tab URL, leaving actual host permissions ungranted.
    await popup.addInitScript(() => {
        Object.defineProperty(chrome.tabs, 'query', {
            configurable: true,
            value: async () => [{ id: 9, active: true, url: 'https://chatgpt.com/c/fixture' }],
        });
    });
    await popup.goto('chrome-extension://' + extensionId + '/src/ui/popup/popup.html');
    await expect(popup.locator('#popupPermission')).toBeVisible();
    await expect(popup.locator('#popupMain')).toBeHidden();
    await expect(popup.locator('#popupPermissionTitle')).toHaveText('Authorize AI platforms');
    const checkboxes = popup.locator('.platform-permission-row input');
    await expect(checkboxes).toHaveCount(4);
    await expect(popup.locator('.platform-permission-row[data-platform="chatgpt"] input')).toBeChecked();
    for (const platform of ['gemini', 'claude', 'grok']) {
        await expect(popup.locator('.platform-permission-row[data-platform="' + platform + '"] input')).not.toBeChecked();
    }
    await expect(popup.locator('#btnAuthorizePlatforms')).toBeEnabled();
    const permissions = await popup.evaluate(() => chrome.permissions.getAll());
    expect(permissions.origins ?? []).toEqual([]);
    expect(permissions.permissions ?? []).not.toContain('identity');
    expect(await popup.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toEqual([]);
    await popup.close();
});

test('fixture browser blocks unexpected external requests while allowing explicit mocks', async ({ context }) => {
    const blockedPage = await context.newPage();
    await expect(blockedPage.goto('https://untrusted.invalid/')).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    await blockedPage.close();

    const page = await context.newPage();
    await page.route('https://fixture.invalid/**', route => route.fulfill({
        contentType: 'text/html',
        body: '<main data-testid="fixture">Local browser fixture</main>',
    }));
    await page.goto('https://fixture.invalid/');
    await expect(page.getByTestId('fixture')).toHaveText('Local browser fixture');
});
