import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { mockAccount } from "./helpers/l3bUnitHarness.js";
import { givenReadonlyDomain } from "./helpers/l3bUnitHarness.js";
import { mockedL2Calls } from "./helpers/l3bUnitHarness.js";
import { composeDomainDocument } from "./helpers/l3bUnitHarness.js";
import { type DomainConversationWithDetail } from "../src/l2/conversation.js";
import { type DocumentAst } from "../src/l3b/ast/ast.js";
import { collectDocumentResources } from "../src/l3b/ast/resourceReferences.js";
import { assertDocumentAst } from "./helpers/assertDocumentAst.js";
import { assertDocumentAsts } from "./helpers/assertDocumentAst.js";

__suiteDescribe("ast-composer", () => {
const account = mockAccount('chatgpt');
function input(): DomainConversationWithDetail {
    const key = { accountId: account.id, conversationId: 'native-id' };
    return {
        index: { key, title: 'Index title', titleSource: 'provider', createdAt: 1000, updatedAt: 2000 },
        detail: {
            key: { ...key }, quality: { status: 'partial' }, savedAt: 9999999999999,
            assets: [], messages: [
                { id: 'source-id', role: 'assistant', model: 'Model', timestamp: 3000, content: [{ type: 'paragraph', children: [{ type: 'text', text: '**literal** [1] [cite:2]' }] }] },
                { role: 'user', content: [] },
            ],
        },
    };
}
function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.values(value).forEach(freeze); Object.freeze(value);
}

test('Composer uses Account/Index facts, Unix-ms time and the original body order', () => {
    const domain = givenReadonlyDomain(input()); freeze(domain);
    const callsBefore = mockedL2Calls.accounts.length;
    const keyCallsBefore = mockedL2Calls.keys.length;
    const before = JSON.stringify(domain);
    const document: DocumentAst = composeDomainDocument(domain, account);
    assert.equal(document.title, 'Index title');
    assert.equal(mockedL2Calls.accounts.length, callsBefore + 1, 'L3b invokes the mocked L2 Account boundary');
    assert.strictEqual(mockedL2Calls.accounts.at(-1), account);
    assert.equal(mockedL2Calls.keys.length, keyCallsBefore + 1, 'L3b invokes the mocked L2 ConversationKey boundary');
    assert.deepEqual(document.metadata, { id: 'native-id', provider: 'chatgpt', createdAt: 1000, updatedAt: 2000 });
    assert.deepEqual(document.messages.map(m => [m.role, m.timestamp, m.modelLabel]), [
        ['assistant', 3000, 'Model'], ['user', undefined, undefined],
    ]);
    assert.deepEqual(document.messages[0].blocks, domain.detail.messages[0].content);
    assert.ok(!('header' in document) && !('schemaVersion' in document) && !('documentLanguage' in document));
    for (const message of document.messages) {
        for (const field of ['id', 'type', 'label', 'variant']) assert.ok(!(field in message), field);
    }
    assert.equal(JSON.stringify(domain), before);
    assert.deepEqual(JSON.parse(JSON.stringify(document)), document);
});

test('Composer rejects an Account or Detail key mismatch instead of repairing it', () => {
    const domain = givenReadonlyDomain(input());
    assert.throws(() => composeDomainDocument(domain, mockAccount('chatgpt', '20000000-0000-4000-8000-000000000001')), /Account\/key mismatch/);
    domain.detail.key.conversationId = 'other';
    assert.throws(() => composeDomainDocument(domain, account), /Account\/key mismatch/);
});

test('missing Index facts use one fixed reading title and do not invent timestamps', () => {
    const raw = input(); raw.index = { key: raw.index.key };
    const document = composeDomainDocument(givenReadonlyDomain(raw), account);
    assert.equal(document.title, 'Untitled conversation');
    assert.deepEqual(document.metadata, { id: 'native-id', provider: 'chatgpt' });
    raw.detail.messages = [];
    assert.deepEqual(composeDomainDocument(givenReadonlyDomain(raw), account).messages, []);
});

test('Citation numbering follows message-local citation arrays, including unreferenced sources', () => {
    const raw = input();
    raw.detail.messages = [0, 1].map(() => ({
        role: 'assistant' as const,
        citations: [{ id: 'offline' }, { id: 'url', url: 'https://example.test' }, { id: 'named', title: 'Article', url: 'https://example.test' }],
        reasoning: [{ type: 'paragraph' as const, children: [{ type: 'citationRef' as const, citationId: 'offline', label: '[99]' }] }],
        content: [{ type: 'paragraph' as const, children: [{ type: 'citationRef' as const, citationId: 'named', label: 'Read this' }, { type: 'citationRef' as const, citationId: 'url' }, { type: 'citationRef' as const, citationId: 'url' }] }],
    }));
    const document = composeDomainDocument(givenReadonlyDomain(raw), account);
    assert.deepEqual(document.messages.map(m => m.sources), [0, 1].map(i => [
        { id: 'offline', label: '', number: i * 3 + 1 },
        { id: 'url', label: 'https://example.test', href: 'https://example.test', number: i * 3 + 2 },
        { id: 'named', label: 'Article', href: 'https://example.test', number: i * 3 + 3 },
    ]));
    assert.deepEqual(document.messages[1].blocks, [
        { type: 'disclosure', kind: 'reasoning', title: 'Thinking Process', blocks: [{ type: 'paragraph', children: [{ type: 'citation', id: 'offline', label: '[99]' }] }] },
        { type: 'paragraph', children: [
            { type: 'citation', id: 'named', label: 'Read this', href: 'https://example.test' },
            { type: 'citation', id: 'url', label: '[5]', href: 'https://example.test' },
            { type: 'citation', id: 'url', label: '[5]', href: 'https://example.test' },
        ] },
    ]);
});

test('Citation source labels skip whitespace-only titles and URLs without inventing links', () => {
    const raw = input();
    raw.detail.messages = [{
        role: 'assistant',
        citations: [
            { id: 'untitled', title: '  ', url: 'https://example.test/fallback' },
            { id: 'unlinked', title: '', url: ' \t ' },
            { id: 'named', title: 'Article', url: 'https://example.test/article' },
        ],
        content: [{ type: 'paragraph', children: [
            { type: 'citationRef', citationId: 'untitled' },
            { type: 'citationRef', citationId: 'unlinked', label: 'As authored' },
            { type: 'citationRef', citationId: 'named' },
        ] }],
    }];
    const [message] = composeDomainDocument(givenReadonlyDomain(raw), account).messages;
    assert.deepEqual(message.sources, [
        { id: 'untitled', number: 1, label: 'https://example.test/fallback', href: 'https://example.test/fallback' },
        { id: 'unlinked', number: 2, label: '' },
        { id: 'named', number: 3, label: 'Article', href: 'https://example.test/article' },
    ]);
    assert.deepEqual(message.blocks, [{ type: 'paragraph', children: [
        { type: 'citation', id: 'untitled', label: '[1]', href: 'https://example.test/fallback' },
        { type: 'citation', id: 'unlinked', label: 'As authored' },
        { type: 'citation', id: 'named', label: '[3]', href: 'https://example.test/article' },
    ] }]);
});

test('Reasoning, content and explicitly attached resources retain their source order', () => {
    const raw = input();
    raw.detail.assets = [
        { id: 'photo', kind: 'image', name: 'Diagram.png' },
        { id: 'file', kind: 'file', name: 'Report.pdf', mediaType: 'application/pdf', byteLength: 42 },
        { id: 'unowned', kind: 'image', document: { contentMarkdown: '# Not a message preview' } },
    ];
    raw.detail.messages = [{
        role: 'assistant', reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Thought' }] }],
        content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Answer' }] }],
        attachmentIds: ['photo', 'file'],
    }];
    const document = composeDomainDocument(givenReadonlyDomain(raw), account);
    assert.deepEqual(document.messages[0].blocks.map(block => block.type), ['disclosure', 'paragraph', 'image', 'file']);
    assert.deepEqual(document.messages[0].blocks[2], { type: 'image', resourceId: 'photo', alt: 'Diagram.png' });
    assert.deepEqual(document.messages[0].blocks[3], { type: 'file', resourceId: 'file', label: 'Report.pdf', kind: 'file', mediaType: 'application/pdf', byteLength: 42 });
    const resources = collectDocumentResources(document);
    assert.deepEqual([...resources.referencedIds], ['photo', 'file']);
    assert.deepEqual([...resources.imageIds], ['photo']);
    assert.deepEqual([...resources.fileIds], ['file']);
    assert.doesNotMatch(JSON.stringify(document), /unowned|contentMarkdown|placeholder|savedAt|quality/);
});

test('Resource query visits nested inlines, table cells, captions and descriptions without mutation', () => {
    const document: DocumentAst = {
        title: 'T', metadata: { id: 'x', provider: 'test' }, messages: [{
            role: 'assistant', blocks: [
                { type: 'disclosure', kind: 'reasoning', title: 'Thinking Process', blocks: [{ type: 'quote', blocks: [{ type: 'list', ordered: false, items: [{ blocks: [{ type: 'paragraph', children: [{ type: 'link', href: '#', children: [{ type: 'strong', children: [{ type: 'image', resourceId: 'nested', alt: '' }] }] }] }] }] }] }] },
                { type: 'table', columnAlignments: ['default'], headerRows: [[{ column: 0, colSpan: 1, rowSpan: 1, children: [{ type: 'image', resourceId: 'header', alt: '' }] }]], rows: [[{ column: 0, colSpan: 1, rowSpan: 1, children: [{ type: 'image', resourceId: 'cell', alt: '' }] }]], caption: [{ type: 'image', resourceId: 'table-caption', alt: '' }] },
                { type: 'image', resourceId: 'figure', alt: '', caption: [{ type: 'image', resourceId: 'caption', alt: '' }] },
                { type: 'file', resourceId: 'file', label: '', kind: 'file', description: [{ type: 'image', resourceId: 'description', alt: '' }] },
            ],
        }],
    };
    freeze(document); const before = JSON.stringify(document);
    const first = collectDocumentResources(document), second = collectDocumentResources(document);
    assert.deepEqual(first.imageIds, new Set(['nested', 'header', 'cell', 'table-caption', 'figure', 'caption', 'description']));
    assert.deepEqual(first.fileIds, new Set(['file']));
    assert.deepEqual(first.referencedIds, new Set([...first.imageIds, ...first.fileIds]));
    first.referencedIds.clear(); first.imageIds.clear(); first.fileIds.clear();
    assert.equal(second.referencedIds.size, 8);
    assert.deepEqual(second.fileIds, new Set(['file']));
    assert.equal(JSON.stringify(document), before);
    assert.deepEqual(collectDocumentResources({ ...document, messages: [] }), { referencedIds: new Set(), imageIds: new Set(), fileIds: new Set() });
});

test('Resource query classifies shared IDs by AST node use, not Domain asset kind', () => {
    const document: DocumentAst = {
        title: 'T', metadata: { id: 'x', provider: 'test' }, messages: [{
            role: 'assistant', blocks: [
                { type: 'image', resourceId: 'shared', alt: 'Image' },
                { type: 'file', resourceId: 'shared', label: 'Same image as attachment', kind: 'image' },
                { type: 'file', resourceId: 'file-only', label: 'File', kind: 'image' },
            ],
        }],
    };
    const refs = collectDocumentResources(document);
    assert.deepEqual(refs.imageIds, new Set(['shared']));
    assert.deepEqual(refs.fileIds, new Set(['shared', 'file-only']));
    assert.deepEqual(refs.referencedIds, new Set(['shared', 'file-only']));
});

test('Table projection preserves merged positions, original captions and column alignments', () => {
    const raw = input();
    raw.detail.messages = [{ role: 'assistant', content: [{ type: 'table',
        columns: [{ align: 'left' }, { align: 'right' }, { align: 'center' }],
        caption: [{ type: 'emphasis', children: [{ type: 'text', text: 'Table caption' }] }],
        headerRows: [{ cells: [{ children: [{ type: 'text', text: 'Heading' }], colSpan: 2 }] }],
        rows: [{ cells: [{ children: [{ type: 'text', text: 'A' }], rowSpan: 2 }, { children: [{ type: 'text', text: 'B' }] }] }, { cells: [{ children: [{ type: 'text', text: 'C' }] }] }],
    }] }];
    const table = raw.detail.messages[0].content[0];
    if (table.type !== 'table') throw new Error('Expected table fixture');
    const tableCallsBefore = mockedL2Calls.tables.length;
    const document = composeDomainDocument(givenReadonlyDomain(raw), account);
    assert.strictEqual(mockedL2Calls.tables.at(-1), table, 'L3b consumes the L2 table placement port');
    assert.equal(mockedL2Calls.tables.length, tableCallsBefore + 1);
    assert.deepEqual(document.messages[0].blocks, [{
        type: 'table', columnAlignments: ['left', 'right', 'center'],
        caption: [{ type: 'emphasis', children: [{ type: 'text', text: 'Table caption' }] }],
        headerRows: [[{ column: 0, colSpan: 2, rowSpan: 1, children: [{ type: 'text', text: 'Heading' }] }]],
        rows: [
            [{ column: 0, colSpan: 1, rowSpan: 2, children: [{ type: 'text', text: 'A' }] }, { column: 1, colSpan: 1, rowSpan: 1, children: [{ type: 'text', text: 'B' }] }],
            [{ column: 1, colSpan: 1, rowSpan: 1, children: [{ type: 'text', text: 'C' }] }],
        ],
    }]);
});

test('Authored rich text, alt, caption and File description survive projection unchanged', () => {
    const raw = input();raw.detail.assets=[{id:'image',kind:'image',name:'Asset image'},{id:'file',kind:'file',name:'Asset file'}];
    raw.detail.messages=[{role:'assistant',content:[
        {type:'heading',level:3,children:[{type:'strong',children:[{type:'emphasis',children:[{type:'image',assetId:'image',alt:'Authored alt',title:'Authored title'}]}]}]},
        {type:'image',assetId:'image',alt:'Authored block alt',caption:[{type:'emphasis',children:[{type:'text',text:'Original caption'}]}]},
        {type:'file',assetId:'file',label:'Original label',description:[{type:'text',text:'Original description'}]},
        {type:'unknown',sourceType:'widget',text:'Original unsupported text'},
    ]}];
    const doc=composeDomainDocument(givenReadonlyDomain(raw),account);
    assert.deepEqual(doc.messages[0].blocks,[
        {type:'heading',level:3,children:[{type:'strong',children:[{type:'emphasis',children:[{type:'image',resourceId:'image',alt:'Authored alt',title:'Authored title'}]}]}]},
        {type:'image',resourceId:'image',alt:'Authored block alt',caption:[{type:'emphasis',children:[{type:'text',text:'Original caption'}]}]},
        {type:'file',resourceId:'file',label:'Original label',kind:'file',description:[{type:'text',text:'Original description'}]},
        {type:'unsupported',sourceType:'widget',text:'Original unsupported text'},
    ]);
});

test('File projections retain provided optional metadata without changing attachment semantics', () => {
    const raw = input();
    raw.detail.assets = [{ id: 'file', kind: 'file', mediaType: '', byteLength: 0 }];
    raw.detail.messages = [{
        role: 'assistant',
        content: [{ type: 'file', assetId: 'file' }],
        attachmentIds: ['file'],
    }];
    const document = composeDomainDocument(givenReadonlyDomain(raw), account);
    assert.deepEqual(document.messages[0].blocks, [
        { type: 'file', resourceId: 'file', label: 'Attachment', kind: 'file', mediaType: '', byteLength: 0 },
        { type: 'file', resourceId: 'file', label: 'Attachment', kind: 'file', mediaType: '', byteLength: 0 },
    ]);
});

test('Audio, video, other and document attachments remain typed File nodes without previewing source documents', () => {
    const raw = input();
    raw.detail.assets = [
        { id: 'audio', kind: 'audio', name: 'Recording', mediaType: 'audio/mpeg', byteLength: 12 },
        { id: 'video', kind: 'video', name: 'Clip', mediaType: 'video/mp4', byteLength: 0 },
        { id: 'other', kind: 'other' },
        { id: 'document', kind: 'file', name: 'Research.md', mediaType: 'text/markdown', document: { contentMarkdown: '# PRIVATE_DOCUMENT_BODY' } },
    ];
    raw.detail.messages = [{ role: 'assistant', content: [], attachmentIds: ['audio', 'video', 'other', 'document'] }];
    const domain = givenReadonlyDomain(raw), before = JSON.stringify(domain);
    const document = composeDomainDocument(domain, account);
    assert.deepEqual(document.messages[0].blocks, [
        { type: 'file', resourceId: 'audio', label: 'Recording', kind: 'audio', mediaType: 'audio/mpeg', byteLength: 12 },
        { type: 'file', resourceId: 'video', label: 'Clip', kind: 'video', mediaType: 'video/mp4', byteLength: 0 },
        { type: 'file', resourceId: 'other', label: 'Attachment', kind: 'other' },
        { type: 'file', resourceId: 'document', label: 'Research.md', kind: 'file', mediaType: 'text/markdown' },
    ]);
    assert.doesNotMatch(JSON.stringify(document), /PRIVATE_DOCUMENT_BODY|contentMarkdown/);
    const refs = collectDocumentResources(document);
    assert.deepEqual([...refs.imageIds], []);
    assert.deepEqual([...refs.fileIds], ['audio', 'video', 'other', 'document']);
    assert.deepEqual([...refs.referencedIds], [...refs.fileIds]);
    assert.equal(JSON.stringify(domain), before);
});

test('Blank authored resource names and metadata use the same L3b fallback in every placement', () => {
    const raw = input();
    raw.detail.assets = [{ id: 'image', kind: 'image', name: '  ' }, { id: 'file', kind: 'file', name: '\n' }];
    raw.detail.messages = [{ role: 'user', content: [
        { type: 'paragraph', children: [{ type: 'image', assetId: 'image', alt: '\t' }] },
        { type: 'image', assetId: 'image', alt: ' ' },
        { type: 'file', assetId: 'file', label: '\t' },
    ], attachmentIds: ['image', 'file'] }];
    const document = composeDomainDocument(givenReadonlyDomain(raw), account);
    assert.deepEqual(document.messages[0].blocks, [
        { type: 'paragraph', children: [{ type: 'image', resourceId: 'image', alt: 'Image' }] },
        { type: 'image', resourceId: 'image', alt: 'Image' },
        { type: 'file', resourceId: 'file', label: 'Attachment', kind: 'file' },
        { type: 'image', resourceId: 'image', alt: 'Image' },
        { type: 'file', resourceId: 'file', label: 'Attachment', kind: 'file' },
    ]);
});

test('Resource lookup follows nested File blocks as well as Image inlines without modifying the AST', () => {
    const document: DocumentAst = { title: 'T', metadata: { id: 'x', provider: 'test' }, messages: [{
        role: 'assistant', blocks: [{ type: 'disclosure', kind: 'reasoning', title: 'Thinking Process', blocks: [{
            type: 'quote', blocks: [{ type: 'list', ordered: true, items: [{ blocks: [
                { type: 'file', resourceId: 'shared', label: 'File use', kind: 'file', description: [{ type: 'image', resourceId: 'caption-image', alt: 'Caption' }] },
                { type: 'image', resourceId: 'shared', alt: 'Image use' },
            ] }] }],
        }] }],
    }] };
    freeze(document);
    const before = JSON.stringify(document), refs = collectDocumentResources(document);
    assert.deepEqual(refs.fileIds, new Set(['shared']));
    assert.deepEqual(refs.imageIds, new Set(['caption-image', 'shared']));
    assert.deepEqual(refs.referencedIds, new Set(['shared', 'caption-image']));
    assert.equal(JSON.stringify(document), before);
});

test('all accepted roles keep their identity and message-level timestamps', () => {
    const raw=input();raw.detail.messages=['user','assistant','system','developer','unknown'].map(role=>({
        role:role as 'user'|'assistant'|'system'|'developer'|'unknown',timestamp:123456789,content:[],
    }));
    const document=composeDomainDocument(givenReadonlyDomain(raw),{...account,email:'private@example.test',displayName:'Private name'});
    assert.deepEqual(document.messages.map(m=>[m.role,m.timestamp]),[
        ['user',123456789],['assistant',123456789],['system',123456789],['developer',123456789],['unknown',123456789],
    ]);
    assert.doesNotMatch(JSON.stringify(document), /private@example|Private name/);
});

test('AST modules have no acquisition, persistence, renderer or diagnostics dependencies', () => {
    for (const directory of ['ast', 'compose']) for (const file of readdirSync('src/l3b/' + directory)) {
        const source=readFileSync('src/l3b/' + directory + '/' + file,'utf8');
        for(const [,dependency] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)){
            assert.doesNotMatch(dependency,/(?:^|\/)(?:storage|api|providers?|parsers|resources|renderers|export|diagnostics)(?:\/|$)/);
        }
        assert.doesNotMatch(source,/\bfetch\s*\(|chrome\.storage|\bdataBase64\b|\bResourceBindings\b/);
    }
});

test('empty Reasoning emits no disclosure and fixed reading labels never rewrite source text', () => {
    const raw = input(); raw.index.title = 'First line\nSecond line';
    raw.detail.assets = [{ id: 'image', kind: 'image' }, { id: 'file', kind: 'file' }];
    raw.detail.messages = [{ role: 'assistant', reasoning: [], content: [
        { type: 'image', assetId: 'image' }, { type: 'file', assetId: 'file' },
    ] }];
    const document = composeDomainDocument(givenReadonlyDomain(raw), account);
    assert.equal(document.title, 'First line\nSecond line');
    assert.deepEqual(document.messages[0].blocks, [
        { type: 'image', resourceId: 'image', alt: 'Image' },
        { type: 'file', resourceId: 'file', label: 'Attachment', kind: 'file' },
    ]);
});

test('Table layout carries a header rowspan into body rows and retains unused declared columns', () => {
    const raw = input(); raw.detail.messages = [{ role: 'assistant', content: [{ type: 'table',
        columns: [{ align: 'right' }, {}, { align: 'center' }],
        headerRows: [{ cells: [{ rowSpan: 2, children: [{ type: 'text', text: 'Spans boundary' }] }] }],
        rows: [{ cells: [{ children: [{ type: 'text', text: 'Body' }] }] }, { cells: [] }],
    }] }];
    const block = composeDomainDocument(givenReadonlyDomain(raw), account).messages[0].blocks[0];
    assert.ok(block.type === 'table');
    assert.deepEqual(block.columnAlignments, ['right', 'default', 'center']);
    assert.equal(block.headerRows[0][0].rowSpan, 2);
    assert.equal(block.rows[0][0].column, 1); assert.deepEqual(block.rows[1], []);
    assert.ok(!('align' in block.rows[0][0]));
});

test('Composition rejects unresolved image assetIds symmetrically with file blocks', () => {
    const rawBlock = input();
    rawBlock.detail.messages = [{ role: 'assistant', content: [{ type: 'image', assetId: 'missing-block-img' }] }];
    assert.throws(() => composeDomainDocument(givenReadonlyDomain(rawBlock), account), /Unresolved Domain asset: missing-block-img/);

    const rawInline = input();
    rawInline.detail.messages = [{
        role: 'assistant',
        content: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'missing-inline-img' }] }],
    }];
    assert.throws(() => composeDomainDocument(givenReadonlyDomain(rawInline), account), /Unresolved Domain asset: missing-inline-img/);
});
});

