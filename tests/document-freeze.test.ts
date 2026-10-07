import test from 'node:test';
import assert from 'node:assert/strict';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import type { DocumentAst, DisplayInline, DisplayBlock } from '../src/core/document/ast/ast.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { fileBadge } from '../src/core/renderers/shared/backendPresentation.js';
import { renderMathHtml } from '../src/core/renderers/html/htmlMath.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { renderDocumentTypst } from '../src/core/renderers/typst/renderTypst.js';
import { collectDocumentResources } from '../src/core/document/ast/resourceReferences.js';
import { preparePdfResources } from '../src/core/export/pdf/prepareResources.js';
import { parseProviderConversation } from '../src/core/compatibility/conversationParser.js';

function domain(): DomainConversationDetail {
    return { providerId: 'custom', id: 'freeze', title: 'Boundary', timestamp: null, assets: [], messages: [
        { id: 'same unsafe / " identity', role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Question '.repeat(40) }] }] },
        { id: 'answer', role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Answer' }] }] },
    ] };
}
function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.values(value).forEach(freeze); Object.freeze(value);
}

test('HTML owns DOM identities and does not derive document language from UI locale', () => {
    const document = composeDomainDocument(domain()).document;
    assert.ok(document.messages.every(message => !('anchor' in message) && !('modelLabel' in message)));
    for (const locale of ['en', 'zh'] as const) {
        const html = renderDocumentHtml(document, {}, { locale }).html;
        assert.match(html, /<html>/);
        assert.match(html, /id="turn-user-0"/);
        assert.match(html, /id="prompt-turn-user-0"/);
        assert.match(html, /id="turn-model-1"/);
    }
    document.documentLanguage = 'ja';
    assert.match(renderDocumentHtml(document, {}, { locale: 'zh' }).html, /<html lang="ja">/);
});

test('file badges use only supplied media type or kind, including misleading labels', () => {
    const file: Extract<DisplayBlock, { type: 'file' }> = { type: 'file', resourceId: 'f', label: 'misleading.pdf', kind: 'file' };
    assert.equal(fileBadge(file), 'FILE');
    assert.equal(fileBadge({ ...file, label: 'renamed.exe', mediaType: 'application/x-zip' }), 'ZIP');
    const document = composeDomainDocument(domain()).document;
    document.messages[0].blocks = [file, { ...file, mediaType: 'text/plain' }];
    const html = renderDocumentHtml(document, { f: 'assets/f' }).html;
    assert.match(html, /gem-att-badge">FILE<\/span>/);
    assert.match(html, /gem-att-badge">TXT<\/span>/);
    const pdf = renderDocumentTypst(document, {});
    assert.deepEqual(pdf.messages[0].blocks.map(block => block.type === 'file' && block.kind), ['FILE', 'TXT']);
});

test('display date selects the first valid fact and normalizes to UTC at composition', () => {
    const input = domain();
    Object.assign(input, { updatedAt: '2026-10-06T23:30:00-07:00', lastSeen: '2026-10-05', createdAt: '2026-10-04', timestamp: Date.parse('2026-10-03'), chatTime: '2026-10-02' });
    for (const [field, expected] of [['updatedAt', '2026-10-07'], ['lastSeen', '2026-10-05'], ['createdAt', '2026-10-04'], ['timestamp', '2026-10-03'], ['chatTime', '2026-10-02']] as const) {
        const document = composeDomainDocument(input).document;
        assert.equal(document.header.date, expected);
        assert.ok(renderDocumentHtml(document, {}).html.includes(expected));
        assert.ok(renderDocumentTypst(document, {}).metadata.includes(expected));
        Object.assign(input, { [field]: field === 'timestamp' ? null : 'invalid' });
    }
    assert.equal(composeDomainDocument(input).document.header.date, undefined);
    const source = { id: 'c', title: 'T', updatedAt: '2026-10-06T23:30:00-07:00', createdAt: '2026-10-04', messages: [{ id: 'a', role: 'model', author: { model: 'provider only' }, content: '' }] };
    assert.equal(composeDomainDocument(parseProviderConversation(source).conversation).document.header.date, '2026-10-07');
    source.updatedAt = 'invalid';
    const document = composeDomainDocument(parseProviderConversation(source).conversation).document;
    assert.equal(document.header.date, '2026-10-04');
    assert.equal(document.messages[0].modelLabel, 'provider only');
    assert.equal(renderDocumentTypst(document, {}).messages[0].model, 'provider only');
});

test('parser removes math delimiters; HTML renders source verbatim and preserves malformed source', () => {
    const parsed = parseProviderConversation({ id: 'math', messages: [{ role: 'model', content: '$x^2$\n\n$$\ny^2\n$$' }] });
    const document = composeDomainDocument(parsed.conversation).document;
    assert.deepEqual(document.messages[0].blocks, [
        { type: 'paragraph', children: [{ type: 'inlineMath', source: 'x^2' }] }, { type: 'math', source: 'y^2' },
    ]);
    assert.equal(renderDocumentHtml(document, {}).diagnostics.length, 0);
    for (const source of ['$x^2$', '$$y^2$$', '  $z^2$  ']) {
        const result = renderMathHtml(source, true, 'Formula');
        assert.equal(result.diagnostic?.code, 'HTML_MATH_RENDER_FAILED');
        assert.ok(result.html.includes(`<code>${source}</code>`));
    }
});

test('PDF acquires every AST image; one frozen rich JSON AST serves all backends', async () => {
    const input = domain();
    const inline = (id: string) => ({ type: 'image' as const, assetId: id, alt: id });
    const rendered = ['main', 'inline', 'heading', 'header', 'cell', 'nested'];
    const rich = ['image-caption', 'table-caption', 'description', 'source-heading', 'details'];
    input.assets = [...rendered, ...rich].map(id => ({ id, kind: 'image', source: { uri: `https://example.test/${id}` } }));
    input.assets.push({ id: 'file', kind: 'file' });
    input.messages[1].content = [
        { type: 'image', assetId: 'main', caption: [inline('image-caption')] },
        { type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'link', href: '/', children: [inline('inline')] }] }] },
        { type: 'heading', level: 2, children: [inline('heading')] },
        { type: 'table', caption: [inline('table-caption')], headerRows: [{ cells: [{ children: [inline('header')] }] }], rows: [{ cells: [{ children: [inline('cell')] }] }] },
        { type: 'quote', blocks: [{ type: 'list', ordered: false, items: [{ blocks: [{ type: 'thought', disclosure: 'providerExposed', blocks: [{ type: 'paragraph', children: [inline('nested')] }] }] }] }] },
        { type: 'file', assetId: 'file', description: [inline('description'), inline('inline')] },
    ];
    freeze(input);
    const document: DocumentAst = JSON.parse(JSON.stringify(composeDomainDocument(input).document));
    document.messages[1].sources = { type: 'sources', heading: [{ type: 'image', resourceId: 'source-heading', alt: 'source-heading' }], items: [] };
    const detail: DisplayInline = { type: 'image', resourceId: 'details', alt: 'details' };
    document.messages[1].blocks.push({ type: 'placeholder', kind: 'image', resourceId: 'missing', text: 'Missing', details: [detail] });
    freeze(document);
    const before = JSON.stringify(document);
    const imageIds = collectDocumentResources(document).imageIds;
    assert.deepEqual([...imageIds].sort(), [...rendered, ...rich].sort());
    assert.equal(collectDocumentResources(document).imageIds.size, rendered.length + rich.length);
    const acquired: string[] = [];
    const prepared = await preparePdfResources(input, imageIds, {}, { acquire: async id => {
        acquired.push(id);
        return { ok: true, bytes: new Uint8Array([1]), mimeType: 'image/png', failReason: '', recoveredFromTakeout: false, localName: `${id}.png` };
    } });
    assert.deepEqual(acquired.sort(), [...rendered, ...rich].sort());
    for (const id of rich) assert.equal(prepared.resources.get(id)?.bytes?.length, 1);
    const bindings = Object.fromEntries([...collectDocumentResources(document).referencedIds].map(id => [id, `assets/${id}.png`]));
    assert.ok(renderDocumentHtml(document, bindings).html.includes('src="assets/image-caption.png"'));
    assert.ok(renderDocumentMarkdown(document, bindings).includes('assets/image-caption.png'));
    const pdf = renderDocumentTypst(document, Object.fromEntries([...imageIds].map(id => [id, bindings[id]])));
    assert.deepEqual(pdf.messages[1].blocks[0].type === 'image' && pdf.messages[1].blocks[0].caption, [{ type: 'image', asset: bindings['image-caption'], alt: 'image-caption' }]);
    assert.deepEqual(pdf.messages[1].blocks[3].type === 'table' && pdf.messages[1].blocks[3].caption, [{ type: 'image', asset: bindings['table-caption'], alt: 'table-caption' }]);
    assert.deepEqual(pdf.messages[1].blocks[5].type === 'file' && pdf.messages[1].blocks[5].description, ['description', 'inline'].map(id => ({ type: 'image', asset: bindings[id], alt: id })));
    assert.deepEqual(pdf.messages[1].blocks[6].type === 'unknown' && pdf.messages[1].blocks[6].details, [{ type: 'image', asset: bindings.details, alt: 'details' }]);
    assert.ok(JSON.stringify(pdf.messages[1].blocks[7]).includes(bindings['source-heading']));
    assert.equal(JSON.stringify(document), before);
});
