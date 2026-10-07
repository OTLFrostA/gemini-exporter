import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import type { DocumentAst } from '../src/core/document/ast/ast.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';

const time = '2026-10-06T00:00:00Z';
function fixture(): DomainConversationDetail {
    return JSON.parse(readFileSync('tests/fixtures/document-domain/document-markdown.json', 'utf8'));
}

function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.freeze(value); Object.values(value).forEach(freeze);
}

test('Markdown backend projects spans while the neutral tree retains all headers', () => {
    const input = fixture(); const before = JSON.stringify(input); freeze(input);
    const composed = composeDomainDocument(input);
    assert.deepEqual(composeDomainDocument(input), composed);
    assert.equal(JSON.stringify(input), before);
    const table = composed.document.messages[0].blocks[0]; assert.equal(table.type, 'table');
    if (table.type !== 'table') throw new Error('Expected table');
    assert.equal(table.headerRows.length, 2); assert.equal(table.rows.length, 1);
    assert.equal(table.headerRows[0][0].colSpan, 2); assert.equal(table.headerRows[0][0].rowSpan, 2);
    const md = renderDocumentMarkdown(composed.document, { a: 'assets/a.png' });
    assert.ok(md.includes('|  |  | Second header |'));
    assert.ok(md.includes('| :--- | ---: | :---: |'));
});

test('Markdown consumes only JSON display choices, explicit time and prepared paths', () => {
    const { document } = composeDomainDocument(fixture());
    const restored: DocumentAst = JSON.parse(JSON.stringify(document));
    const resources = { a: 'assets/a.png' };
    assert.equal(renderDocumentMarkdown(restored, resources), renderDocumentMarkdown(document, resources));
    const md = renderDocumentMarkdown(restored, resources);
    assert.ok(!md.includes('exported:')); assert.ok(md.includes('**123**'));
    assert.equal(md.match(/!\[/g)?.length, 2); assert.ok(md.includes('Preserved description'));
    restored.messages[0].heading = { level: 3, text: 'Chosen heading' };
    restored.messages[0].sources = { type: 'sources', heading: [{ type: 'text', text: 'Chosen footer' }], items: [{ id: 'ignored', label: 'Chosen source', number: 7 }] };
    const disclosure = restored.messages[0].blocks.find(block => block.type === 'disclosure');
    if (!disclosure || disclosure.type !== 'disclosure') throw new Error('Expected disclosure');
    disclosure.title = 'Chosen disclosure'; disclosure.initiallyCollapsed = false;
    const changed = renderDocumentMarkdown(restored, resources);
    assert.ok(changed.includes('### Chosen heading')); assert.ok(changed.includes('> Chosen footer\n> [7] [Chosen source]'));
    assert.ok(changed.includes('<details open>\n<summary>Chosen disclosure</summary>'));
    assert.ok(renderDocumentMarkdown(document, {}).includes('[Image unavailable:'));
    assert.ok(renderDocumentHtml(document, resources).html.includes('<strong>123</strong>'));
});

test('Markdown composition owns unavailability and emits diagnostics without remote embedding', () => {
    const { document, diagnostics } = composeDomainDocument(fixture());
    assert.equal(diagnostics.length, 0);
    const output = renderDocumentMarkdown(document, {});
    assert.ok(output.includes('[Image unavailable:')); assert.ok(output.includes('**123**'));
    assert.ok(!output.includes('https://remote'));
    assert.deepEqual(composeDomainDocument(fixture()).document, document);
});

test('Markdown backend cannot import semantic models, registries or clocks', () => {
    const code = readFileSync('src/core/renderers/markdown/renderMarkdown.ts', 'utf8');
    assert.doesNotMatch(code, /canonical\/|content\/|provider\/|Domain|Canonical|assetPresentation|citationDisplayLabel|new Date|\.role\b|\.storageRef\b/);
    assert.match(code, /function projectedTable/);
});

test('Markdown front matter preserves string scalars and rejects invalid keys', () => {
    const { document } = composeDomainDocument(fixture());
    const frontMatter = [{ key: 'tags', value: ['true', 'null', 'yes', 'example-export'] }];
    assert.ok(renderDocumentMarkdown(document, {}, { frontMatter }).includes('tags:\n  - "true"\n  - "null"\n  - "yes"\n  - example-export'));
    const invalid = [{ key: 'bad\nkey', value: 'value' }];
    assert.throws(() => renderDocumentMarkdown(document, {}, { frontMatter: invalid }), /Invalid front matter key/);
});