__suiteDescribe("document-ast-contract", () => {
const valid = () => ({
    title: 'T',
    metadata: { id: 'fixture', provider: 'test', createdAt: 0 },
    messages: [{ role: 'assistant', timestamp: 1000, modelLabel: 'Model',
        blocks: [{ type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'image', resourceId: 'i', alt: 'Image' }] }] }],
        sources: [{ id: 'c', label: 'Article', number: 1 }],
    }],
});

test('all visual and parity fixtures satisfy the canonical DocumentAst TypeScript contract', () => {
    const entries: Array<{ value: unknown; context: string }> = [];
    for (const directory of ['tests/fixtures/visual-corpus', 'tests/parity-corpus']) {
        const files = readdirSync(directory).filter(file => file.endsWith('.json'));
        assert.ok(files.length, directory);
        for (const file of files) {
            const fixture = JSON.parse(readFileSync(directory + '/' + file, 'utf8'));
            entries.push({ value: fixture.document, context: directory + '/' + file });
        }
    }
    for (const file of readdirSync('tests/fixtures/document-domain').filter(file => file.endsWith('.json'))) {
        const input: DomainConversationWithDetail = JSON.parse(readFileSync('tests/fixtures/document-domain/' + file, 'utf8'));
        const domain = givenReadonlyDomain(input);
        entries.push({ value: composeDomainDocument(domain, mockAccount('example', domain.index.key.accountId)), context: file });
    }
    assertDocumentAsts(entries);
});

