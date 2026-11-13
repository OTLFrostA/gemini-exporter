import { test, expect } from '@playwright/test';
import { mount, A, B } from '../helpers/uiPortHarness';

const archive = { name: 'Takeout.zip', mimeType: 'application/zip', buffer: Buffer.from('fixture') };

for (const language of ['en', 'zh']) test(`source summaries replace earlier scan limits and show unfiltered account totals (${language})`, async ({ page }) => {
    const imported = ['old', 'new-one', 'new-two'].map(id => ({ key: { accountId: A, conversationId: id }, title: id }));
    await mount(page, 'options', {
        settings: { language, takeoutPromptCompleted: true },
        indexes: [imported[0], { key: { accountId: B, conversationId: 'other-account' }, title: 'Other' }],
        scanResult: { status: 'partial_limit', reason: 'provider_limit', pagesFetched: 16,
            conversationsFetched: 750, indexChanges: { added: 0, updated: 0 } },
        importIndexes: imported, takeoutResult: { imported: 3, added: 2, status: 'ok' },
    });
    await page.locator('#btnSyncAll').click();
    const summary = page.locator('#scanStatus');
    await expect(summary).toHaveText(language === 'zh'
        ? '在线同步部分完成 · 累计扫描 750 条对话 · 新增 0 条 · 更新 0 条信息 · 当前共 1 条对话'
        : 'Sync partially completed · Scanned: 750 · Added: 0 · Updated: 0 · Total conversations: 1');
    await page.locator('#takeoutFileInput').setInputFiles(archive);
    await expect(summary).toHaveText(language === 'zh'
        ? 'Takeout 导入完成 · 读取 3 条对话 · 新增 2 条 · 当前共 3 条对话'
        : 'Takeout import complete · Read: 3 · Added: 2 · Total conversations: 3');
    await expect(page.locator('#status')).toHaveText('');
    await page.locator('#chatSearchInput').fill('new-one');
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(summary).toContainText(language === 'zh' ? '当前共 3 条对话' : 'Total conversations: 3');
    await page.evaluate(() => { Reflect.get(window, 'harness').takeoutResult.added = 0; });
    await page.locator('#takeoutFileInput').setInputFiles(archive);
    await expect(summary).toContainText(language === 'zh' ? '新增 0 条' : 'Added: 0');
    await expect(summary).toContainText(language === 'zh' ? '当前共 3 条对话' : 'Total conversations: 3');
    await page.locator('#accountIdSelect').selectOption(B);
    await expect(summary).toBeHidden();
});

test('OpenAI imports use the same source summary and committed account total', async ({ page }) => {
    await mount(page, 'options', {
        accounts: [{ id: A, providerId: 'chatgpt', providerAccountId: '["user","workspace"]' }],
        importIndexes: [{ key: { accountId: A, conversationId: 'new' }, title: 'New' }],
        openaiResult: { read: 3, imported: 2, added: 1, skipped: 1, missingAssets: 2, status: 'partial' },
    });
    await page.locator('#takeoutFileInput').setInputFiles(archive);
    await expect(page.locator('#scanStatus')).toHaveText('OpenAI ZIP import partially completed · Read: 3 · Added: 1 · Total conversations: 2');
    await expect(page.locator('#status')).toHaveText('Skipped: 1; unavailable attachments: 2.');
});
