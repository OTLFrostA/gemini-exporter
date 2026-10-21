import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, seedConversations, accountId } from './uiFixture';
test.beforeEach(async({context,extensionId})=>{void extensionId;await seedRegistryAccounts(context);});
test('repeated list refresh does not resurrect a verified deletion or display a removed archive-state notice',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);await seedConversations(page,[{id:'deleted_notice'},{id:'keep'}]);await page.evaluate(async id=>Reflect.get(globalThis,'uiFixture').ingestDeletedConversation(id,'deleted_notice'),accountId);
    for(let i=0;i<5;i++){await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('#list .item')).toHaveCount(1);await expect(page.locator('[data-chat-id="deleted_notice"],#archiveNotice')).toHaveCount(0);}
});
test('record cleanup requires confirmation and retains all bodies; a subsequent verified deletion removes only that conversation',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);await seedConversations(page,[{id:'one'},{id:'unlisted'},{id:'another'}],{one:{exportedAt:100,format:'markdown',status:'ok'}});
    await expect(page.locator('#btnClearExported')).toBeHidden();
    await page.locator('#devToggle').check();
    await expect(page.locator('#btnClearExported')).toBeVisible();
    page.once('dialog',dialog=>dialog.dismiss());await page.locator('#btnClearExported').click();expect(Object.keys(await page.evaluate(id=>Reflect.get(globalThis,'uiFixture').listExportRecords(id),accountId))).toEqual(['one']);
    page.once('dialog',dialog=>dialog.accept());await page.locator('#btnClearExported').click();await expect(page.locator('#status')).toHaveText('Records cleared');await expect(page.locator('#list .item')).toHaveCount(3);expect(await page.evaluate(id=>Reflect.get(globalThis,'uiFixture').listExportRecords(id),accountId)).toEqual({});
    await page.evaluate(async id=>Reflect.get(globalThis,'uiFixture').ingestDeletedConversation(id,'another'),accountId);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('#list .item')).toHaveCount(2);expect(await page.evaluate(id=>Reflect.get(globalThis,'uiFixture').readConversation({accountId:id,conversationId:'unlisted'}),accountId)).toBeTruthy();
});
test('absence from a source list alone keeps local conversations and never manufactures deletion state',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);await seedConversations(page,[{id:'unlisted_notice'},{id:'active'}]);await page.evaluate(async id=>Reflect.get(globalThis,'uiFixture').ingestIndexes(id,[{conversationId:'active',fields:{title:'Latest title',titleSource:'provider'}}]),accountId);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#list .item')).toHaveCount(2);await expect(page.locator('#archiveNotice,.cloud-status')).toHaveCount(0);await expect(page.locator('[data-chat-id="active"]')).toContainText('Latest title');
});
