import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, seedConversations, accountId } from './uiFixture';
import { mount, read } from '../helpers/uiPortHarness';
test('old interrupted sessions stay inert after reload and language changes; source titles remain untouched',async({context,extensionId})=>{
    await seedRegistryAccounts(context);const page=await openOptions(context,extensionId);await seedConversations(page,[{id:'one',title:'Takeout Prompt 临时问题',titleSource:'derived'},{id:'two'}]);
    await page.evaluate(()=>chrome.storage.local.set({gemini_last_export_session:{status:'interrupted',total:2,current:1,lastChatId:'one',lastChatTitle:'Must not overwrite source title'}}));
    await page.reload();await expect(page.locator('#list .item')).toHaveCount(2);await expect(page.locator('#exportSessionBanner,#btnResumeExport,#btnDismissExportBanner')).toHaveCount(0);await expect(page.locator('#list input:checked')).toHaveCount(0);
    await page.locator('#langToggle').uncheck();
    await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');
    await expect(page.locator('[data-chat-id="one"]')).toContainText('Takeout Prompt 临时问题');
    await expect(page.locator('#btnExport')).toBeDisabled();
    await page.locator('#langToggle').check();
    await expect(page.locator('html')).toHaveAttribute('lang','en');
    await expect(page.locator('[data-chat-id="one"]')).toContainText('Takeout Prompt 临时问题');
    // Direct IDB inspection is through current Storage, with no v1 globals or aliases.
    const {exposeUIStorage}=await import('./uiFixture');await exposeUIStorage(page);
    const index=await page.evaluate(id=>Reflect.get(globalThis,'uiFixture').getIndex({accountId:id,conversationId:'one'}),accountId);expect(index.title).toBe('Takeout Prompt 临时问题');expect(index.titleSource).toBe('derived');
});
test('active export locks scan, settings and selection through cancellation and releases only when the task returns',async({page})=>{
    // Delay only the Application port; all workbench handlers and rendering execute.
    await mount(page,'options',{holdExport:true});await page.locator('#btnSelectAll').click();await page.locator('#btnExport').click();
    for(const id of ['btnSyncAll','btnExport','format','accountIdSelect','skipExported','includeAssets','liveSaveDiskToggle','btnSetDir','langToggle','btnTourGuide'])await expect(page.locator(`#${id}`)).toBeDisabled();await expect(page.locator('#list input')).toBeDisabled();await expect(page.locator('#exportSessionBanner')).toHaveCount(0);
    await expect(page.locator('input[name="delivery"]:enabled')).toHaveCount(0);
    await expect(page.locator('#exportOptionsLock')).toBeVisible();
    const beforeSettings = await read(page,'settings');
    const beforePatches = await read(page,'patches');
    await page.evaluate(() => {
        for (const [id,value] of [['format','pdf'],['skipExported',false],['includeAssets',false],['langToggle',false]]) {
            const input = document.getElementById(String(id)) as HTMLInputElement;
            if (typeof value === 'boolean') input.checked = value; else input.value = value;
            input.dispatchEvent(new Event('change',{bubbles:true}));
        }
        const radio = document.querySelector<HTMLInputElement>('input[value="folderWriter"]')!;
        radio.checked = true; radio.dispatchEvent(new Event('change',{bubbles:true}));
    });
    expect(await read(page,'settings')).toEqual(beforeSettings);
    expect(await read(page,'patches')).toEqual(beforePatches);
    await expect(page.locator('#format')).toHaveValue(beforeSettings.defaultFormat);
    await expect(page.locator('input[value="browserDownload"]')).toBeChecked();
    await page.locator('#list span').click({force:true});await expect(page.locator('#list input')).toBeChecked();await page.locator('#btnCancel').click();await expect(page.locator('#btnSyncAll')).toBeDisabled();
    await expect(page.locator('#exportOptionsLock')).toBeVisible();
    await page.evaluate(()=>Reflect.get(window,'harness').finishExport());await expect(page.locator('#btnSyncAll')).toBeEnabled();await expect(page.locator('#list input')).toBeEnabled();await expect(page.locator('#status')).toContainText('cancelled');expect((await read(page,'exports')).length).toBe(1);
    await expect(page.locator('#exportOptionsLock')).toBeHidden();
    await expect(page.locator('#format')).toBeEnabled();
    await expect(page.locator('#btnTourGuide')).toBeEnabled();
});