test('contract rejects stale fields, bad types and a second sources wrapper', () => {
    assertDocumentAst(valid());
    const mutate: Array<(value: ReturnType<typeof valid>) => void> = [
        value => Object.assign(value, { schemaVersion: 2 }),
        value => Object.assign(value, { header: { title: 'Legacy' } }),
        value => Object.assign(value, { documentLanguage: 'en' }),
        value => Object.assign(value.metadata, { url: 'https://obsolete.example' }),
        value => Object.assign(value.metadata, { createdAt: '2026-01-01T00:00:00Z' }),
        value => Object.assign(value.messages[0], { type: 'message' }),
        value => Object.assign(value.messages[0], { id: 'msg-0' }),
        value => Object.assign(value.messages[0], { variant: 'flow' }),
        value => Object.assign(value.messages[0], { label: 'you' }),
        value => Object.assign(value.messages[0], { role: 'model' }),
        value => Object.assign(value.messages[0], { timestamp: '2026-01-01' }),
        value => Object.assign(value.messages[0], { sources: { items: [] } }),
        value => Object.assign(value.messages[0], { sources: [{ id: 'c', label: 'Unnumbered' }] }),
        value => Object.assign(value.messages[0], { blocks: [{ type: 'placeholder', kind: 'file', text: 'Absent' }] }),
        value => Object.assign(value.messages[0], { blocks: [{ type: 'file', resourceId: 'f', label: 'Attachment' }] }),
        value => Object.assign(value.messages[0], { blocks: [{ type: 'image', resourceId: 'i' }] }),
        value => Object.assign(value.messages[0], { blocks: [{ type: 'paragraph', children: [{ type: 'citation', id: 'c' }] }] }),
        value => Object.assign(value.messages[0], { blocks: [{ type: 'table', columnAlignments: ['default'], headerRows: [], rows: [[{ column: 0, colSpan: 1, rowSpan: 1, align: 'left', children: [] }]] }] }),
        value => Object.assign(value, { diagnostics: [] }),
        value => Object.assign(value.messages[0], { blocks: [{ type: 'disclosure', kind: 'reasoning', blocks: [] }] }),
    ];
    for (const change of mutate) {
        const value = valid(); change(value);
        assert.throws(() => assertDocumentAst(value), TypeError);
    }
});
});

