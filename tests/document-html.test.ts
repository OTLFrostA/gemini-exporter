import { historicalFixture } from './helpers/nativeFixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import type { DocumentAst } from '../src/core/document/ast/ast.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { formatHtmlDocument } from '../src/core/engine/chatFormatter.js';

function fixture(): DomainConversationDetail {
    return JSON.parse(readFileSync('tests/fixtures/document-domain/document-html.json', 'utf8'));
}

function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.freeze(value);
    Object.values(value).forEach(freeze);
}

test('HTML consumes the neutral composition and preserves immutable semantic input', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    freeze(input);
    const resources = Object.freeze({ img: 'assets/img.png' });
    const first = composeDomainDocument(input);
    assert.deepEqual(composeDomainDocument(input), first);
    assert.equal(JSON.stringify(input), before);
    const { document } = first;
    assert.equal(document.header.providerLabel, 'example');
    assert.equal(document.messages[0].variant, 'bubble');
    assert.ok(renderDocumentHtml(document, resources, { locale: 'en' }).html.includes('Show more'));
    const disclosure = document.messages[1].blocks[0];
    assert.equal(disclosure.type, 'disclosure');
    if (disclosure.type === 'disclosure') {
        assert.equal(disclosure.kind, 'reasoning');
        assert.equal(disclosure.initiallyCollapsed, undefined);
    }
    assert.deepEqual(document.messages[1].sources?.items, [{ id: 'a:c1', label: 'Source', href: 'https://example.com', number: 1 }]);
    assert.equal(document.messages[1].blocks.filter(b => b.type === 'image').length, 2, 'registry identity never deduplicates placements');
    assert.ok(renderDocumentHtml(document, resources).html.includes('<strong>123</strong>'), 'explicit caption is not tested as a filename');
});

test('JSON roundtrip and explicit presentation edits work without semantic input', () => {
    const resources = { img: 'assets/img.png' };
    const { document } = composeDomainDocument(fixture());
    const restored: DocumentAst = JSON.parse(JSON.stringify(document));
    assert.deepEqual(restored, document);
    assert.deepEqual(renderDocumentHtml(restored, resources), renderDocumentHtml(document, resources));
    restored.header.providerLabel = 'Custom metadata';
    restored.messages[0].variant = 'flow';
    restored.messages[1].sources = { type: 'sources', items: [{ id: 'chosen', label: 'Chosen source' }] };
    const disclosure = restored.messages[1].blocks[0];
    assert.equal(disclosure.type, 'disclosure');
    if (disclosure.type === 'disclosure') disclosure.title = 'Chosen title';
    const html = renderDocumentHtml(restored, resources).html;
    assert.ok(html.includes('Custom metadata'));
    assert.ok(!html.includes('<div class="gem-user-bubble">'), 'renderer must not recompute bubble from a source role');
    assert.ok(html.includes('Chosen source') && html.includes('Chosen title'));
    assert.ok(!html.includes('gem-citation-chip" href="https://example.com'), 'renderer must not rebuild a source footer from registry');
});

test('table alignment follows logical columns for colSpan and rowSpan', () => {
    const input = fixture();
    input.messages[0].content = [{ type: 'table', columns: [{ align: 'left' }, { align: 'right' }, { align: 'center' }], rows: [
        { cells: [{ children: [{ type: 'text', text: 'span' }], colSpan: 2, rowSpan: 2 }, { children: [{ type: 'text', text: 'last' }] }] },
        { cells: [{ children: [{ type: 'text', text: 'under' }] }] },
    ] }];
    const { document } = composeDomainDocument(input);
    const table = document.messages[0].blocks[0];
    assert.equal(table.type, 'table');
    if (table.type === 'table') {
        assert.equal(table.rows[0][1].column, 2);
        assert.equal(table.rows[0][1].align, 'center');
        assert.equal(table.rows[1][0].column, 2);
        assert.equal(table.rows[1][0].align, 'center');
    }
    assert.ok(renderDocumentHtml(document, { img: 'assets/img.png' }).html.includes('style="text-align:center">under'));
});

