import { test, expect } from '@playwright/test';
import { A, mount, read } from '../helpers/uiPortHarness';

test('100 failed conversations collapse into one group, copy the reason once, and retry only failures', async ({ page }) => {
    const indexes = Array.from({ length: 101 }, (_, i) => ({
        key: { accountId: A, conversationId: `chat-${i}` }, title: `Conversation ${i}`, updatedAt: 5,
    }));
    await mount(page, 'options', { indexes, failExport: true, partial: true });
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { writeText: async (value: string) => { Reflect.set(window, 'copiedFailures', value); } } }));
    await page.locator('#btnSelectAll').click();
    await page.locator('#btnExport').click();
    await page.locator('#btnModalContinueZip').click();
    await expect(page.locator('#exportFailureTitle')).toHaveText('100 conversations failed · Error groups: 1');
    const groups = page.locator('#exportFailureList > details');
    await expect(groups).toHaveCount(1);
    await expect(groups.locator('summary')).toHaveText('100 conversations · same reported error');
    await expect(groups).not.toHaveAttribute('open');
    await groups.locator('summary').click();
    await expect(groups).toContainText('Injected export failure');
    await expect(groups).toContainText('Conversation 100 (chat-100)');
    await expect(groups).not.toContainText('Conversation 0 (chat-0)');
    await page.locator('#btnCopyFailedLog').click();
    const copied = await page.evaluate(() => Reflect.get(window, 'copiedFailures'));
    expect(copied.split('Injected export failure').length - 1).toBe(1);
    expect(copied).toContain(`${A}/chat-100`);
    await page.locator('#langToggle').uncheck();
    await expect(page.locator('#exportFailureTitle')).toHaveText('100 条会话导出失败 · 1 组错误');
    await page.locator('#btnRetryFailed').click();
    const retry = (await read(page, 'exports'))[1];
    expect(retry.keys).toHaveLength(100);
    expect(retry.keys).not.toContainEqual(indexes[0].key);
    expect(retry.skipUnchanged).toBe(false);
});

test('error messages and conversation titles are rendered as text', async ({ page }) => {
    const message = '<img src=x onerror=alert(1)>';
    await mount(page, 'options', { failExport: true, exportError: message });
    await page.locator('#btnSelectAll').click();
    await page.locator('#btnExport').click();
    const group = page.locator('#exportFailureList > details');
    await expect(group).toHaveCount(1);
    await group.locator('summary').click();
    await expect(group).toContainText(message);
    await expect(group).toContainText(`${message} (a)`);
    await expect(page.locator('#exportFailureList img')).toHaveCount(0);
    await expect(page.locator('#list img')).toHaveCount(0);
});
