import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fixtureAccount } from './helpers/domainFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
import type { DocumentAst } from '../src/core/document/ast/ast.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { collectDocumentResources } from '../src/core/document/ast/resourceReferences.js';
import { selectDisplayDate } from '../src/core/document/compose/displayDate.js';

const account = fixtureAccount('chatgpt');
function input(): DomainConversationWithDetail {
    const key = { accountId: account.id, conversationId: 'native-id' };
    return { index: { key, title: 'Index title', titleSource: 'provider', createdAt: 1000, updatedAt: 2000 }, detail: {
        key: { ...key }, quality: { status: 'partial' }, savedAt: 9999999999999, assets: [], messages: [
            { id: 'source-id', role: 'assistant', model: 'Model', content: [{ type: 'paragraph', children: [{ type: 'text', text: '**literal** [1] [cite:2]' }] }] },
            { role: 'user', content: [] },
        ],
    } };
}
function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.values(value).forEach(freeze); Object.freeze(value);
}

test('Composer returns the document directly using Account/Index facts and supplied body order', () => {
    const domain = validateParserDomain(input()); freeze(domain);
    const before = JSON.stringify(domain);
    const document: DocumentAst = composeDomainDocument(domain, account, { documentLanguage: 'zh' });
    assert.deepEqual(document.metadata, { id: 'native-id', provider: 'chatgpt', createdAt: '1970-01-01T00:00:01.000Z', updatedAt: '1970-01-01T00:00:02.000Z' });
    assert.deepEqual(document.header, { title: 'Index title', providerLabel: 'chatgpt', date: '1970-01-01', messageCount: 2 });
    assert.equal(document.documentLanguage, 'zh');
    assert.deepEqual(document.messages.map(m => [m.id, m.label, m.variant, m.modelLabel]), [['msg-0', 'assistant', 'flow', 'Model'], ['msg-1', 'you', 'bubble', undefined]]);
    assert.deepEqual(document.messages[0].blocks, domain.detail.messages[0].content);
    assert.ok(!('document' in document) && !('diagnostics' in document));
    assert.equal(JSON.stringify(domain), before);
    assert.deepEqual(JSON.parse(JSON.stringify(document)), document);
});

test('Composer rejects mismatched Account and Detail keys without repairing them', () => {
    const domain = validateParserDomain(input());
    assert.throws(() => composeDomainDocument(domain, fixtureAccount('chatgpt', '20000000-0000-4000-8000-000000000001')), /Account\/key mismatch/);
    domain.detail.key.conversationId = 'other';
    assert.throws(() => composeDomainDocument(domain, account), /Account\/key mismatch/);
});

test('missing Index facts use reading defaults, never Detail freshness', () => {
    const raw = input(); raw.index = { key: raw.index.key };
    const document = composeDomainDocument(validateParserDomain(raw), account);
    assert.deepEqual(document.metadata, { id: 'native-id', provider: 'chatgpt' });
    assert.deepEqual(document.header, { title: 'Untitled conversation', providerLabel: 'chatgpt', messageCount: 2 });
    assert.equal(selectDisplayDate(undefined, 86400000), '1970-01-02');
    assert.equal(selectDisplayDate(NaN, Infinity), undefined);
    raw.detail.messages = [];
    assert.deepEqual(composeDomainDocument(validateParserDomain(raw), account).messages, []);
});

test('source labels exclude numbering while inline references share global message-local numbering', () => {
    const raw = input();
    raw.detail.messages = [0, 1].map(() => ({ role: 'assistant', citations: [
        { id: 'offline' }, { id: 'url', url: 'https://example.test' }, { id: 'named', title: 'Article', url: 'https://example.test' },
    ], reasoning: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'offline', label: '[99]' }] }],
    content: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'named', label: 'Read this' }, { type: 'citationRef', citationId: 'url' }] }] }));
    const document = composeDomainDocument(validateParserDomain(raw), account);
    assert.deepEqual(document.messages.map(m => m.sources?.items), [0, 1].map(i => [
        { id: `msg-${i}:offline`, label: '', number: i * 3 + 1 },
        { id: `msg-${i}:url`, label: 'https://example.test', href: 'https://example.test', number: i * 3 + 2 },
        { id: `msg-${i}:named`, label: 'Article', href: 'https://example.test', number: i * 3 + 3 },
    ]));
    assert.deepEqual(document.messages[1].blocks, [
        { type: 'disclosure', kind: 'reasoning', blocks: [{ type: 'paragraph', children: [{ type: 'citation', id: 'msg-1:offline', label: '[4]' }] }] },
        { type: 'paragraph', children: [{ type: 'citation', id: 'msg-1:named', label: 'Read this', href: 'https://example.test' }, { type: 'citation', id: 'msg-1:url', label: '[5]', href: 'https://example.test' }] },
    ]);
});