__suiteDescribe("domain-ast-projection", () => {
const account = Object.freeze({ ...mockAccount('chatgpt'), email: 'private@example.test', displayName: 'Private name' });
function input(): DomainConversationWithDetail {
    const key = { accountId: account.id, conversationId: 'same-native-id' };
    return { index: { key, title: 'Index title', titleSource: 'provider', createdAt: 1000, updatedAt: 2000 },
        detail: { key: { ...key }, savedAt: 9999999999999, quality: { status: 'partial' }, assets: [], messages: [
            { id: 'provider-z', role: 'assistant', model: 'Source model', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'First body' }] }] },
            { id: 'provider-a', role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Second body' }] }] },
        ] } };
}

test('AST: projection uses matched Account and Index facts, preserving supplied partial body order', () => {
    const domain = givenReadonlyDomain(input()), before = JSON.stringify(domain);
    const document = composeDomainDocument(domain, account);
    assert.deepEqual(document.metadata, { id: 'same-native-id', provider: 'chatgpt', createdAt: 1000, updatedAt: 2000 });
    assert.equal(document.title, 'Index title');
    assert.deepEqual(document.messages.map(m => [m.role, m.modelLabel]), [['assistant', 'Source model'], ['user', undefined]]);
    assert.doesNotMatch(JSON.stringify(document), /private@example|Private name|provider-z|savedAt|quality|9999999999999/);
    assert.equal(JSON.stringify(domain), before);

    const otherAccount = mockAccount('chatgpt', '20000000-0000-4000-8000-000000000001');
    assert.throws(() => composeDomainDocument(domain, otherAccount), /Account\/key mismatch/);
    const other = input(); other.index.key.accountId = otherAccount.id; other.detail.key.accountId = otherAccount.id;
    other.detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'text', text: 'Other account body' }] }];
    const otherDocument = composeDomainDocument(givenReadonlyDomain(other), otherAccount);
    assert.equal(otherDocument.metadata.id, document.metadata.id, 'AST source ID is not a cross-account storage key');
    assert.deepEqual(otherDocument.messages[0].blocks, other.detail.messages[0].content);
    assert.deepEqual(document.messages[0].blocks, domain.detail.messages[0].content);
    domain.detail.key.conversationId = 'wrong-detail';
    assert.throws(() => composeDomainDocument(domain, account), /Account\/key mismatch/);
});

