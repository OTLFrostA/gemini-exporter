import { test, expect, seedRegistryAccounts } from './fixtures';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Download } from '@playwright/test';
import { openOptions, seedConversations, openPopup, storedSettings } from './uiFixture';
test.beforeEach(async({context,extensionId})=>{void extensionId;await seedRegistryAccounts(context);});
test('Popup renders current bilingual labels and five format controls with durable v2 Settings',async({context,extensionId})=>{
    const options=await openOptions(context,extensionId);await seedConversations(options,[{id:'a',title:'Current title'}]);const page=await openPopup(context,extensionId);
    await expect(page.locator('#currentChatTitle')).toHaveText('Current title');await expect(page.locator('[data-format]')).toHaveCount(5);
    await expect(page.locator('#btnCurrent')).toHaveText('📥 Export Current Conversation');await expect(page.locator('#btnOptions')).toBeVisible();
    await options.locator('#langToggle').uncheck();await expect(page.locator('#btnCurrent')).toHaveText('📥 导出当前对话');
    await options.locator('#langToggle').check();await expect(page.locator('#btnCurrent')).toHaveText('📥 Export Current Conversation');
    await page.locator('[data-format="json"]').click();await expect(page.locator('[data-format="json"]')).toHaveAttribute('aria-pressed','true');await expect.poll(async()=> (await storedSettings(page)).defaultFormat).toBe('json');
    for(const enabled of [true,false]) {await options.locator('#devToggle').setChecked(enabled);await expect(page.locator('[data-format]')).toHaveCount(5);await expect(page.locator('[data-format="json_raw"],[data-format="json_openai"]')).toHaveCount(0);}
    await expect(page.locator('#chatSlotBadge,#historyTotalSynced,#btnCopyMarkdown,#btnScreenshot,#previewModal')).toHaveCount(0);
});
test('Popup and Options synchronize format in both directions and consume the same language setting',async({context,extensionId})=>{
    const options=await openOptions(context,extensionId);const popup=await openPopup(context,extensionId);
    await popup.locator('[data-format="json"]').click();await expect(options.locator('#format')).toHaveValue('json');
    await options.locator('#format').selectOption('html');await expect(popup.locator('[data-format="html"]')).toHaveAttribute('aria-pressed','true');
    await options.locator('#langToggle').uncheck();await expect(popup.locator('#btnCurrent')).toHaveText('📥 导出当前对话');
    await popup.reload();await expect(popup.locator('[data-format="html"]')).toHaveAttribute('aria-pressed','true');await expect(popup.locator('#btnCurrent')).toHaveText('📥 导出当前对话');
});
test('Popup DOCX export downloads a Word archive locally', async ({ context, extensionId }) => {
    const options = await openOptions(context, extensionId);
    await seedConversations(options, [{ id: 'a', body: 'A Word export in Chromium' }]);
    const popup = await openPopup(context, extensionId);
    await popup.locator('[data-format="docx"]').click();
    const pending = popup.waitForEvent('download');
    await popup.locator('#btnCurrent').click();
    const file = await pending;
    expect(file.suggestedFilename()).toMatch(/\.docx$/);
    const bytes = await readFile((await file.path())!);
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await expect(popup.locator('#status')).toHaveText('Download initiated');
});

