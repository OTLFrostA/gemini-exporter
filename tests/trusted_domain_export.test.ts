import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { preparePdfItem, pdfDomainSelection } from '../src/core/export/pdf/prepareItem.js';
import { formatHtmlDocument } from '../src/core/engine/chatFormatter.js';

function rawIsNotExportable(raw: DomainConversationDetail): void {
    // @ts-expect-error Builders must establish trust at their source.
    formatHtmlDocument(raw);
    // @ts-expect-error The PDF adapter accepts only an established trusted graph.
    pdfDomainSelection(raw);
    const misleading = { id: 'raw', conversation: raw };
    // @ts-expect-error Extra conversation fields cannot slip through the metadata branch.
    preparePdfItem(misleading);
}
void rawIsNotExportable;

test('PDF metadata cannot impersonate Domain; explicit trusted adapter preserves messages', async () => {
    const raw: DomainConversationDetail = { providerId: 'independent', id: 'pdf-source', title: 'Title', timestamp: null,
        messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Independent body' }] }] }], assets: [] };
    // @ts-expect-error Raw Domain is neither request metadata nor a trusted result.
    const rejected = await preparePdfItem(raw, { includeAssets: false });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.error, /PDF_NO_MESSAGES/);
    const selected = pdfDomainSelection(validateParserDomain(raw));
    const prepared = await preparePdfItem(selected, { includeAssets: false });
    assert.equal(prepared.ok, true);
    if (prepared.ok) assert.equal(prepared.document.messages.length, 1);
});

test('pure Composer, projection and all export preparations add zero Domain validations', async () => {
    const bundle = await build({ write: false, bundle: true, platform: 'node', format: 'iife', globalName: 'instrumentedExport', logLevel: 'silent',
        stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
            import {validateParserDomain,countDomainSchemas} from './src/core/domain/runtimeValidation.ts';
            import {composeDomainDocument} from './src/core/document/compose/composeDomainDocument.ts';
            import {projectDomainRecord} from './src/core/compatibility/record/projectDomainRecord.ts';
            import {formatContent,formatHtmlDocument,formatMarkdownDocument} from './src/core/engine/chatFormatter.ts';
            import {preparePdfItem,pdfDomainSelection} from './src/core/export/pdf/prepareItem.ts';
            export async function run(){
                const conversation=validateParserDomain({providerId:'independent',id:'exports',title:'<Independent>',timestamp:null,assets:[],
                    completeness:{status:'partial',reason:'Earlier pages unavailable'},messages:[{id:'q',role:'user',content:[{type:'paragraph',children:[{type:'text',text:'Question <safe>'}]}]},
                    {id:'a',role:'assistant',reasoning:[{type:'paragraph',children:[{type:'text',text:'Reasoning evidence'}]}],content:[{type:'code',language:'ts',code:'const value = 2;'}]}]});
                const parsed={conversation,diagnostics:[],resourceHints:{},acquisitionHints:{}};
                const before=countDomainSchemas();const doc=composeDomainDocument(conversation).document;
                const record=projectDomainRecord(conversation);
                const html=(await formatHtmlDocument(parsed)).content;
                const markdown=(await formatMarkdownDocument(parsed)).content;
                const native=JSON.parse(formatContent(parsed,'json').content);
                const openai=JSON.parse(formatContent(parsed,'json_openai').content);
                const pdf=await preparePdfItem(pdfDomainSelection(conversation),{includeAssets:false});
                return {before,after:countDomainSchemas(),doc,record,html,markdown,native,openai,pdf};
            }` }, plugins: [{ name: 'test-only-export-counter', setup(builder) {
            builder.onLoad({ filter: /runtimeValidation\.ts$/ }, args => ({ loader: 'ts', contents: readFileSync(args.path, 'utf8').replace(
                'function assertSchema(value: unknown): asserts value is DomainConversationDetail {',
                'let schemas=0; export const countDomainSchemas=()=>schemas; function assertSchema(value: unknown): asserts value is DomainConversationDetail { schemas++;') }));
        } }] });
    const api: { run: () => Promise<{before:number;after:number;doc:{messages:unknown[]};record:{messages:{thoughts?:string}[]};html:string;markdown:string;native:{conversation:DomainConversationDetail};openai:{messages:{reasoning_content?:string}[]};pdf:{ok:boolean}}> } =
        new Function('module', 'require', bundle.outputFiles[0].text + ';return instrumentedExport;')(undefined, createRequire(process.cwd() + '/package.json'));
    const result = await api.run();
    assert.equal(result.before, 1); assert.equal(result.after, 1);
    assert.equal(result.doc.messages.length, 2); assert.equal(result.pdf.ok, true);
    assert.match(result.html, /Question &lt;safe&gt;/); assert.match(result.markdown, /const value = 2;/);
    assert.equal(result.native.conversation.completeness?.status, 'partial');
    assert.equal(result.record.messages[1].thoughts, 'Reasoning evidence');
    assert.equal(result.openai.messages[1].reasoning_content, 'Reasoning evidence');
});
