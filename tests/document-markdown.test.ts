import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CanonicalConversationBundle } from '../src/core/export/canonical/conversation.js';
import type { DocumentAst } from '../src/core/export/document/ast.js';
import { composeMarkdownDocument } from '../src/core/export/document/composeMarkdown.js';
import { renderDocumentMarkdown } from '../src/core/export/document/renderMarkdown.js';
import { renderDocumentHtml } from '../src/core/export/document/renderHtml.js';

const time = '2026-10-06T00:00:00Z';
function fixture(): CanonicalConversationBundle {
    return { schemaVersion: 1, conversation: { key: { providerId: 'example', accountId: 'a', conversationId: 'c' }, title: 'Title', messages: [{ id: 'm', role: 'system', citationIds: ['c'], blocks: [
        { type: 'table', columns: [{ align: 'left' }, { align: 'right' }, { align: 'center' }], headerRows: [
            { cells: [{ children: [{ type: 'text', text: 'A' }], colSpan: 2, rowSpan: 2 }, { children: [{ type: 'text', text: 'B' }] }] },
            { cells: [{ children: [{ type: 'text', text: 'Second header' }] }] },
        ], rows: [{ cells: [{ children: [{ type: 'text', text: 'Body' }], colSpan: 3 }] }] },
        { type: 'image', assetId: 'a', caption: [{ type: 'strong', children: [{ type: 'text', text: '123' }] }] },
        { type: 'image', assetId: 'a', alt: 'Again' },
        { type: 'file', assetId: 'missing', description: [{ type: 'text', text: 'Preserved description' }] },
        { type: 'thought', disclosure: 'providerExposed', kind: 'summary', blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'reason' }] }] },
    ] }] }, assets: [{ id: 'a', kind: 'image', name: 'asset_987654.png', status: 'available', storageRef: 'assets/a.png' }], citations: [{ id: 'c', kind: 'web', title: 'Source', url: 'https://example.com' }] };
}
function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.freeze(value); Object.values(value).forEach(freeze);
}

test('Markdown projection resolves spans and extra headers before serialization', () => {
    const input = fixture(); const before = JSON.stringify(input); freeze(input);
    const composed = composeMarkdownDocument(input, { a: 'assets/a.png' }, { exportedAt: time });
    assert.deepEqual(composeMarkdownDocument(input, { a: 'assets/a.png' }, { exportedAt: time }), composed);
    assert.equal(JSON.stringify(input), before);
    const table = composed.document.messages[0].blocks[0]; assert.equal(table.type, 'table');
    if (table.type !== 'table') throw new Error('Expected table');
    assert.equal(table.headerRows.length, 1); assert.equal(table.rows.length, 2);
    assert.deepEqual(table.rows[0].map(cell => cell.children), [[], [], [{ type: 'text', text: 'Second header' }]]);
    for (const row of [...table.headerRows, ...table.rows]) {
        assert.equal(row.length, 3); assert.ok(row.every(cell => cell.colSpan === 1 && cell.rowSpan === 1));
    }
    const md = renderDocumentMarkdown(composed.document, { a: 'assets/a.png' });
    assert.ok(md.includes('|  |  | Second header |'));
    assert.ok(md.includes('| :--- | ---: | :---: |'));
});

test('Markdown consumes only JSON display choices, explicit time and prepared paths', () => {
    const { document } = composeMarkdownDocument(fixture(), { a: 'assets/a.png' }, { exportedAt: time });
    const restored: DocumentAst = JSON.parse(JSON.stringify(document));
    const resources = { a: 'assets/a.png' };
    assert.equal(renderDocumentMarkdown(restored, resources), renderDocumentMarkdown(document, resources));
    const md = renderDocumentMarkdown(restored, resources);
    assert.ok(md.includes(`exported: "${time}"`)); assert.ok(md.includes('**123**'));
    assert.equal(md.match(/!\[/g)?.length, 2); assert.ok(md.includes('Preserved description'));
    restored.messages[0].heading = { level: 3, text: 'Chosen heading' };
    restored.messages[0].sources = { type: 'sources', heading: [{ type: 'text', text: 'Chosen footer' }], items: [{ id: 'ignored', label: 'Chosen source', prefix: '[7]' }] };
    const disclosure = restored.messages[0].blocks.find(block => block.type === 'disclosure');
    if (!disclosure || disclosure.type !== 'disclosure') throw new Error('Expected disclosure');
    disclosure.title = 'Chosen disclosure'; disclosure.initiallyCollapsed = false;
    const changed = renderDocumentMarkdown(restored, resources);
    assert.ok(changed.includes('### Chosen heading')); assert.ok(changed.includes('> Chosen footer\n> [7] [Chosen source]'));
    assert.ok(changed.includes('<details open>\n<summary>Chosen disclosure</summary>'));
    assert.throws(() => renderDocumentMarkdown(document, {}), /Missing prepared resource/);
    assert.throws(() => renderDocumentHtml(document, resources), /HTML document profile/);
});

test('Markdown composition owns unavailability and emits diagnostics without remote embedding', () => {
    const { document, diagnostics } = composeMarkdownDocument(fixture(), { a: 'https://remote/pic.png' }, { exportedAt: time });
    assert.ok(diagnostics.some(d => d.code === 'MARKDOWN_ASSET_UNRESOLVED'));
    const output = renderDocumentMarkdown(document, {});
    assert.ok(output.includes('[Image unavailable:')); assert.ok(output.includes('**123**'));
    assert.ok(!output.includes('https://remote'));
    assert.throws(() => composeMarkdownDocument(fixture(), {}, { exportedAt: '' }), /explicit export time/);
});

test('Markdown backend cannot import semantic models, registries or clocks', () => {
    const code = readFileSync('src/core/export/document/renderMarkdown.ts', 'utf8');
    assert.doesNotMatch(code, /canonical\/|content\/|provider\/|Domain|Canonical|assetPresentation|citationDisplayLabel|new Date|\.role\b|\.storageRef\b/);
    assert.doesNotMatch(code, /colSpan\s*\?\?|rowSpan\s*\?\?|headerRows\?\.slice/);
});