test('AST: missing Index title and times get reading defaults without borrowing savedAt', () => {
    const raw = input(); raw.index = { key: raw.index.key };
    const domain = givenReadonlyDomain(raw), before = JSON.stringify(domain);
    const document = composeDomainDocument(domain, account);
    assert.equal(document.title, 'Untitled conversation');
    assert.ok(!('updatedAt' in document.metadata));
    assert.deepEqual(document.metadata, { id: 'same-native-id', provider: 'chatgpt' });
    assert.equal(JSON.stringify(domain), before);
});

test('AST: Composer numbers sources once across messages and preserves absent URLs', () => {
    const raw = input();
    raw.detail.messages = [0, 1].map(() => ({ role: 'assistant', citations: [{ id: 'same' }, { id: 'named', title: 'Article', url: 'https://example.test/article' }],
        reasoning: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'same', label: '[99]' }] }],
        content: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'named', label: 'Read this' }, { type: 'citationRef', citationId: 'same' }] }],
    }));
    const document = composeDomainDocument(givenReadonlyDomain(raw), account);
    assert.deepEqual(document.messages.map(m => m.sources?.map(s => [s.id, s.number, s.label, s.href])), [
        [['same', 1, '', undefined], ['named', 2, 'Article', 'https://example.test/article']],
        [['same', 3, '', undefined], ['named', 4, 'Article', 'https://example.test/article']],
    ]);
    const reasoning = document.messages[1].blocks[0];
    assert.ok(JSON.stringify(reasoning).includes('"label":"[99]"'));

});

