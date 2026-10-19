import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, seedConversations } from './uiFixture';
test.beforeEach(async({context,extensionId})=>{void extensionId;await seedRegistryAccounts(context);});
test('workbench list preserves explicit selection across row clicks, search and language changes',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);
    await seedConversations(page,[{id:'chat_001',title:'量子计算的基本原理'},{id:'chat_002',title:'AI 架构与设计模式'},{id:'chat_003',title:'Python 性能优化指南'}],{chat_001:{exportedAt:200,format:'markdown',status:'ok',chatTime:100}});
    await expect(page.locator('#list input:checked')).toHaveCount(0);
    await page.locator('#btnSelectAll').click();await expect(page.locator('#list input:checked')).toHaveCount(3);await expect(page.locator('#selectedStat')).toHaveText('3 selected');
    await page.locator('#btnSelectNone').click();await expect(page.locator('#list input:checked')).toHaveCount(0);
    const row=page.locator('[data-chat-id="chat_002"]');await row.locator('span').click();await expect(row.locator('input')).toBeChecked();await row.locator('span').click();await expect(row.locator('input')).not.toBeChecked();
    await page.locator('#chatSearchInput').fill('量子');await expect(page.locator('#list .item')).toHaveCount(1);await page.locator('#btnSelectAll').click();await expect(page.locator('#selectedStat')).toHaveText('1 selected');
    await page.locator('#chatSearchInput').fill('');await expect(page.locator('#list .item')).toHaveCount(3);
    for(const language of ['zh','en']) {await page.locator('#language').selectOption(language);await expect(page.locator('#btnSelectAll')).toHaveText(language==='zh'?'全选可见项':'Select visible');await expect(page.locator('[data-chat-id="chat_001"] input')).toBeChecked();}
    await expect(page.locator('#feedbackBox')).toHaveAttribute('href','https://tally.so/r/Y56ZBB');await expect(page.locator('#feedbackBox')).toHaveAttribute('target','_blank');await expect(page.locator('#feedbackBox')).toHaveText('Feedback');
    await expect(page.locator('#btnSelectUpdated,#btnSelectUnexported,#btnFeedback')).toHaveCount(0);
});
test('new activity and partial export records display facts without automatic selection or UI skip authority',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);
    await seedConversations(page,[{id:'fresh'},{id:'exported'},{id:'updated',updatedAt:300},{id:'partial'},{id:'partial_updated',updatedAt:300},{id:'failed'},{id:'empty'}],{
        exported:{exportedAt:200,format:'markdown',status:'ok',chatTime:100},updated:{exportedAt:200,format:'html',status:'ok',chatTime:100},partial:{exportedAt:200,format:'markdown',status:'partial',chatTime:100},partial_updated:{exportedAt:200,format:'json',status:'partial',chatTime:100}
    });
    for(const id of ['fresh','failed','empty'])await expect(page.locator(`[data-chat-id="${id}"] small`)).toContainText('No export record');
    await expect(page.locator('[data-chat-id="updated"] small')).toContainText('Last export · html');await expect(page.locator('[data-chat-id="partial"] small')).toContainText('Partial export');
    await expect(page.locator('#list input:checked')).toHaveCount(0);await expect(page.locator('.badge-updated,.badge-exported')).toHaveCount(0);
    await page.locator('[data-chat-id="partial"] input').check();await page.locator('#language').selectOption('zh');await expect(page.locator('[data-chat-id="partial"] input')).toBeChecked();await expect(page.locator('[data-chat-id="partial"] small')).toContainText('部分导出');
    await page.reload();await expect(page.locator('#list .item')).toHaveCount(7);await expect(page.locator('#list input:checked')).toHaveCount(0);
});
