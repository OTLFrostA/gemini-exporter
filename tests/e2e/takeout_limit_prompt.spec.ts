import { test, expect } from '@playwright/test';
import { mount, read, A, B } from '../helpers/uiPortHarness';
// Exercise actual workbench/Tour handlers; only Application scan/import ports are mocked.
// Source RPC integration remains covered by scan_flow.spec.ts.
test('Takeout suggestion uses the current history explanation and persists acknowledgement once',async({page})=>{
    await mount(page,'options',{scanCount:620});await page.locator('#btnSyncAll').click();await expect(page.locator('.tour-popover')).toContainText('Supplement Your History with Google Takeout');await expect(page.locator('.tour-popover')).toContainText('history accessible through the Gemini website may be limited');
    await page.getByRole('button',{name:'Got it, don’t show again',exact:true}).click();await expect(page.locator('.tour-popover')).toHaveCount(0);expect(await read(page,'patches')).toContainEqual({takeoutPromptCompleted:true});
    await page.locator('#btnSyncAll').click();await expect(page.locator('body')).toHaveAttribute('data-busy','false');await expect(page.locator('.tour-popover')).toHaveCount(0);
});
test('suggestion Import action reaches the current File input and dismisses the overlay',async({page})=>{
    await mount(page,'options',{scanCount:650});await page.locator('#btnSyncAll').click();await expect(page.locator('.tour-popover')).toBeVisible();
    const chooser=page.waitForEvent('filechooser');await page.locator('.tour-popover').getByRole('button',{name:'Import Takeout ZIP',exact:true}).click();expect((await chooser).isMultiple()).toBe(false);await expect(page.locator('.tour-popover')).toHaveCount(0);
});
test('automatic suggestion is strictly above 150 committed entries; small provider-limited scans stay visible without prompting',async({page})=>{
    await mount(page,'options',{scanCount:150,scanResult:{status:'partial_limit',reason:'provider_limit',pagesFetched:2,conversationsFetched:150}});await page.locator('#btnSyncAll').click();await expect(page.locator('#scanStatus')).toHaveText('Read 150 conversation records, added 0, total 1. The online API limit has been reached. Import earlier history with Takeout.');await expect(page.locator('.tour-popover')).toHaveCount(0);
    await page.evaluate(()=>{const h=Reflect.get(window,'harness');h.scanCount=151;h.scanResult.conversationsFetched=151;});await page.locator('#btnSyncAll').click();await expect(page.locator('.tour-popover')).toBeVisible();await page.getByRole('button',{name:'×',exact:true}).click();await expect(page.locator('.tour-popover')).toHaveCount(0);
});
test('a successful current File import suppresses later eligible prompts without transient Index import flags',async({page})=>{
    await mount(page,'options',{scanCount:620});await page.locator('#takeoutFileInput').setInputFiles({name:'Takeout.zip',mimeType:'application/zip',buffer:Buffer.from('fixture')});await expect(page.locator('#status')).toHaveText('Read 2 conversation records, added 0, total 1. Some content or attachments are incomplete.');
    expect(await read(page,'patches')).toContainEqual({takeoutPromptCompleted:true});await page.locator('#btnSyncAll').click();await expect(page.locator('body')).toHaveAttribute('data-busy','false');await expect(page.locator('.tour-popover')).toHaveCount(0);expect(await read(page,'imports')).toHaveLength(1);
});

test('provider-limit Takeout link reopens acknowledged guidance from status and logs in both languages', async ({ page }) => {
    for (const language of ['en', 'zh']) {
        await mount(page, 'options', { settings: { language, takeoutPromptCompleted: true },
            scanResult: { status: 'partial_limit', reason: 'provider_limit', pagesFetched: 16, conversationsFetched: 750 } });
        await page.locator('#btnSyncAll').click();
        await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
        await expect(page.locator('.tour-popover')).toHaveCount(0);
        await page.locator('#scanStatus').getByRole('link', { name: 'Takeout', exact: true }).click();
        await expect(page.locator('#tourTakeoutGoWebBtn')).toBeVisible();
        await expect(page.locator('#tourTakeoutImportBtn')).toBeVisible();
        await page.locator('#tourTakeoutDismissBtn').click();
        // Hidden diagnostic entries still retain their explicit Takeout action.
        await page.locator('#log a[href="#takeout"]').evaluate(link => (link as HTMLAnchorElement).click());
        await expect(page.locator('#tourTakeoutGoWebBtn')).toBeVisible();
        await page.locator('#tourTakeoutDismissBtn').click();
    }
});

test('Takeout summary counts new local identities and repeated imports add zero', async ({ page }) => {
    await mount(page, 'options', { holdImport: true });
    const file = { name: 'Takeout.zip', mimeType: 'application/zip', buffer: Buffer.from('fixture') };
    await page.locator('#takeoutFileInput').setInputFiles(file);
    await page.waitForFunction(() => typeof Reflect.get(window, 'harness').finishImport === 'function');
    await page.evaluate(() => {
        const h = Reflect.get(window, 'harness');
        h.indexes.push({ key: { accountId: h.accounts[0].id, conversationId: 'new-import' }, title: 'New import' });
        h.takeoutResult = { imported: 2, added: 1, status: 'partial' };
        h.finishImport();
    });
    await expect(page.locator('#status')).toHaveText('Read 2 conversation records, added 1, total 2. Some content or attachments are incomplete.');
    await page.evaluate(() => { const h = Reflect.get(window, 'harness'); h.holdImport = false; h.takeoutResult.added = 0; });
    await page.locator('#takeoutFileInput').setInputFiles(file);
    await expect(page.locator('#status')).toHaveText('Read 2 conversation records, added 0, total 2. Some content or attachments are incomplete.');
});

const summaryArchive = { name: 'Takeout.zip', mimeType: 'application/zip', buffer: Buffer.from('fixture') };

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
    await page.locator('#takeoutFileInput').setInputFiles(summaryArchive);
    await expect(summary).toBeHidden();
    const importedSummary = page.locator('#status');
    await expect(importedSummary).toHaveText(language === 'zh'
        ? '已读取到 3 条会话记录，新增 2 条，一共 3 条'
        : 'Read 3 conversation records, added 2, total 3');
    await page.locator('#chatSearchInput').fill('new-one');
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(importedSummary).toContainText(language === 'zh' ? '一共 3 条' : 'total 3');
    await page.evaluate(() => { Reflect.get(window, 'harness').takeoutResult.added = 0; });
    await page.locator('#takeoutFileInput').setInputFiles(summaryArchive);
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
    await page.locator('#takeoutFileInput').setInputFiles(summaryArchive);
    await expect(page.locator('#scanStatus')).toBeHidden();
    await expect(page.locator('#status')).toHaveText('Read 3 conversation records, added 1, total 2. Skipped 1; unavailable attachments 2.');
});
