import { test, expect, seedRegistryAccounts } from './fixtures';
import { readFile } from 'node:fs/promises';
import { openOptions, seedConversations, openPopup, storedSettings } from './uiFixture';
test.beforeEach(async({context,extensionId})=>{void extensionId;await seedRegistryAccounts(context);});
test('Popup renders current bilingual labels and four format controls with durable v2 Settings',async({context,extensionId})=>{
    const options=await openOptions(context,extensionId);await seedConversations(options,[{id:'a',title:'Current title'}]);const page=await openPopup(context,extensionId);
    await expect(page.locator('#currentChatTitle')).toHaveText('Current title');await expect(page.locator('[data-format]')).toHaveCount(4);
    await expect(page.locator('#btnCurrent')).toHaveText('📥 Export Current Page');await expect(page.locator('#btnOptions')).toBeVisible();
    await options.locator('#langToggle').uncheck();await expect(page.locator('#btnCurrent')).toHaveText('📥 导出当前页面');
    await options.locator('#langToggle').check();await expect(page.locator('#btnCurrent')).toHaveText('📥 Export Current Page');
    await page.locator('[data-format="json"]').click();await expect(page.locator('[data-format="json"]')).toHaveAttribute('aria-pressed','true');await expect.poll(async()=> (await storedSettings(page)).defaultFormat).toBe('json');
    for(const enabled of [true,false]) {await options.locator('#devToggle').setChecked(enabled);await expect(page.locator('[data-format]')).toHaveCount(4);await expect(page.locator('[data-format="json_raw"],[data-format="json_openai"]')).toHaveCount(0);}
    await expect(page.locator('#chatSlotBadge,#historyTotalSynced,#btnCopyMarkdown,#btnScreenshot,#previewModal')).toHaveCount(0);
});
test('Popup and Options synchronize format in both directions and consume the same language setting',async({context,extensionId})=>{
    const options=await openOptions(context,extensionId);const popup=await openPopup(context,extensionId);
    await popup.locator('[data-format="json"]').click();await expect(options.locator('#format')).toHaveValue('json');
    await options.locator('#format').selectOption('html');await expect(popup.locator('[data-format="html"]')).toHaveAttribute('aria-pressed','true');
    await options.locator('#langToggle').uncheck();await expect(popup.locator('#btnCurrent')).toHaveText('📥 导出当前页面');
    await popup.reload();await expect(popup.locator('[data-format="html"]')).toHaveAttribute('aria-pressed','true');await expect(popup.locator('#btnCurrent')).toHaveText('📥 导出当前页面');
});
test('Popup rejects malformed current context without download and allows retry after a transport failure',async({context,extensionId})=>{
    const options=await openOptions(context,extensionId);await seedConversations(options,[{id:'a'}]);const popup=await openPopup(context,extensionId);await expect(popup.locator('#btnCurrent')).toBeEnabled();
    await popup.evaluate(()=>{Object.defineProperty(chrome.tabs,'sendMessage',{configurable:true,value:()=>{throw new Error('Injected context failure');}});});
    let downloads=0;popup.on('download',()=>{downloads++;});await popup.locator('#btnCurrent').click();await expect(popup.locator('#status')).toHaveText('Injected context failure');await expect(popup.locator('#btnCurrent')).toBeEnabled();expect(downloads).toBe(0);
    await popup.reload();const pending=popup.waitForEvent('download');await popup.locator('#btnCurrent').click();const file=await pending;expect(await readFile((await file.path())!,'utf8')).toContain('Answer a');
    await popup.evaluate(()=>{Object.defineProperty(chrome.tabs,'sendMessage',{configurable:true,value:(_id:number,_m:unknown,cb:(v:unknown)=>void)=>cb({ok:'true'})});});
    await popup.locator('#btnCurrent').click();await expect(popup.locator('#status')).toHaveText('No trusted current conversation');await expect(popup.locator('#btnCurrent')).toBeDisabled();expect(downloads).toBe(1);
});
for(const format of ['html','markdown','json'] as const)test(`Popup ${format} physical export preserves the committed body without transport or planned resource fields`,async({context,extensionId})=>{
    const options=await openOptions(context,extensionId);await seedConversations(options,[{id:'a',body:'Body survives',missingAsset:true}]);const popup=await openPopup(context,extensionId);await popup.locator(`[data-format="${format}"]`).click();
    const pending=popup.waitForEvent('download');await popup.locator('#btnCurrent').click();const file=await pending;const body=await readFile((await file.path())!,'utf8');expect(body).toContain('Body survives');expect(body).not.toContain('assets/never-delivered.png');
    if(format==='json'){const archive=JSON.parse(body);expect(archive.transport).toBeUndefined();expect(archive.resources).toEqual({});expect(archive.version).toBe(1);expect(archive.conversation.detail.assets[0].id).toBe('image');}else{expect(body).toMatch(/unavailable|gem-missing-asset/);}
    await expect(popup.locator('#btnCurrent')).toBeEnabled();await expect(popup.locator('#status')).toHaveText('Download initiated; some content is missing');
});