test('Popup rejects malformed current context without download and allows retry after a transport failure',async({context,extensionId})=>{
    const options=await openOptions(context,extensionId);await seedConversations(options,[{id:'a'}]);const popup=await openPopup(context,extensionId);await expect(popup.locator('#btnCurrent')).toBeEnabled();
    await popup.evaluate(()=>{Object.defineProperty(chrome.tabs,'sendMessage',{configurable:true,value:()=>{throw new Error('Injected context failure');}});});
    let downloads=0;popup.on('download',()=>{downloads++;});await popup.locator('#btnCurrent').click();await expect(popup.locator('#status')).toHaveText('Operation failed. Please retry; details are available in the logs or diagnostic report.');await expect(popup.locator('#btnCurrent')).toBeEnabled();expect(downloads).toBe(0);
    await popup.reload();const pending=popup.waitForEvent('download');await popup.locator('#btnCurrent').click();const file=await pending;expect(await readFile((await file.path())!,'utf8')).toContain('Answer a');
    await popup.evaluate(()=>{Object.defineProperty(chrome.tabs,'sendMessage',{configurable:true,value:(_id:number,_m:unknown,cb:(v:unknown)=>void)=>cb({ok:'true'})});});
    await popup.locator('#btnCurrent').click();await expect(popup.locator('#status')).toHaveText('No trusted current conversation');await expect(popup.locator('#btnCurrent')).toBeDisabled();expect(downloads).toBe(1);
});
for(const format of ['html','markdown','json'] as const)test(`Popup ${format} physical export delivers one package with its corrected body and failure report`,async({context,extensionId})=>{
    const options=await openOptions(context,extensionId);await seedConversations(options,[{id:'a',body:'Body survives',missingAsset:true}]);
    await options.evaluate(async()=>Reflect.get(globalThis,'uiFixture').updateSettings({includeAssets:true}));
    const popup=await openPopup(context,extensionId);await popup.locator(`[data-format="${format}"]`).click();
    const downloads: Download[]=[];popup.on('download',file=>downloads.push(file));await popup.locator('#btnCurrent').click();
    await expect.poll(()=>downloads.length).toBe(1);await expect(popup.locator('#btnCurrent')).toBeEnabled();
    const file=downloads[0];
    const JSZip=require(path.resolve(__dirname,'../../lib/jszip.min.js'));const zip=await JSZip.loadAsync(await readFile((await file.path())!));
    const documentPath=Object.keys(zip.files).find(name=>name.endsWith(format==='markdown'?'.md':'.'+format));expect(documentPath).toBeTruthy();
    const corrected=await zip.file(documentPath).async('string');expect(corrected).toContain('Body survives');
    const report=Object.keys(zip.files).find(name=>name.endsWith('/report.json'));expect(report).toBeTruthy();
    const failures=JSON.parse(await zip.file(report).async('string')).failures;expect(failures).toHaveLength(1);
    expect(failures[0].code).toBe('RESOURCE_LOCATOR_UNAVAILABLE');expect(failures[0].httpStatus).toBeUndefined();
    if(format==='json'){
        const archive=JSON.parse(corrected);expect(archive.transport).toBeUndefined();expect(archive.resources).toEqual({});expect(archive.version).toBe(1);expect(archive.conversation.detail.assets[0].id).toBe('image');
    }else{expect(corrected).toContain('Attachment download location unavailable');expect(corrected).not.toContain('Unknown error');}
    await expect(popup.locator('#btnCurrent')).toBeEnabled();
    await expect(popup.locator('#status')).toContainText('Successfully downloaded: 1');
    await expect(popup.locator('#status')).not.toContainText('Attachment');
    await expect(popup.locator('#status')).not.toContainText('Download location unavailable');
    await options.locator('#devToggle').check();
    await expect(popup.locator('#status')).toContainText(/Download location unavailable: 1 attachment(?:;|$)/);
    await expect(popup.locator('#status')).not.toContainText('unknown cause');
    await expect(popup.locator('#status')).not.toContainText('Conversation export failed:');
    await options.locator('#devToggle').uncheck();
    await expect(popup.locator('#status')).not.toContainText('Attachment');
    await expect(popup.locator('#status')).not.toContainText('Download location unavailable');
});

test('Popup discovers active Gemini conversation through real content script IPC without stubbing sendMessage', async ({ context, extensionId }) => {
    const convId = 'real-tab-popup-conv';
    const options = await openOptions(context, extensionId);
    await seedConversations(options, [{ id: convId, title: 'Live Tab Conversation', body: 'Real tab content script answer' }]);

    await context.route('https://gemini.google.com/**', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: `<!doctype html><html><head><title>Live Tab Conversation - Google Gemini</title><script>window.WIZ_global_data={qDCSke:"10000000001",SNlM0e:"test",cfb2h:"build"};</script></head><body><h1>Gemini Chat</h1></body></html>`,
        });
    });

    const geminiTab = await context.newPage();
    await geminiTab.goto(`https://gemini.google.com/app/${convId}`);
    await expect(geminiTab.locator('#geminiExportBadge')).toBeVisible();
    await expect.poll(async () => {
        return options.evaluate(async (targetUrl) => {
            const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
            const tab = tabs.find(t => t.url === targetUrl);
            if (!tab?.id) return null;
            return new Promise<unknown>(resolve => {
                chrome.tabs.sendMessage(tab.id!, { action: 'getAccountContext' }, reply => {
                    if (chrome.runtime.lastError) { resolve(null); return; }
                    resolve(reply ?? null);
                });
            });
        }, `https://gemini.google.com/app/${convId}`);
    }, { timeout: 10000 }).toMatchObject({
        ok: true,
        conversationId: convId,
        accountContext: { providerId: 'gemini' },
    });

    // Open Popup with ONLY chrome.tabs.query pointing to the real Gemini tab; chrome.tabs.sendMessage is 100% real!
    const realTabId = await options.evaluate(async (targetUrl) => {
        const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
        return tabs.find(t => t.url === targetUrl)?.id ?? -1;
    }, `https://gemini.google.com/app/${convId}`);
    expect(realTabId).toBeGreaterThanOrEqual(0);

    const popup = await context.newPage();
    await popup.addInitScript(({ tabId, url }) => {
        Object.defineProperty(chrome.tabs, 'query', {
            configurable: true,
            value: async () => [{ id: tabId, active: true, url }],
        });
    }, { tabId: realTabId, url: `https://gemini.google.com/app/${convId}` });
    await popup.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);

    await expect(popup.locator('#currentChatTitle')).toHaveText('Live Tab Conversation');
    const downloadPromise = popup.waitForEvent('download');
    await popup.locator('#btnCurrent').click();
    const download = await downloadPromise;
    const text = await readFile((await download.path())!, 'utf8');
    expect(text).toContain('Real tab content script answer');
    await geminiTab.close();
});
