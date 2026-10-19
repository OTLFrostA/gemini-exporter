import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, seedConversations, accountId } from './uiFixture';
import { mount, read } from '../helpers/uiPortHarness';
test('old interrupted sessions stay inert after reload and language changes; source titles remain untouched',async({context,extensionId})=>{
    await seedRegistryAccounts(context);const page=await openOptions(context,extensionId);await seedConversations(page,[{id:'one',title:'Takeout Prompt 临时问题',titleSource:'derived'},{id:'two'}]);
    await page.evaluate(()=>chrome.storage.local.set({gemini_last_export_session:{status:'interrupted',total:2,current:1,lastChatId:'one',lastChatTitle:'Must not overwrite source title'}}));
    await page.reload();await expect(page.locator('#list .item')).toHaveCount(2);await expect(page.locator('#exportSessionBanner,#btnResumeExport,#btnDismissExportBanner')).toHaveCount(0);await expect(page.locator('#list input:checked')).toHaveCount(0);
    await page.locator('#language').selectOption('zh');await expect(page.locator('[data-chat-id="one"]')).toContainText('Takeout Prompt 临时问题');await expect(page.locator('#btnExport')).toBeDisabled();
    await page.locator('#language').selectOption('en');await expect(page.locator('[data-chat-id="one"]')).toContainText('Takeout Prompt 临时问题');
    // Direct IDB inspection is through current Storage, with no v1 globals or aliases.
    const {exposeUIStorage}=await import('./uiFixture');await exposeUIStorage(page);
    const index=await page.evaluate(id=>Reflect.get(globalThis,'uiFixture').getIndex({accountId:id,conversationId:'one'}),accountId);expect(index.title).toBe('Takeout Prompt 临时问题');expect(index.titleSource).toBe('derived');
});
test('active export locks scan, settings and selection through cancellation and releases only when the task returns',async({page})=>{
    // Delay only the Application port; all workbench handlers and rendering execute.
    await mount(page,'options',{holdExport:true});await page.locator('#btnSelectAll').click();await page.locator('#btnExport').click();
    for(const id of ['btnSyncAll','btnExport','format','accountIdSelect'])await expect(page.locator(`#${id}`)).toBeDisabled();await expect(page.locator('#list input')).toBeDisabled();await expect(page.locator('#exportSessionBanner')).toHaveCount(0);
    await page.locator('#list span').click({force:true});await expect(page.locator('#list input')).toBeChecked();await page.locator('#btnCancel').click();await expect(page.locator('#btnSyncAll')).toBeDisabled();
    await page.evaluate(()=>Reflect.get(window,'harness').finishExport());await expect(page.locator('#btnSyncAll')).toBeEnabled();await expect(page.locator('#list input')).toBeEnabled();await expect(page.locator('#status')).toContainText('cancelled');expect((await read(page,'exports')).length).toBe(1);
});
