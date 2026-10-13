import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import { saveDomainConversation, getStoredDomain, storageIdentity, getDomainResource, __clearDomainMemory } from '../src/core/storage/domain/domainStore.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';

test('large provider-neutral graphs preserve complete/partial/unknown coverage and real resource bytes', async () => {
    for (const status of ['complete', 'partial', 'unknown'] as const) {
        const builder: DomainConversationDetail = { providerId: 'future-provider', id: `large-${status}`, title: 'Independent large graph', timestamp: null,
            completeness: { status }, assets: [{ id: 'bytes', kind: 'file', source: { uri: 'opaque:original' } }],
            messages: Array.from({ length: 1000 }, (_, index) => ({ id: `message-${index}`, role: 'unknown', provenance: { rawRole: 'future-role' },
                content: [{ type: 'unknown', sourceType: 'future-block', text: `Preserved ${index}` }], attachmentIds: ['bytes'] })) };
        const trusted = validateParserDomain(builder);
        assert.equal(restoreDomainSnapshot(trusted).messages.length, 1000);
        __clearDomainMemory();
        const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
        await saveDomainConversation('opaque-account', { conversation: trusted, resourceHints: {}, acquisitionHints: {}, diagnostics: [] }, [{ assetId: 'bytes', bytes }]);
        bytes[0] = 99;
        const read = await getStoredDomain(storageIdentity('future-provider', 'opaque-account', builder.id));
        assert.ok(read); const recoveredBytes = await getDomainResource(read.identity, 'bytes');
        assert.ok(recoveredBytes); assert.deepEqual([...recoveredBytes], [0, 1, 2, 253, 254, 255]);
        assert.equal(read.conversation.completeness?.status, status);
        assert.equal(read.conversation.messages[999].content[0].type, 'unknown');
        assert.equal(Object.getOwnPropertySymbols(read.conversation).length, 0);
    }
    __clearDomainMemory();
});

