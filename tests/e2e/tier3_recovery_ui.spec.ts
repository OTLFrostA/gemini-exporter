import { test, expect, seedRegistryAccounts } from './fixtures';
import { accountId, openOptions } from './uiFixture';

test('scan connection guidance follows the workbench language', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    for (const language of ['zh', 'en']) {
        await page.evaluate(async language => Reflect.get(globalThis, 'uiFixture').updateSettings({ language }), language);
        await expect(page.locator('html')).toHaveAttribute('lang', language === 'zh' ? 'zh-CN' : 'en');
        await page.locator('#btnSyncAll').click();
        await expect(page.locator('#scanStatus')).toHaveText(language === 'zh'
            ? '请打开 Gemini、ChatGPT、Claude 或 Grok 并登录，再通过“新手引导”连接后同步会话。'
            : 'Open Gemini, ChatGPT, Claude or Grok and connect an account before scanning.');
        await expect(page.locator('#btnSyncAll')).toBeEnabled();
        const sync = await page.locator('#btnSyncAll').boundingBox();
        const message = await page.locator('#scanStatus').boundingBox();
        expect(sync && message && message.x === sync.x && message.y - (sync.y + sync.height) <= 16).toBe(true);
        await page.screenshot({ path: `tests/output/visual_audit/tier3_fixed_scan_guidance_${language}.png` });
    }
    await page.close();
});

test('cancelled folder picker unlocks the workbench and allows a later successful selection', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await page.locator('input[name="delivery"][value="folderWriter"]').check();
    await expect(page.locator('#btnSetDir')).toBeEnabled();
    // Model the browser API's unresolved modal and genuine AbortError result.
    // This checks application recovery, not native-dialog screenshot coverage.
    await page.evaluate(() => {
        Reflect.set(window, 'showDirectoryPicker', () => new Promise((_resolve, reject) => {
            Reflect.set(window, 'cancelFolderPicker', () => reject(new DOMException('User cancelled', 'AbortError')));
        }));
    });
    await page.locator('#btnSetDir').click();
    await expect(page.locator('#format')).toBeDisabled();
    await page.evaluate(() => Reflect.get(window, 'cancelFolderPicker')());
    await expect(page.locator('#format')).toBeEnabled();
    await expect(page.locator('#btnSetDir')).toBeEnabled();
    await expect(page.locator('#dirPermissionLabel')).toHaveText('Not authorized');
    await page.evaluate(() => Reflect.set(window, 'showDirectoryPicker', () => navigator.storage.getDirectory()));
    await page.locator('#btnSetDir').click();
    await expect(page.locator('#dirPermissionLabel')).toHaveText('Authorized');
    await expect(page.locator('#format')).toBeEnabled();
    await page.close();
});


test('connecting in the tour finds the bound Gemini account behind an active unbound tab', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const page = await openOptions(context, extensionId);
    await page.evaluate(accountId => {
        let opened = false;
        Object.defineProperty(chrome.tabs, 'create', { configurable: true, value: async () => { opened = true; } });
        Object.defineProperty(chrome.tabs, 'query', { configurable: true, value: async () => [
            { id: 71, active: true, url: 'https://gemini.google.com/app' },
            { id: 72, active: false, url: 'https://gemini.google.com/app/verified' },
        ] });
        Object.defineProperty(chrome.tabs, 'sendMessage', { configurable: true,
            value: (id: number, _message: unknown, reply: (value: unknown) => void) =>
                reply({ ok: true, accountContext: opened && id === 72 ? { accountId, providerId: 'gemini' } : null }),
        });
    }, accountId);
    await page.locator('#btnTourGuide').click();
    await page.getByRole('heading', { name: 'Authorize AI platforms', exact: true }).waitFor();
    await page.locator('#tourNextBtn').click();
    await expect(page.locator('#btnDetectAccount')).toBeEnabled();
    await expect(page.locator('#tourNextBtn')).toBeDisabled();
    await page.locator('#btnConnectPlatform-gemini').click();
    await expect(page.getByRole('heading', { name: 'Switch platforms and accounts', exact: true })).toBeVisible();
    await expect(page.locator('#accountIdSelect')).toHaveValue(accountId);
});
