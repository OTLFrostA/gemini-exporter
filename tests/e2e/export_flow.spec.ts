import { test, expect, seedRegistryAccounts } from './fixtures';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { accountId, openOptions, seedConversations, storedSettings } from './uiFixture';
test.beforeEach(async({context,extensionId})=>{void extensionId;await seedRegistryAccounts(context);});
test('batch export delivers both physical bodies and refreshes recent ExportRecords',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);await seedConversations(page,[{id:'one'},{id:'two'}]);await page.locator('#btnSelectAll').click();
    const pending=page.waitForEvent('download');await page.locator('#btnExport').click();const file=await pending;expect(file.suggestedFilename()).toMatch(/\.zip$/);
    const JSZip=require(path.resolve(__dirname,'../../lib/jszip.min.js'));const zip=await JSZip.loadAsync(await readFile((await file.path())!));const files=Object.keys(zip.files).filter(x=>x.endsWith('.md'));expect(files).toHaveLength(2);
    const bodies=await Promise.all(files.map(x=>zip.file(x).async('string')));expect(bodies.join('\n')).toContain('Answer one');expect(bodies.join('\n')).toContain('Answer two');
    await expect(page.locator('#status')).toContainText('Delivery initiated: 2');await expect(page.locator('#list small')).toHaveText([/Last export/,/Last export/]);
    const records=await page.evaluate(id=>Reflect.get(globalThis,'uiFixture').listExportRecords(id),accountId);expect(Object.keys(records).sort()).toEqual(['one','two']);expect(records.one.status).toBe('ok');
});
test('unchanged exports skip through Application without producing an empty ZIP',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);await seedConversations(page,[{id:'unchanged'}],{unchanged:{exportedAt:200,chatTime:100,format:'markdown',status:'ok'}});
    await page.locator('#btnSelectAll').click();let downloads=0;page.on('download',()=>{downloads++;});await page.locator('#btnExport').click();await expect(page.locator('#status')).toContainText('skipped: 1');await expect(page.locator('body')).toHaveAttribute('data-busy','false');expect(downloads).toBe(0);
});
test('clearing export records preserves bodies and skip preference, then explicit selection can export again',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);await seedConversations(page,[{id:'one'}],{one:{exportedAt:200,chatTime:100,format:'markdown',status:'ok'}});
    await expect(page.locator('#btnClearExported')).toBeHidden();
    await page.locator('#devToggle').check();
    await expect(page.locator('#btnClearExported')).toBeVisible();
    const before=await storedSettings(page);page.on('dialog',dialog=>{void dialog.accept();});await page.locator('#btnClearExported').click();await expect(page.locator('#status')).toHaveText('Records cleared');
    expect(await page.evaluate(id=>Reflect.get(globalThis,'uiFixture').listExportRecords(id),accountId)).toEqual({});expect((await storedSettings(page)).skipExported).toBe(before.skipExported);
    expect(await page.evaluate(id=>Reflect.get(globalThis,'uiFixture').readConversation({accountId:id,conversationId:'one'}),accountId)).toBeTruthy();
    await page.locator('#btnSelectAll').click();const pending=page.waitForEvent('download');await page.locator('#btnExport').click();expect(await readFile((await(await pending).path())!,'utf8')).toContain('Answer one');
});
