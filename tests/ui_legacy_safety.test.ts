import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { mount, read, A } from './helpers/uiPortHarness.js';
let browser:Browser,page:Page;
test.before(async()=>{browser=await chromium.launch({headless:true});});test.afterEach(async()=>{await page?.close();});test.after(async()=>{await browser?.close();});
async function open(patch:Record<string,unknown>={},kind:'options'|'popup'='options'){page=await browser.newPage();await mount(page,kind,patch);}
// Relocated intact scenarios from mixed module suites; every scenario below
// executes actual current UI handlers with IO mocked at the owner boundary.
test('export completion warns for attachment-only and mixed failures in both languages; a complete export still reports success',async()=>{
    for(const language of ['en','zh'])for(const [partial,failExport]of [[true,false],[true,true],[false,false]]){
        const indexes=partial && failExport ? [
            {key:{accountId:A,conversationId:'partial'},title:'Partial chat'},
            {key:{accountId:A,conversationId:'failed'},title:'Failed chat'}
        ] : undefined;
        await open({ ...(indexes ? { indexes } : {}), partial, failExport, settings: { language } });await page.locator('#btnSelectAll').click();await page.locator('#btnExport').click();await page.waitForFunction(()=>document.body.dataset.busy!=='true');
        const status=await page.locator('#status').textContent()??'';assert.match(status,language==='en'?new RegExp(`Skipped: 0; Conversation export failed: ${failExport?1:0}`):new RegExp(`跳过 0; 会话导出失败 ${failExport?1:0}`));if(partial)assert.match(status,language==='en'?/Other incomplete conversations: 1/:/其他内容不完整 1 条/);assert.equal(await page.locator('#btnRetryFailed').isVisible(),failExport);await page.close();
    }
});
test('sync UI never announces completion for partial_limit, aborted or error, and keeps committed counters',async()=>{
    for(const status of ['partial_limit','aborted','error','complete','up_to_date']){
        await open({holdScan:true,scanCount:3,scanResult:{status,pagesFetched:2,conversationsFetched:3}});await page.locator('#btnSyncAll').click();assert.equal(await page.locator('#status').textContent(),'Committed 2 pages, 3 source entries');await page.evaluate(()=>Reflect.get(window,'harness').finishScan());await page.waitForFunction(()=>document.body.dataset.busy!=='true');
        const final=await page.locator('#status').textContent()??'';assert.match(final,/2 \/ 3/);if(['partial_limit','aborted','error'].includes(status))assert.doesNotMatch(final,/Reached the end|Connected to trusted/);else assert.match(final,/Reached the end|Connected to trusted/);assert.equal(await page.locator('#btnSyncAll').isEnabled(),true);await page.close();
    }
});
test('scan progress shows a long-history reminder only above 200 entries and clears it afterward',async()=>{
    for(const language of ['en','zh'])for(const scanCount of [200,201]){
        await open({settings:{language,takeoutPromptCompleted:true},holdScan:true,scanCount});
        await page.locator('#btnSyncAll').click();
        const hint=page.locator('#scanSlowHint');
        assert.equal(await hint.isVisible(),scanCount>200);
        if(scanCount>200)assert.match(await hint.textContent()??'',language==='en'?/Gemini scans may take significantly longer/:/随着对话历史增加/);
        assert.equal(await page.locator('#progText').isVisible(),true);
        assert.equal(await page.locator('#status').isVisible(),false);
        await page.evaluate(()=>Reflect.get(window,'harness').finishScan());
        await page.waitForFunction(()=>document.body.dataset.busy!=='true');
        assert.equal(await hint.isVisible(),false);
        await page.close();
    }
});
test('export UI lock lasts until refresh settles, including refresh rejection',async()=>{
    for(const failRefresh of [false,true]){
        await open({holdRefresh:true,failRefresh});await page.locator('#btnSelectAll').click();await page.locator('#btnExport').click();await page.waitForFunction(()=>typeof Reflect.get(window,'harness').finishRefresh==='function');
        assert.equal(await page.locator('#btnExport').isDisabled(),true);assert.equal(await page.locator('#btnSyncAll').isDisabled(),true);await page.locator('#btnExport').dispatchEvent('click');assert.equal((await read(page,'exports')).length,1);
        await page.evaluate(()=>Reflect.get(window,'harness').finishRefresh());await page.waitForFunction(()=>document.body.dataset.busy!=='true');assert.equal(await page.locator('#btnExport').isEnabled(),true);if(failRefresh)assert.equal(await page.locator('#status').textContent(),'Refresh rejected');await page.close();
    }
});
test('P1-021: export startup rejection releases UI running state for a later invocation',async()=>{
    await open({throwExport:true});await page.locator('#btnSelectAll').click();await page.locator('#btnExport').click();await page.waitForFunction(()=>document.getElementById('status')?.textContent==='Injected export failure');assert.equal(await page.locator('#btnSyncAll').isEnabled(),true);await page.evaluate(()=>{Reflect.get(window,'harness').throwExport=false;});await page.locator('#btnExport').click();await page.waitForFunction(()=>document.body.dataset.busy!=='true');assert.equal((await read(page,'exports')).length,2);assert.match(await page.locator('#status').textContent()??'',/Delivery initiated: 1/);
});
test('list UI blocks javascript and data URLs from source fields',async()=>{
    await open({indexes:['javascript:alert(1)','data:text/html,<script>alert(1)</script>','https://gemini.google.com/app/safe'].map((url,i)=>({key:{accountId:A,conversationId:`safe_${i}`},title:'Safe title',url}))});await page.locator('#list .item').first().waitFor();assert.equal(await page.locator('#list script').count(),0);assert.equal(await page.locator('#list .item').count(),3);assert.deepEqual(await page.locator('#list a').evaluateAll(items=>items.map(item=>(item as HTMLAnchorElement).origin)),['https://gemini.google.com','https://gemini.google.com','https://gemini.google.com']);
});
test('list UI prevents attribute breakout from source titles and URLs',async()=>{
    await open({indexes:[{key:{accountId:A,conversationId:'test_xss'},title:'\" onclick=\"alert(1)',url:'https://gemini.google.com/app/test\" onclick=\"alert(1)'}]});await page.locator('#list .item').waitFor();assert.equal(await page.locator('#list [onclick]').count(), 0, 'source must not inject handler attributes');
    const link = page.locator('#list a.open-link');
    assert.equal(await link.count(), 1, 'v2 intentionally offers a canonical conversation link');
    assert.equal(await link.getAttribute('href'), 'https://gemini.google.com/app/test_xss',
        'untrusted source URL cannot change the fixed-origin destination');
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');assert.equal(await page.locator('#list span').textContent(),'\" onclick=\"alert(1)');
});
test('D7: Tour connection errors and absent Tabs API never advance to a connected state',async()=>{
    for(const missing of [false,true]){
        await open();await page.evaluate(missing=>{if(missing)Reflect.deleteProperty(chrome,'tabs');else Reflect.set(chrome.tabs,'query',()=>Promise.reject(new Error('Tabs unavailable')));return Reflect.get(window,'testUi').tour.startTour();},missing);
        await page.waitForFunction(()=>document.querySelector('.tour-popover')?.textContent?.includes('Connection unavailable'));assert.equal(await page.locator('.tour-popover h2').textContent(),'Connect an AI platform');await page.close();
    }
});
test('Takeout guidance is neutral and independent of source-vs-local scan limit',async()=>{
    for(const language of ['en','zh'])for(const reason of ['provider_limit','max_pages']){
        await open({settings:{language},scanCount:620,scanResult:{status:'partial_limit',reason,pagesFetched:2,conversationsFetched:620}});
        await page.locator('#btnSyncAll').click();
        await page.waitForFunction(()=>document.body.dataset.busy!=='true');
        const status=await page.locator('#status').textContent()??'';
        assert.match(status,reason==='provider_limit'?(language==='en'?/Source online access limit/:/来源在线访问范围限制/):(language==='en'?/Local page budget reached/:/本地页数预算/));
        assert.equal(await page.locator('.tour-popover').count(),1);
        const prompt=await page.locator('.tour-popover').textContent()??'';
        assert.match(prompt,language==='en'?/This scan fetched 620 conversations/:/本次扫描获取了 620 条对话/);
        assert.doesNotMatch(prompt,/Reached Google Cloud History Limit|Gemini confirmed an online history access limit|达到 Google 云端拉取上限/);
        await page.locator('.tour-popover').getByRole('button',{name:language==='en'?'Got it, don’t show again':'我知道了，不再提示'}).click();
        assert.equal(await page.locator('.tour-popover').count(),0);
        await page.close();
    }
});