test('AST: only explicit media placements become AST content; resource absence never changes the AST', () => {
    const raw = input();
    raw.detail.assets = [{ id: 'photo', kind: 'image', name: 'Diagram.png' }, { id: 'file', kind: 'file', name: 'Report.pdf' }, { id: 'unowned', kind: 'image' }];
    raw.detail.messages = [
        { role: 'assistant', content: [] },
        { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'photo' }] }], attachmentIds: ['photo', 'file'] },
    ];
    const document = composeDomainDocument(givenReadonlyDomain(raw), account), before = JSON.stringify(document);
    assert.deepEqual(document.messages[0].blocks, []);
    assert.equal(document.messages[1].blocks.length, 3, 'explicit attachment IDs follow content in source order');
    assert.ok(!before.includes('unowned') && !before.includes('placeholder'));
    assert.equal(JSON.stringify(document), before);
});

test('AST: code and reasoning preserve facts without renderer controls', () => {
    const raw = input(); raw.detail.messages[0].reasoning = [{ type: 'code', code: 'thought', language: 'text' }];
    raw.detail.messages[0].content = [{ type: 'code', code: 'answer', language: 'js', meta: 'Authored filename' }];
    const domain = givenReadonlyDomain(raw), document = composeDomainDocument(domain, account), before = JSON.stringify(document);
    assert.deepEqual(document.messages[0].blocks, [
        { type: 'disclosure', kind: 'reasoning', title: 'Thinking Process', blocks: [{ type: 'code', code: 'thought', language: 'text' }] },
        { type: 'code', code: 'answer', language: 'js', meta: 'Authored filename' },
    ]);
    assert.equal(JSON.stringify(document), before);
});

test('AST: Composer modules cannot reach persistence, acquisition or provider services', () => {
    for (const file of ['composeDomainDocument', 'composeContent', 'resourcePresentation']) {
        const source = readFileSync(`src/l3b/compose/${file}.ts`, 'utf8');
        for (const [, dependency] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
            assert.doesNotMatch(dependency, /(?:^|\/)(?:storage|api|providers?|parsers|resources|renderers|export)(?:\/|$)/);
        }
        assert.doesNotMatch(source, /\bfetch\s*\(|chrome\.storage|\bdataBase64\b/);
    }
});
});
