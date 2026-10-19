import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { sendTypedMessage, isMessageAction, getErrorMessage } from '../src/core/utils/messaging.js';
import { sendToGeminiTab, sendToAITab, checkGeminiStatus, openGeminiPage, reloadGeminiTab } from '../src/core/utils/tabService.js';
import { startSync } from '../src/ui/controllers/syncController.js';
import type { ScanResult } from '../src/core/application/sync/scanController.js';
import type { BaseMessage } from '../src/types/messages.js';
import { indexStorage } from './helpers/indexStorage.js';
import { putAccount } from '../src/core/storage/storageService.js';
import { mount, read } from './helpers/uiPortHarness.js';
type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
type Assert<T extends true> = T;
export type Contracts = [
    Assert<Equal<Awaited<ReturnType<typeof sendTypedMessage>>,unknown>>,
    Assert<Equal<Awaited<ReturnType<typeof sendToGeminiTab>>,unknown>>,
    Assert<Equal<Awaited<ReturnType<typeof sendToAITab>>,unknown>>,
    Assert<Equal<Parameters<typeof sendToGeminiTab>[0],unknown>>,
    Assert<Equal<typeof sendTypedMessage extends <T extends BaseMessage,R>(message:T,timeout?:number)=>Promise<R>?true:false,false>>,
    Assert<Equal<Awaited<ReturnType<typeof startSync>>,ScanResult>>,
    Assert<Equal<Awaited<ReturnType<typeof openGeminiPage>>,unknown>>,
    Assert<Equal<Awaited<ReturnType<typeof reloadGeminiTab>>,unknown>>
];
function actionOnly(input: unknown) {
    if (isMessageAction(input,'runLiveSave')) {
        const narrow: Assert<Equal<typeof input,{action:'runLiveSave'}>> = true;
        const notPayload: Assert<Equal<typeof input extends {action:'runLiveSave';key:{accountId:string;conversationId:string}}?true:false,false>> = true;
        void narrow; void notPayload;
    }
}
void actionOnly;
function replaceGlobal(key:string,value:unknown) {
    const previous=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,value});
    return ()=>{if(previous)Object.defineProperty(globalThis,key,previous);else Reflect.deleteProperty(globalThis,key);};
}
test('transport replies stay opaque; action guards never prove payload shape',async()=>{
    const reply={arbitrary:['not a known response']};
    const restore=replaceGlobal('chrome',{runtime:{sendMessage(_m:unknown,cb:(v:unknown)=>void){cb(reply);}}});
    try{assert.equal(await sendTypedMessage({action:'ping'},100),reply);}finally{restore();}
    assert.equal(isMessageAction({action:'runLiveSave'},'runLiveSave'),true);
    assert.equal(isMessageAction({},'runLiveSave'),false); assert.equal(getErrorMessage({message:123}),'[object Object]');
});
test('current Popup consumer rejects malformed context and legacy rich fetch envelopes before exporting',async()=>{
    const browser=await chromium.launch({headless:true});try{
        for(const contextReply of [null,[],{}, {ok:'true'}, {ok:true}, {ok:true,accountContext:{accountId:123}},
            {ok:true,accountContext:{accountId:'10000000-0000-4000-8000-000000000001',providerId:'other'},conversationId:'a'},
            {success:true,data:{conversation:{detail:{messages:[]}}}}]) {
            const page=await browser.newPage();await mount(page,'popup',{contextReply});
            await page.waitForFunction(()=>document.getElementById('status')?.textContent==='Open a supported conversation first');
            assert.equal(await page.locator('#btnCurrent').isDisabled(),true);assert.deepEqual(await read(page,'exports'),[]);await page.close();
        }
    }finally{await browser.close();}
});
test('Scan consumer uses typed local results and preserves committed diagnostics without runtime callback envelopes',async()=>{
    const accountId='10000000-0000-4000-8000-000000000001';
    for(const status of ['complete','up_to_date','partial_limit','aborted','error'] as const){
        const result:ScanResult={status,pagesFetched:2,conversationsFetched:3,reason:'remaining pages unavailable'};
        const seen:unknown[]=[]; const signal=new AbortController().signal;
        const actual=await startSync(accountId,{signal,onTarget:async id=>{seen.push(id);},onProgress:p=>seen.push(p)},{
            resolveScanTarget:async()=>accountId,scanAll:async(request,options)=>{
                assert.deepEqual(request,{accountId});assert.strictEqual(options?.signal,signal);
                options?.onProgress?.({pagesFetched:2,conversationsFetched:3});return result;
            }
        });assert.strictEqual(actual,result);assert.deepEqual(seen,[accountId,{pagesFetched:2,conversationsFetched:3}]);
    }
});
test('connection status requires an actual verified account binding, never a ping-only acknowledgement',async()=>{
    const env=indexStorage();const accountId='10000000-0000-4000-8000-000000000001';
    try {
        await putAccount({id:accountId,providerId:'gemini',providerAccountId:'10000000001'});
        for(const reply of [{ok:'true'},{ok:1},[],null,{ok:true,version:'test'}, {ok:true,accountContext:{accountId,providerId:'gemini'}}]) {
            Object.defineProperty(chrome,'tabs',{configurable:true,value:{query:async()=>[{id:1,active:true,url:'https://gemini.google.com/app'}],sendMessage(_id:number,_m:unknown,cb:(v:unknown)=>void){cb(reply);}}});
            assert.equal((await checkGeminiStatus(accountId)).status,reply&&'accountContext' in reply?'CONNECTED':'ERROR');
        }
    }finally{env.restore();}
});
test('Scan UI preserves saved counts for partial limits, cancellation and errors without announcing completion',async()=>{
    const browser=await chromium.launch({headless:true});try{
        for(const status of ['partial_limit','aborted','error']){
            const page=await browser.newPage();await mount(page,'options',{scanCount:3,scanResult:{status,pagesFetched:2,conversationsFetched:3,reason:'remaining pages unavailable'}});
            await page.locator('#btnSyncAll').click();await page.waitForFunction(()=>document.body.dataset.busy!=='true');
            const text=await page.locator('#status').textContent()??'';
            assert.doesNotMatch(text,/Full sync completed|全量拉取完成/);assert.match(text,/3/);
            assert.equal(await page.locator('#btnSyncAll').isEnabled(),true);await page.close();
        }
    }finally{await browser.close();}
});
