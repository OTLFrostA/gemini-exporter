import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { mount, read, A } from './helpers/uiPortHarness.js';
import { verifyDirPermission } from '../src/runtime/capabilities/dirHandleController.js';
let browser:Browser,page:Page;
test.before(async()=>{browser=await chromium.launch({headless:true});});test.afterEach(async()=>{await page?.close();});test.after(async()=>{await browser?.close();});
async function open(kind:'popup'|'options'='options',patch:Record<string,unknown>={}){page=await browser.newPage();await mount(page,kind,patch);}
test('P1-118: dynamic IDs and title updates stay literal and cannot escape into DOM selectors or markup',async()=>{
    const id='chat:with[brackets]';await open('options',{indexes:[{key:{accountId:A,conversationId:id},title:'<img src=x onerror=alert(1)>'}]});await page.locator('#list input').check();await page.locator('#btnExport').click();await page.waitForFunction(()=>document.body.dataset.busy!=='true');
    assert.equal(await page.locator('#list img').count(),0);assert.equal((await read(page,'exports'))[0].keys[0].conversationId,id);
});
test('P1-119: checking folder permission never requests it without user activation',async()=>{
    let requested=false;const handle={name:'folder',queryPermission:async()=> 'prompt' as const,requestPermission:async()=>{requested=true;return 'granted' as const;}};
    assert.equal(await verifyDirPermission(handle as unknown as NonNullable<Parameters<typeof verifyDirPermission>[0]>),false);assert.equal(requested,false);
});
test('P1-120: File input resets after success and failure so the same archive can be selected again',async()=>{
    for(const failImport of [false,true]){
        await open('options',{failImport});for(let i=0;i<2;i++) {await page.locator('#takeoutFileInput').setInputFiles({name:'original.zip',mimeType:'application/zip',buffer:Buffer.from('fixture')});await page.waitForFunction(()=>document.body.dataset.busy!=='true');assert.equal(await page.locator('#takeoutFileInput').inputValue(),'');assert.equal((await read(page,'imports')).length,i+1);}
        assert.match(await page.locator('#status').textContent()??'',failImport?/Invalid ZIP/:/Imported 2/);await page.close();
    }
});
test('P1-121: failed focus refresh reports its original error in the workbench status',async()=>{
    await open();await page.locator('#list input').waitFor();await page.evaluate(()=>{Reflect.get(window,'harness').failRead=true;window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>document.getElementById('status')?.textContent==='Injected load failure');
    assert.equal(await page.locator('#btnSyncAll').isEnabled(),true);
});
test('P1-122: both UI entry points report readiness failures without unhandled startup rejections',async()=>{
    for(const kind of ['options','popup'] as const){await open(kind,{failReady:true});await page.waitForFunction(()=>document.getElementById('status')?.textContent==='Injected readiness failure');assert.equal(await page.locator(kind==='popup'?'#btnCurrent':'#btnExport').isDisabled(),true);await page.close();}
});
test('P1-123: current Settings language changes refresh Popup labels and keep current format',async()=>{
    await open('popup');await page.locator('#btnCurrent').waitFor();await page.evaluate(()=>{const h=Reflect.get(window,'harness');h.settings.language='zh';h.settings.defaultFormat='html';h.fireSettingsChange();});await page.waitForFunction(()=>document.getElementById('btnCurrent')?.textContent==='导出当前对话');assert.equal(await page.locator('[data-format="html"]').getAttribute('aria-pressed'),'true');
});
test('P1-121/123: processing feedback and terminal results render in both languages',async()=>{
    for(const language of ['en','zh']){await open('options',{holdExport:true,settings:{language}});await page.locator('#btnSelectAll').click();await page.locator('#btnExport').click();assert.match(await page.locator('#status').textContent()??'',language==='en'?/Processing 1\/1/:/正在处理 1\/1/);await page.evaluate(()=>Reflect.get(window,'harness').finishExport());await page.waitForFunction(()=>document.body.dataset.busy!=='true');assert.match(await page.locator('#status').textContent()??'',language==='en'?/Delivery initiated/:/已发起交付/);await page.close();}
});
test('direct-write: the explicitly chosen delivery reaches Application once without a competing prompt decision',async()=>{
    await open('options',{directoryName:'exports'});await page.locator('#delivery').selectOption('folderWriter');await page.locator('#btnSelectAll').click();await page.locator('#btnExport').click();await page.waitForFunction(()=>document.body.dataset.busy!=='true');const requests=await read(page,'exports');assert.equal(requests.length,1);assert.equal(requests[0].delivery,'folderWriter');assert.equal(await page.locator('#directWriteModal').count(),0);
});
