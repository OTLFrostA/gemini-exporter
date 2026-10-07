import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CanonicalConversationBundle } from '../src/core/export/canonical/conversation.js';
import type { DocumentAst } from '../src/core/export/document/ast.js';
import { composeHtmlDocument } from '../src/core/export/document/composeHtml.js';
import { renderDocumentHtml } from '../src/core/export/document/renderHtml.js';
import { renderCanonicalHtml, CanonicalHtmlRenderer } from '../src/core/export/canonical/renderCanonicalHtml.js';
import { formatHtmlCanonical } from '../src/core/engine/chatFormatter.js';

function fixture(): CanonicalConversationBundle {
    return {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'example', accountId: 'a', conversationId: 'c' }, title: 'A conversation', createdAt: '2026-10-06T12:00:00Z',
            messages: [
                { id: 'u', role: 'user', blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Long prompt '.repeat(30) }] }] },
                { id: 'a', role: 'assistant', citationIds: ['c1'], blocks: [
                    { type: 'thought', disclosure: 'providerExposed', kind: 'reasoning', blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Thinking' }] }] },
                    { type: 'code', code: '<x>', language: 'xml', filename: 'sample.xml', meta: 'example' },
                    { type: 'image', assetId: 'img', caption: [{ type: 'strong', children: [{ type: 'text', text: '123' }] }] },
                    { type: 'image', assetId: 'img', alt: 'Same image again' },
                    { type: 'paragraph', children: [{ type: 'citationRef', citationId: 'c1' }, { type: 'image', assetId: 'img', title: 'inline' }] },
                    { type: 'unknown', sourceType: 'future', text: 'Keep this' },
                ] },
            ],
        },
        assets: [{ id: 'img', kind: 'image', name: 'asset_987654.png', status: 'available', storageRef: 'assets/img.png' }],
        citations: [{ id: 'c1', kind: 'web', title: 'Source', url: 'https://example.com' }],
    };
}

function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.freeze(value);
    Object.values(value).forEach(freeze);
}

test('HTML composition carries all display decisions and preserves immutable semantic input', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    freeze(input);
    const resources = Object.freeze({ img: 'assets/img.png' });
    const first = composeHtmlDocument(input, resources, { lang: 'en', thoughtInitiallyCollapsed: true });
    assert.deepEqual(composeHtmlDocument(input, resources, { lang: 'en', thoughtInitiallyCollapsed: true }), first);
    assert.equal(JSON.stringify(input), before);
    const { document } = first;
    assert.equal(document.header.metadata, 'example · 2026-10-06 · 2 messages');
    assert.equal(document.messages[0].variant, 'bubble');
    assert.equal(document.messages[0].folding?.initiallyCollapsed, true);
    assert.equal(document.messages[0].folding?.moreLabel, 'Show more');
    const disclosure = document.messages[1].blocks[0];
    assert.equal(disclosure.type, 'disclosure');
    if (disclosure.type === 'disclosure') {
        assert.equal(disclosure.title, 'Thinking Process');
        assert.equal(disclosure.initiallyCollapsed, true);
    }
    assert.deepEqual(document.messages[1].sources?.items, [{ id: 'c1', label: 'Source', href: 'https://example.com' }]);
    assert.equal(document.messages[1].blocks.filter(b => b.type === 'image').length, 2, 'registry identity never deduplicates placements');
    assert.ok(renderDocumentHtml(document, resources).html.includes('<strong>123</strong>'), 'explicit caption is not tested as a filename');
});