test('explicit media belongs to its message; reasoning placements suppress duplicate attachment tails', () => {
    const raw = input();
    raw.detail.assets = [{ id: 'photo', kind: 'image', name: 'Diagram.png' }, { id: 'file', kind: 'file', name: 'Report.pdf', mediaType: 'application/pdf', byteLength: 42 }, { id: 'unowned', kind: 'image' }];
    raw.detail.messages = [{ role: 'assistant', content: [], reasoning: [{ type: 'image', assetId: 'photo' }], attachmentIds: ['photo', 'file'] }, { role: 'user', content: [], attachmentIds: ['photo'] }];
    const document = composeDomainDocument(validateParserDomain(raw), account);
    assert.equal(document.messages[0].blocks.length, 2);
    assert.deepEqual(document.messages[0].blocks[1], { type: 'file', resourceId: 'file', label: 'Report.pdf', kind: 'file', mediaType: 'application/pdf', byteLength: 42 });
    assert.equal(document.messages[1].blocks[0].type, 'image');
    const resources = collectDocumentResources(document);
    assert.deepEqual([...resources.referencedIds], ['photo', 'file']);
    assert.deepEqual([...resources.imageIds], ['photo']);
    assert.doesNotMatch(JSON.stringify(document), /unowned|placeholder|sourceUri|savedAt|quality/);
});

test('resource query walks rich fields, nested blocks and placeholders without mutating the tree', () => {
    const document: DocumentAst = { schemaVersion: 2, metadata: { id: 'x', provider: 'test' }, header: { title: 'T', providerLabel: 'test', messageCount: 1 }, messages: [{ type: 'message', id: 'm', label: 'assistant', variant: 'flow', blocks: [
        { type: 'disclosure', kind: 'reasoning', blocks: [{ type: 'quote', blocks: [{ type: 'list', ordered: false, items: [{ blocks: [{ type: 'paragraph', children: [{ type: 'link', href: '#', children: [{ type: 'strong', children: [{ type: 'image', resourceId: 'nested', alt: '' }] }] }] }] }] }] }] },
        { type: 'table', columnAlignments: [], headerRows: [[{ column: 0, colSpan: 1, rowSpan: 1, align: 'default', children: [{ type: 'image', resourceId: 'header', alt: '' }] }]], rows: [[{ column: 0, colSpan: 1, rowSpan: 1, align: 'default', children: [{ type: 'placeholder', kind: 'file', resourceId: 'inline-placeholder', text: '' }] }]], caption: [{ type: 'image', resourceId: 'table-caption', alt: '' }] },
        { type: 'image', resourceId: 'figure', alt: '', caption: [{ type: 'image', resourceId: 'caption', alt: '' }] },
        { type: 'file', resourceId: 'file', label: '', kind: 'file', description: [{ type: 'image', resourceId: 'description', alt: '' }] },
        { type: 'placeholder', resourceId: 'missing', kind: 'image', text: '', details: [{ type: 'image', resourceId: 'details', alt: '' }] },
    ] }] };
    freeze(document); const before = JSON.stringify(document);
    const first = collectDocumentResources(document), second = collectDocumentResources(document);
    assert.deepEqual([...first.imageIds].sort(), ['nested', 'header', 'table-caption', 'figure', 'caption', 'description', 'details'].sort());
    assert.deepEqual(first.referencedIds, new Set([...first.imageIds, 'inline-placeholder', 'file', 'missing']));
    first.referencedIds.clear(); first.imageIds.clear();
    assert.equal(second.referencedIds.size, 10);
    assert.equal(JSON.stringify(document), before);
    assert.deepEqual(collectDocumentResources({ ...document, messages: [] }), { referencedIds: new Set(), imageIds: new Set() });
});

