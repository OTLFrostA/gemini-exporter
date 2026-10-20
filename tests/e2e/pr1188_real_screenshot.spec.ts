import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, seedConversations, exposeUIStorage } from './uiFixture';

// Temporary diagnostic: capture the actual bundled extension running in Chromium.
// Remove after retrieving the screenshots.
test('PR 1188 real-extension sidebar screenshots', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const page = await openOptions(context, extensionId);
    await page.setViewportSize({ width: 1340, height: 900 });
    await seedConversations(page, [
        { id: 'preview_a', title: 'Project Planning and Research', updatedAt: 300 },
        { id: 'preview_b', title: 'Generated Images and Notes', updatedAt: 200 },
        { id: 'preview_c', title: 'Travel Itinerary', updatedAt: 100 },
    ]);
    await page.evaluate(async () => {
        await Reflect.get(globalThis, 'uiFixture').updateSettings({
            theme: 'dark', language: 'zh', exportDelivery: 'browserDownload',
            defaultFormat: 'markdown', enabledDisk: false, lastSeenFeatureVersion: '999.0.0',
        });
    });
    await page.reload();
    await exposeUIStorage(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
    await expect(page.locator('#btnSetDir')).toBeDisabled();
    await expect(page.locator('#liveSaveDiskToggle')).toBeDisabled();

    async function capture(name: string, full: boolean) {
        const image = full
            ? await page.screenshot({ type: 'jpeg', quality: 78, animations: 'disabled' })
            : await page.locator('.card-left').screenshot({ type: 'jpeg', quality: 86, animations: 'disabled' });
        const base64 = image.toString('base64');
        const n = Math.ceil(base64.length / 3500);
        console.log('GEXSHOT|BEGIN|' + name + '|' + n + '|' + base64.length);
        for (let i = 0; i < n; i++) {
            console.log('GEXSHOT|CHUNK|' + name + '|' + i + '|' + base64.slice(i * 3500, (i + 1) * 3500));
        }
        console.log('GEXSHOT|END|' + name);
    }

    await capture('dark-browser-full', true);
    await capture('dark-browser-left', false);

    await page.locator('input[name="delivery"][value="folderWriter"]').check();
    await expect(page.locator('#btnSetDir')).toBeEnabled();
    await page.evaluate(() => {
        Reflect.set(window, 'showDirectoryPicker', async () => navigator.storage.getDirectory());
    });
    await page.locator('#btnSetDir').click();
    await expect(page.locator('#dirPermissionLabel')).toHaveText('已授权');
    await expect(page.locator('#liveSaveDiskToggle')).toBeEnabled();
    await page.locator('#liveSaveDiskToggle').check();
    await expect(page.locator('#liveSaveStatus')).toContainText('已开启');
    await page.locator('#btnThemeToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await capture('light-folder-full', true);
    await capture('light-folder-left', false);
});
