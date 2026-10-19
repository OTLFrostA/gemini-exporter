import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, seedConversations } from './uiFixture';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
test('55-conversation browser delivery automatically packages ZIP without a second prompt or persisted suppression preference',async({context,extensionId})=>{
    await seedRegistryAccounts(context);const page=await openOptions(context,extensionId);await seedConversations(page,Array.from({length:55},(_,i)=>({id:`bulk_${i}`,title:`Bulk ${i}`,body:`Bulk answer ${i}`})));
    await page.locator('#btnSelectAll').click();const pending=page.waitForEvent('download');await page.locator('#btnExport').click();const file=await pending;expect(file.suggestedFilename()).toMatch(/\.zip$/);
    const JSZip=require(path.resolve(__dirname,'../../lib/jszip.min.js'));const zip=await JSZip.loadAsync(await readFile((await file.path())!));const files=Object.keys(zip.files).filter(x=>x.endsWith('.md'));expect(files).toHaveLength(55);expect((await Promise.all(files.map(x=>zip.file(x).async('string')))).join('\n')).toContain('Bulk answer 54');
    await expect(page.locator('#directWriteModal')).toHaveCount(0);expect(await page.evaluate(()=>chrome.storage.local.get('gemini_suppress_direct_write_prompt'))).toEqual({});
    await page.reload();await expect(page.locator('#list .item')).toHaveCount(55);await page.locator('#btnSelectAll').click();await page.locator('#btnExport').click();await expect(page.locator('#status')).toContainText('skipped: 55');await expect(page.locator('#directWriteModal')).toHaveCount(0);
});
