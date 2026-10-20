import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { ACCOUNT_UUID } from './helpers/accountRuntime.js';
import { sourceDetail, sourceList } from './helpers/l1SourceFixture.js';
import { GeminiProvider } from '../src/l1/client/gemini/geminiProvider.js';
import { ProviderRegistry } from '../src/l1/client/providerRegistry.js';
import type { GeminiProviderClient } from '../src/l1/client/gemini/geminiContracts.js';
import type { ListParseResult } from '../src/l1/parsers/gemini/rpc/parseList.js';
import { scanAll, type ScanProgress } from '../src/application/sync/scanController.js';
import { ingestIndexes } from '../src/l2/ingestion.js';
import { listIndexes, getCoverage, putExportRecord, getExportRecord } from '../src/l3a/storageService.js';

// Former syncEngine/checkpoint/receipt contracts are replaced by committed L1
// pages, L2 facts, and the current Scan controller. Badge rendering is a UI owner.
async function fixture(run: (env: ReturnType<typeof indexStorage>, provider: (pages: (ListParseResult | Error)[], onRequest?: NonNullable<GeminiProviderClient['getConversationList']>) => GeminiProvider) => Promise<void>) {
    const env = indexStorage(), previous = ProviderRegistry.get('gemini');
    try {
        await ingestIndexes(ACCOUNT_UUID,[
            {conversationId:'offline',fields:{title:'Offline archive',titleSource:'derived'}},
            {conversationId:'old',fields:{title:'Older online',titleSource:'provider',updatedAt:10}},
        ]);
        await putExportRecord({accountId:ACCOUNT_UUID,conversationId:'old'},{exportedAt:100,status:'ok',format:'markdown'});
        const provider = (pages: (ListParseResult | Error)[], onRequest?: NonNullable<GeminiProviderClient['getConversationList']>) => {
            let next = 0;
            const p = new GeminiProvider({getConversationDetail:async()=>sourceDetail(),getConversationList:async(...args)=>{
                if(onRequest) await onRequest(...args);
                const result=pages[next++];
                if(result instanceof Error) throw result;
                if(!result) throw new Error('Unexpected page request');
                return result;
            }},async()=> 'u2');
            ProviderRegistry.unregister('gemini');ProviderRegistry.register(p);return p;
        };
        await run(env,provider);
    } finally {
        ProviderRegistry.unregister('gemini');if(previous)ProviderRegistry.register(previous);env.restore();
    }
}
const limit = (): ListParseResult => ({...sourceList(), failure:'hit_google_limit',pageEvidence:{valid:false,ordered:false,keys:[]}});