test('count actual Schema passes and Closure calls separately at every trust boundary', async () => {
    const bundle = await build({ write: false, bundle: true, platform: 'node', format: 'iife', globalName: 'trustCounts', logLevel: 'silent',
        stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
            import {schemaPasses} from './src/core/domain/runtimeValidation.ts'; import {closurePasses} from './src/core/domain/closure.ts';
            import {parseGeminiDomConversation} from './src/core/parsers/gemini/dom/parseConversation.ts';
            import {parseGeminiTakeoutArchive,parseGeminiTakeoutArchiveAsync} from './src/core/parsers/gemini/takeout/parseConversation.ts';
            import {parseGeminiRpcConversation} from './src/core/parsers/gemini/rpc/parseConversation.ts';
            import {parseConversation} from './src/core/parsers/parseConversation.ts';
            import {parseLegacyStorageConversation} from './src/core/parsers/legacyStorage/parseConversation.ts';
            import {mergeConversationPages} from './src/core/parsers/gemini/rpc/mergePages.ts';
            import {saveDomainConversation,getStoredDomain,storedParseResult,storageIdentity,__clearDomainMemory} from './src/core/storage/domain/domainStore.ts';
            import {encodeDomainRecord,decodeDomainRecord} from './src/core/storage/domain/transport.ts';
            import {requestNativeDetail,requestNativeBatch} from './src/core/utils/nativeDetailTransport.ts';
            import {composeDomainDocument} from './src/core/document/compose/composeDomainDocument.ts';
            import {formatContent,formatHtmlDocument,formatMarkdownDocument} from './src/core/engine/chatFormatter.ts';
            import {preparePdfItem,pdfDomainSelection} from './src/core/export/pdf/prepareItem.ts';
            export async function run(){
                __clearDomainMemory();const rows={};
                async function measure(name,work){const before=[schemaPasses(),closurePasses()];const result=await work();rows[name]=[schemaPasses()-before[0],closurePasses()-before[1]];return result;}
                await measure('DOM',()=>parseGeminiDomConversation({id:'dom',document:{title:'Independent',querySelectorAll:()=>[],querySelector:()=>null}},{providerId:'gemini'}));
                const activity=id=>'<div class="outer-cell"><a href="https://gemini.google.com/app/'+id+'">Chat</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Independent '+id+'<br>2026-09-02T12:00:00Z<br><p>Answer '+id+'</p></div></div>';
                const raw={htmlText:activity('first_case')+activity('second_case')};
                const takeout=await measure('TakeoutSyncTwo',()=>parseGeminiTakeoutArchive(raw,{providerId:'gemini'}));
                await measure('TakeoutAsyncTwo',()=>parseGeminiTakeoutArchiveAsync(raw,{providerId:'gemini'}));
                const wire=JSON.stringify([['wrb.fr','hNvQHb',JSON.stringify([[[['c_test','r_turn'],[1700000000,0],[['Question']],[[['rc_answer',[['Answer']]]]]]]])]]);
                const rpc=await measure('RPC',()=>parseGeminiRpcConversation(wire,{providerId:'gemini'}));
                await measure('Dispatcher',()=>parseConversation({format:'gemini-rpc',providerId:'gemini',data:wire}));
                await measure('Merge',()=>mergeConversationPages([rpc,rpc]));
                await measure('Legacy',()=>parseLegacyStorageConversation({metadata:{id:'legacy',messageCount:2}},{providerId:'gemini'}));
                if(takeout.length!==2)throw Error('Independent two-conversation fixture was not parsed');
                await measure('WriteSnapshot',()=>saveDomainConversation('u0',takeout[0]));
                const record=await measure('ReadSnapshot',()=>getStoredDomain(storageIdentity('gemini','u0',takeout[0].conversation.id)));
                const parsed=await measure('AdaptRecord',()=>storedParseResult(record));
                await measure('AuthenticatedTransport',async()=>{decodeDomainRecord(encodeDomainRecord(record));await requestNativeDetail(async()=>({success:true,domainEnvelopeVersion:1,data:parsed}));await requestNativeBatch(async()=>({success:true,domainEnvelopeVersion:1,results:[parsed]}));});
                await measure('PureExport',async()=>{composeDomainDocument(parsed.conversation);formatContent(parsed,'json');formatContent(parsed,'json_openai');await formatHtmlDocument(parsed);await formatMarkdownDocument(parsed);const pdf=await preparePdfItem(pdfDomainSelection(parsed.conversation),{includeAssets:false});if(!pdf.ok)throw Error(pdf.error);});
                return rows;
            }` }, plugins: [{ name: 'test-only-actual-schema-closure-counters', setup(builder) {
                builder.onLoad({ filter: /runtimeValidation\.ts$/ }, args => ({ loader: 'ts', contents: readFileSync(args.path, 'utf8').replace(
                    'function assertSchema(value: unknown): asserts value is DomainConversationDetail {',
                    'let schemas=0; export const schemaPasses=()=>schemas; function assertSchema(value: unknown): asserts value is DomainConversationDetail { schemas++;') }));
                builder.onLoad({ filter: /domain\/closure\.ts$/ }, args => ({ loader: 'ts', contents: readFileSync(args.path, 'utf8').replace(
                    'export function assertDomainClosure(conversation: DomainConversationDetail): void {',
                    'let closures=0; export const closurePasses=()=>closures; export function assertDomainClosure(conversation: DomainConversationDetail): void { closures++;') }));
            } }] });
    const api: { run: () => Promise<Record<string, number[]>> } = new Function('module', 'require', bundle.outputFiles[0].text + ';return trustCounts;')(undefined, createRequire(process.cwd() + '/package.json'));
    assert.deepEqual(await api.run(), { DOM: [1,1], TakeoutSyncTwo: [2,2], TakeoutAsyncTwo: [2,2], RPC: [1,1], Dispatcher: [1,1], Merge: [1,1], Legacy: [1,1],
        WriteSnapshot: [2,1], ReadSnapshot: [2,1], AdaptRecord: [0,0], AuthenticatedTransport: [0,0], PureExport: [0,0] });
});
