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
        ? '已读取到 750 条会话记录，新增 0 条，一共 1 条。已达到在线接口上限，更早的历史可以通过 Takeout 导入。'
        : 'Read 750 conversation records, added 0, total 1. The online API limit has been reached. Import earlier history with Takeout.');
    await page.locator('#takeoutFileInput').setInputFiles(archive);
    await expect(summary).toBeHidden();
    const importedSummary = page.locator('#status');
    await expect(importedSummary).toHaveText(language === 'zh'
        ? '已读取到 3 条会话记录，新增 2 条，一共 3 条'
        : 'Read 3 conversation records, added 2, total 3');
    await page.locator('#chatSearchInput').fill('new-one');
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(importedSummary).toContainText(language === 'zh' ? '一共 3 条' : 'total 3');
    await page.evaluate(() => { Reflect.get(window, 'harness').takeoutResult.added = 0; });
    await page.locator('#takeoutFileInput').setInputFiles(archive);
    await expect(importedSummary).toContainText(language === 'zh' ? '新增 0 条' : 'added 0');
    await expect(importedSummary).toContainText(language === 'zh' ? '一共 3 条' : 'total 3');
    await page.locator('#accountIdSelect').selectOption(B);
    await expect(summary).toBeHidden();
    await expect(importedSummary).toHaveText('');
});

test('OpenAI imports use the same source summary and committed account total', async ({ page }) => {
    await mount(page, 'options', {
        accounts: [{ id: A, providerId: 'chatgpt', providerAccountId: '["user","workspace"]' }],
        importIndexes: [{ key: { accountId: A, conversationId: 'new' }, title: 'New' }],
        openaiResult: { read: 3, imported: 2, added: 1, skipped: 1, missingAssets: 2, status: 'partial' },
    });
    await page.locator('#takeoutFileInput').setInputFiles(archive);
    await expect(page.locator('#scanStatus')).toBeHidden();
    await expect(page.locator('#status')).toHaveText('Read 3 conversation records, added 1, total 2. Skipped 1; unavailable attachments 2.');
});