test('Scan progress counts only committed pages and source entries',async()=>fixture(async(_env,provider)=>{
    provider([sourceList(['first'],'tC_next'),sourceList(['second'])]);
    const progress: ScanProgress[]=[];
    const result=await scanAll({accountId:ACCOUNT_UUID,forceFull:true},{onProgress:p=>progress.push(p)});
    assert.deepEqual(progress,[{pagesFetched:1,conversationsFetched:1},{pagesFetched:2,conversationsFetched:2}]);
    assert.deepEqual(result,{status:'complete',pagesFetched:2,conversationsFetched:2});
    assert.equal((await listIndexes(ACCOUNT_UUID)).length,4);
}));
test('complete and empty Recent sources preserve unseen local Index and export facts',async()=>fixture(async(_env,provider)=>{
    for(const page of [sourceList(['visible']),sourceList()]){
        provider([page]);assert.equal((await scanAll({accountId:ACCOUNT_UUID,forceFull:true})).status,'complete');
        assert.ok((await listIndexes(ACCOUNT_UUID)).some(i=>i.key.conversationId==='offline'));
        assert.ok(await getExportRecord({accountId:ACCOUNT_UUID,conversationId:'old'}));
    }
}));
test('partial provider limit is an explicit continuation result and preserves observed pages',async()=>fixture(async(_env,provider)=>{
    provider([sourceList(['visible'],'tC_limit'),limit()]);
    const result=await scanAll({accountId:ACCOUNT_UUID,forceFull:true});
    assert.equal(result.status,'partial_limit');assert.equal(result.reason,'provider_limit');
    assert.equal(result.pagesFetched,2);assert.ok((await listIndexes(ACCOUNT_UUID)).some(i=>i.key.conversationId==='visible'));
}));
test('1096 at the initial Recent request is not a confirmed continuation boundary',async()=>fixture(async(_env,provider)=>{
    provider([limit()]);const result=await scanAll({accountId:ACCOUNT_UUID});
    assert.equal(result.status,'error');assert.equal(await getCoverage(ACCOUNT_UUID,'recent'),null);
}));
test('cancellation returns aborted without deleting existing facts or manufacturing Coverage',async()=>fixture(async(_env,provider)=>{
    provider([sourceList(['never'])]);const controller=new AbortController();controller.abort();
    assert.equal((await scanAll({accountId:ACCOUNT_UUID},{signal:controller.signal})).status,'aborted');
    assert.equal((await listIndexes(ACCOUNT_UUID)).length,2);assert.equal(await getCoverage(ACCOUNT_UUID,'recent'),null);
}));
test('malformed pages and cursor loops remain errors without reconciliation',async()=>fixture(async(_env,provider)=>{
    const malformed={...sourceList(),failure:'invalid_response' as const};
    for(const pages of [[malformed],[sourceList(['first'],'tC_loop'),sourceList(['second'],'tC_loop')]]){
        provider(pages);assert.equal((await scanAll({accountId:ACCOUNT_UUID,forceFull:true})).status,'error');
        assert.ok((await listIndexes(ACCOUNT_UUID)).some(i=>i.key.conversationId==='offline'));
    }
}));
test('ordinary request failures cannot manufacture a provider limit or reusable boundary',async()=>fixture(async(_env,provider)=>{
    provider([sourceList(['first'],'tC_next'),new Error('HTTP 500')]);
    assert.equal((await scanAll({accountId:ACCOUNT_UUID,forceFull:true})).status,'error');
    assert.deepEqual(await getCoverage(ACCOUNT_UUID,'recent'),{range:null});
}));
test('Index write failure prevents commit progress; a later scan recovers',async()=>fixture(async(env,provider)=>{
    const progress:ScanProgress[]=[];env.fail('indexes');provider([sourceList(['visible'])]);
    assert.equal((await scanAll({accountId:ACCOUNT_UUID},{onProgress:p=>progress.push(p)})).status,'error');
    assert.deepEqual(progress,[]);env.fail();provider([sourceList(['visible'])]);
    assert.equal((await scanAll({accountId:ACCOUNT_UUID,forceFull:true})).status,'complete');
}));
test('legacy lastSync/checkpoint timestamps cannot authorize early stop',async()=>fixture(async(env,provider)=>{
    env.local.lastSync=Number.MAX_SAFE_INTEGER;env.local.scanCheckpoint=Number.MAX_SAFE_INTEGER;
    provider([sourceList(['head'],'tC_next'),sourceList(['later'])]);
    const result=await scanAll({accountId:ACCOUNT_UUID});assert.equal(result.pagesFetched,2);assert.equal(result.status,'complete');
    assert.ok((await listIndexes(ACCOUNT_UUID)).some(i=>i.key.conversationId==='later'));
}));
test('Recent acquisition uses the verified slot and excludes the Pinned filter',async()=>fixture(async(_env,provider)=>{
    provider([sourceList(['visible'])],async(cursor,slot,filter)=>{
        assert.equal(cursor,null);assert.equal(slot,'u2');assert.equal(filter,undefined);return sourceList();
    });
    assert.equal((await scanAll({accountId:ACCOUNT_UUID})).status,'complete');
    assert.equal(await getCoverage(ACCOUNT_UUID,'pinned'),null);
}));
test('later-page rename persists at the same activity timestamp',async()=>fixture(async(_env,provider)=>{
    const renamed=sourceList(['old']);renamed.conversations[0].title='Renamed elsewhere';renamed.conversations[0].updatedAt=10;
    provider([sourceList(['new'],'tC_next'),renamed]);
    assert.equal((await scanAll({accountId:ACCOUNT_UUID,forceFull:true})).status,'complete');
    const old=(await listIndexes(ACCOUNT_UUID)).find(i=>i.key.conversationId==='old')!;
    assert.equal(old.title,'Renamed elsewhere');assert.equal(old.updatedAt,10);
}));
test('diagnostic strings do not override authoritative business results',async()=>fixture(async(_env,provider)=>{
    const page=sourceList(['visible']);Object.assign(page,{_debug:{error:'BARD_ERROR_INFO',bardError:'quota speculation',textLen:0,rawPreview:'',topParsed:null}});
    provider([page]);assert.equal((await scanAll({accountId:ACCOUNT_UUID})).status,'complete');
}));
test('the current Scan result exposes no legacy completeness/receipt/checkpoint schema',async()=>fixture(async(_env,provider)=>{
    provider([sourceList()]);const result=await scanAll({accountId:ACCOUNT_UUID});
    assert.deepEqual(Object.keys(result).sort(),['conversationsFetched','pagesFetched','status']);
}));