test('JSON roundtrip and explicit presentation edits work without semantic input', () => {
    const resources = { img: 'assets/img.png' };
    const { document } = composeHtmlDocument(fixture(), resources);
    const restored: DocumentAst = JSON.parse(JSON.stringify(document));
    assert.deepEqual(restored, document);
    assert.deepEqual(renderDocumentHtml(restored, resources), renderDocumentHtml(document, resources));
    restored.header.metadata = 'Custom metadata';
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
    input.conversation.messages[0].blocks = [{ type: 'table', columns: [{ align: 'left' }, { align: 'right' }, { align: 'center' }], rows: [
        { cells: [{ children: [{ type: 'text', text: 'span' }], colSpan: 2, rowSpan: 2 }, { children: [{ type: 'text', text: 'last' }] }] },
        { cells: [{ children: [{ type: 'text', text: 'under' }] }] },
    ] }];
    const { document } = composeHtmlDocument(input, { img: 'assets/img.png' });
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

test('composition decides unavailable resources, preserves caption, and keeps nested diagnostics', () => {
    const { document, diagnostics } = composeHtmlDocument(fixture(), {});
    assert.ok(diagnostics.some(d => d.code === 'HTML_ASSET_UNRESOLVED'));
    assert.ok(diagnostics.some(d => d.code === 'HTML_UNKNOWN_BLOCK'));
    const html = renderDocumentHtml(document, {}).html;
    assert.ok(html.includes('gem-missing-inline'));
    assert.ok(html.includes('<strong>123</strong>'));
    assert.ok(!html.includes('<img'));
    assert.equal(renderDocumentHtml(document, {}).diagnostics.length, 0, 'semantic diagnostics belong to composition');
});

test('renderer requires prepared bindings and escapes text and URL attributes', () => {
    const { document } = composeHtmlDocument(fixture(), { img: 'assets/img.png' });
    assert.throws(() => renderDocumentHtml(document, {}), /Missing prepared resource binding/);
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
    const input = fixture(); input.conversation.messages = [];
    const { document } = composeHtmlDocument(input, {}, { lang: 'en' });
    assert.equal(document.emptyNotice, 'Empty conversation or fetch failed.');
    document.emptyNotice = 'A different notice';
    assert.ok(renderDocumentHtml(document, {}).html.includes('A different notice'));
});

test('actual HTML backend has no semantic model or presentation inference imports', () => {
    const source = readFileSync('src/core/export/document/renderHtml.ts', 'utf8');
    assert.doesNotMatch(source, /CanonicalConversationBundle|MessageRole|assetPresentation|citationDisplayLabel|extractBlockText|\.role\b|new Date\(/);
    assert.doesNotMatch(source, /from ['"][^'"]*(?:domain|provider|canonical)/);
});

test('compatibility adapter and production facade use prepared paths consistently', async () => {
    const input = fixture();
    assert.ok(renderCanonicalHtml(input).html.includes('assets/img.png'));
    const artifact = await new CanonicalHtmlRenderer().render({ bundle: input, locale: 'en', signal: new AbortController().signal,
        reportProgress() {}, assets: { resolve: async id => id === 'img' ? { asset: input.assets[0], renderUrl: 'assets/ready.png' } : null } });
    assert.deepEqual(artifact.companionResourceIds, ['img']);
    assert.ok(String(artifact.content).includes('assets/ready.png'));
    const result = await formatHtmlCanonical({ id: 'production', title: 'Production', messages: [{ role: 'model', content: 'Body', attachments: [{ type: 'image', localName: 'assets/p.png', name: 'p.png' }] }] });
    assert.ok(result.content.includes('assets/p.png'));
    assert.ok(!result.content.includes('gem-missing-asset">'));
});

test('resource readiness and companion plan cannot contradict custom or unsafe bindings', async () => {
    const input = fixture();
    const context = { bundle: input, locale: 'en' as const, signal: new AbortController().signal,
        reportProgress() {}, assets: { resolve: async () => null } };
    const custom = await new CanonicalHtmlRenderer({ assetUrl: () => 'assets/custom.png' }).render(context);
    assert.deepEqual(custom.companionResourceIds, ['img']);
    assert.deepEqual(custom.companionPlan?.omitted, []);
    assert.ok(String(custom.content).includes('src="assets/custom.png"'));
    const unsafe = await new CanonicalHtmlRenderer({ assetUrl: () => 'javascript:alert(1)' }).render(context);
    assert.deepEqual(unsafe.companionResourceIds, []);
    assert.deepEqual(unsafe.companionPlan?.omitted, [{ resourceId: 'img', reason: 'unresolvable' }]);
    assert.ok(!String(unsafe.content).includes('javascript:'));
    assert.ok(String(unsafe.content).includes('gem-missing-inline'));
});