test('backend decides unavailable resources, preserves caption, and keeps nested diagnostics', () => {
    const { document, diagnostics } = composeDomainDocument(fixture());
    assert.equal(diagnostics.length, 0);
    assert.ok(renderDocumentHtml(document, {}).diagnostics.some(d => d.code === 'HTML_ASSET_UNRESOLVED'));
    const html = renderDocumentHtml(document, {}).html;
    assert.ok(html.includes('gem-missing-inline'));
    assert.ok(html.includes('<strong>123</strong>'));
    assert.ok(!html.includes('<img'));
    assert.ok(renderDocumentHtml(document, {}).diagnostics.some(d => d.code === 'HTML_UNKNOWN_BLOCK'));
});

test('renderer requires prepared bindings and escapes text and URL attributes', () => {
    const { document } = composeDomainDocument(fixture());
    assert.ok(renderDocumentHtml(document, {}).html.includes('gem-missing-asset'));
    const html = renderDocumentHtml(document, { img: 'assets/a" onload="evil.png' }).html;
    assert.ok(html.includes('&quot;'));
    assert.ok(!html.includes('src="assets/a" onload='));
    assert.ok(html.includes('&lt;x&gt;'));
    document.messages[0].blocks = [{ type: 'paragraph', children: [{ type: 'link', href: 'https://example.com?a=1&b=2', children: [{ type: 'text', text: 'Query' }] }] }];
    const queryHtml = renderDocumentHtml(document, { img: 'assets/img.png' }).html;
    assert.ok(queryHtml.includes('href="https://example.com?a=1&amp;b=2"'));
    assert.ok(!queryHtml.includes('&amp;amp;'));
});

test('empty state is composed and locale is explicit', () => {
    const input = fixture(); input.messages = [];
    const { document } = composeDomainDocument(input);
    assert.equal(document.emptyNotice, undefined);
    assert.ok(renderDocumentHtml(document, {}, { locale: 'en' }).html.includes('Empty conversation or fetch failed.'));
    document.emptyNotice = 'A different notice';
    assert.ok(renderDocumentHtml(document, {}).html.includes('A different notice'));
});

test('actual HTML backend has no semantic model or presentation inference imports', () => {
    const source = readFileSync('src/core/renderers/html/renderHtml.ts', 'utf8');
    assert.doesNotMatch(source, /CanonicalConversationBundle|MessageRole|assetPresentation|citationDisplayLabel|extractBlockText|\.role\b|new Date\(/);
    assert.doesNotMatch(source, /from ['"][^'"]*(?:domain|provider|canonical)/);
});

test('production HTML facade uses prepared archive paths consistently', async () => {
    const result = await formatHtmlDocument(historicalFixture({ id: 'production', title: 'Production', messages: [{ role: 'model', content: 'Body', attachments: [{ type: 'image', localName: 'assets/p.png', name: 'p.png' }] }] }));
    assert.ok(result.content.includes('assets/p.png'));
    assert.ok(!result.content.includes('gem-missing-asset">'));
});

test('backend accepts safe custom bindings and reports unsafe bindings as unavailable', () => {
    const { document } = composeDomainDocument(fixture());
    const custom = renderDocumentHtml(document, { img: 'assets/custom.png' });
    assert.deepEqual(custom.diagnostics.filter(d => d.code === 'HTML_ASSET_UNRESOLVED'), []);
    assert.ok(custom.html.includes('src="assets/custom.png"'));
    const unsafe = renderDocumentHtml(document, { img: 'javascript:alert(1)' });
    assert.ok(unsafe.diagnostics.some(d => d.code === 'HTML_ASSET_UNRESOLVED'));
    assert.ok(!unsafe.html.includes('javascript:'));
    assert.ok(unsafe.html.includes('gem-missing-inline'));
});