test('AST modules have no acquisition, persistence, renderer or diagnostics dependencies', () => {
    for (const directory of ['ast', 'compose']) for (const file of readdirSync(`src/core/document/${directory}`)) {
        const source = readFileSync(`src/core/document/${directory}/${file}`, 'utf8');
        for (const [, dependency] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
            assert.doesNotMatch(dependency, /(?:^|\/)(?:storage|api|providers?|parsers|resources|renderers|export|diagnostics)(?:\/|$)/);
        }
        assert.doesNotMatch(source, /\bfetch\s*\(|chrome\.storage|\bdataBase64\b|\bResourceBindings\b/);
    }
});

test('every Domain block and inline keeps its semantics through the minimal recursive projection', () => {
    const raw = input();
    raw.detail.assets = [{ id: 'image', kind: 'image', name: 'Diagram.png' }];
    raw.detail.messages = [{ role: 'assistant', content: [
        { type: 'heading', level: 3, children: [{ type: 'strong', children: [{ type: 'emphasis', children: [{ type: 'strikethrough', children: [{ type: 'link', href: 'https://example.test', title: 'Link title', children: [{ type: 'inlineCode', code: '<raw>' }, { type: 'inlineMath', source: 'x^2' }, { type: 'lineBreak', kind: 'hard' }, { type: 'lineBreak', kind: 'soft' }, { type: 'image', assetId: 'image', alt: 'Authored alt', title: 'Image title' }] }] }] }] }] },
        { type: 'quote', blocks: [{ type: 'list', ordered: true, start: 4, items: [{ blocks: [{ type: 'code', code: '<script>raw</script>', language: 'html', meta: 'example.html' }, { type: 'math', source: '\\alpha' }, { type: 'thematicBreak' }, { type: 'unknown', sourceType: 'widget', text: 'Original unsupported text' }] }] }] },
    ] }];
    const document = composeDomainDocument(validateParserDomain(raw), account);
    const expected = JSON.parse(JSON.stringify(raw.detail.messages[0].content)
        .replace('"assetId":"image"', '"resourceId":"image"')
        .replace('"type":"unknown"', '"type":"unsupported"'));
    assert.deepEqual(document.messages[0].blocks, expected);
});

test('table projection preserves row/column spans, alignment, rich captions and cell content', () => {
    const raw = input();
    raw.detail.messages = [{ role: 'assistant', content: [{ type: 'table',
        columns: [{ align: 'left' }, { align: 'right' }],
        caption: [{ type: 'emphasis', children: [{ type: 'text', text: 'Table caption' }] }],
        headerRows: [{ cells: [{ children: [{ type: 'text', text: 'Heading' }], colSpan: 2 }] }],
        rows: [{ cells: [{ children: [{ type: 'text', text: 'A' }], rowSpan: 2 }, { children: [{ type: 'text', text: 'B' }] }] }, { cells: [{ children: [{ type: 'text', text: 'C' }] }] }],
    }] }];
    const document = composeDomainDocument(validateParserDomain(raw), account);
    assert.deepEqual(document.messages[0].blocks, [{ type: 'table', columnAlignments: ['left', 'right'],
        caption: [{ type: 'emphasis', children: [{ type: 'text', text: 'Table caption' }] }],
        headerRows: [[{ column: 0, colSpan: 2, rowSpan: 1, align: 'left', children: [{ type: 'text', text: 'Heading' }] }]],
        rows: [[{ column: 0, colSpan: 1, rowSpan: 2, align: 'left', children: [{ type: 'text', text: 'A' }] }, { column: 1, colSpan: 1, rowSpan: 1, align: 'right', children: [{ type: 'text', text: 'B' }] }], [{ column: 1, colSpan: 1, rowSpan: 1, align: 'right', children: [{ type: 'text', text: 'C' }] }]],
    }]);
});

test('all accepted roles retain structured identity; source timestamps and account profiles stay outside reading content', () => {
    const raw = input();
    raw.detail.messages = ['user', 'assistant', 'system', 'developer', 'unknown'].map(role => ({ role: role as 'user' | 'assistant' | 'system' | 'developer' | 'unknown', timestamp: 123456789, content: [] }));
    const document = composeDomainDocument(validateParserDomain(raw), { ...account, email: 'private@example.test', displayName: 'Private name' });
    assert.deepEqual(document.messages.map(m => [m.label, m.variant]), [['you', 'bubble'], ['assistant', 'flow'], ['system', 'flow'], ['developer', 'flow'], ['unknown', 'flow']]);
    assert.doesNotMatch(JSON.stringify(document), /private@example|Private name|123456789/);
});
