import { fixtureAccountFor } from './helpers/domainFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
import type { DocumentAst } from '../src/core/document/ast/ast.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';

const time = '2026-10-06T00:00:00Z';
function fixture(): DomainConversationWithDetail {
    return JSON.parse(readFileSync('tests/fixtures/document-domain/document-markdown.json', 'utf8'));
}

function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.freeze(value); Object.values(value).forEach(freeze);
}

test('Markdown backend projects spans while the neutral tree retains all headers', () => {
    const input = fixture(); const before = JSON.stringify(input); freeze(input);
    const composed = composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input)));
    assert.deepEqual(composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input))), composed);
    assert.equal(JSON.stringify(input), before);
    const table = composed.document.messages[0].blocks.find(block => block.type === 'table')!; assert.equal(table.type, 'table');
    if (table.type !== 'table') throw new Error('Expected table');
    assert.equal(table.headerRows.length, 2); assert.equal(table.rows.length, 1);
    assert.equal(table.headerRows[0][0].colSpan, 2); assert.equal(table.headerRows[0][0].rowSpan, 2);
    const md = renderDocumentMarkdown(composed.document, { a: 'assets/a.png' });
    assert.ok(md.includes('|  |  | Second header |'));
    assert.ok(md.includes('| :--- | ---: | :---: |'));
});

test('Markdown consumes only JSON display choices, explicit time and prepared paths', () => {
    const { document } = composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture())));
    const restored: DocumentAst = JSON.parse(JSON.stringify(document));
    const resources = { a: 'assets/a.png' };
    assert.equal(renderDocumentMarkdown(restored, resources), renderDocumentMarkdown(document, resources));
    const md = renderDocumentMarkdown(restored, resources);
    assert.ok(!md.includes('exported:')); assert.ok(md.includes('**123**'));
    assert.equal(md.match(/!\[/g)?.length, 2); assert.ok(md.includes('Preserved description'));
    restored.messages[0].label = 'developer';
    restored.messages[0].sources = { type: 'sources', items: [{ id: 'ignored', label: 'Chosen source', number: 7 }] };
    const disclosure = restored.messages[0].blocks.find(block => block.type === 'disclosure');
    if (!disclosure || disclosure.type !== 'disclosure') throw new Error('Expected disclosure');
    disclosure.title = 'Chosen disclosure';
    const changed = renderDocumentMarkdown(restored, resources, { thoughtInitiallyCollapsed: false });
    assert.ok(changed.includes('## 🛠 Developer')); assert.ok(changed.includes('> 🌐 **Sources:**\n> [7] [Chosen source]'));
    assert.ok(changed.includes('<details open>\n<summary>Chosen disclosure</summary>'));
    assert.ok(renderDocumentMarkdown(document, {}).includes('[Image unavailable:'));
    assert.ok(renderDocumentHtml(document, resources).html.includes('<strong>123</strong>'));
});

test('Markdown renderer owns unavailability and emits diagnostics without remote embedding', () => {
    const { document, diagnostics } = composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture())));
    assert.equal(diagnostics.length, 0);
    const output = renderDocumentMarkdown(document, {});
    assert.ok(output.includes('[Image unavailable:')); assert.ok(output.includes('**123**'));
    assert.ok(!output.includes('https://remote'));
    assert.deepEqual(composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture()))).document, document);
});

test('Markdown renderer cannot depend on provider, Domain or storage services', () => {
    const code = readFileSync('src/core/renderers/markdown/renderMarkdown.ts', 'utf8');
    // This is a module-boundary policy, not a check for literal words or function names.
    const dependencies = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
    assert.ok(dependencies.length > 0, 'module import scan must find the real renderer dependencies');
    for (const dependency of dependencies) {
        assert.doesNotMatch(dependency, /(?:^|\/)(?:domain|parsers|storage|provider|api|engine)(?:\/|$)/,
            'Markdown rendering must consume Document AST instead of source-side services');
    }
    assert.doesNotMatch(code, /\b(?:new\s+Date|Date\.now)\s*\(/, 'renderers must use supplied timestamps');
    assert.doesNotMatch(code, /\.(?:role|storageRef)\b/, 'renderers must not inspect Domain or storage-only fields');
});

test('Markdown front matter reads identity and source dates only from Document AST', () => {
    const input = fixture(); input.index.updatedAt = 1000;
    const { document } = composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input)));
    document.header.title = 'true';
    document.metadata!.id = 'null';
    document.metadata!.url = 'https://example.test/accepted';
    const markdown = renderDocumentMarkdown(document, {}, { includeFrontMatter: true, exportedAt: time });
    assert.ok(markdown.includes('title: "true"'));
    assert.ok(markdown.includes('id: "null"'));
    assert.ok(markdown.includes('url: "https://example.test/accepted"'));
    assert.ok(markdown.includes('updated: "1970-01-01T00:00:01.000Z"'));
    assert.ok(markdown.includes(`exported: "${time}"`));
    // @ts-expect-error Metadata is required; still reject malformed runtime callers explicitly.
    assert.throws(() => renderDocumentMarkdown({ ...document, metadata: undefined }, {}, { includeFrontMatter: true }), /metadata is required/);
});
