import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import assert from "node:assert/strict";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import { type DomainConversationWithDetail } from "../src/l2/conversation.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { renderDocumentTypst } from "./helpers/renderTypstFixture.js";
import { renderTypstFixture } from "./helpers/renderTypstFixture.js";
import { unavailableResourceText } from "../src/l4/format/shared/backendPresentation.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { historicalFixture } from "./helpers/nativeFixture.js";
import { type DocumentAst } from "../src/l3b/ast/ast.js";
import { type DisplayInline } from "../src/l3b/ast/ast.js";
import { type DisplayBlock } from "../src/l3b/ast/ast.js";
import { fileBadge } from "../src/l4/format/shared/backendPresentation.js";
import { renderMathHtml } from "../src/l4/format/html/htmlMath.js";
import { collectDocumentResources } from "../src/l3b/ast/resourceReferences.js";
import { test as test__s3 } from "node:test";
import { readFileSync } from "node:fs";
import { defaultPdfLayout } from "./helpers/renderTypstFixture.js";
import { fixtureResourceResults } from "./helpers/documentFixture.js";
import fs from "node:fs";
import path from "node:path";
import { closeSourceCitations } from "../src/l1/parsers/shared/resources/domainCitationAdapter.js";
import { historicalFixtureDomain } from "./helpers/nativeFixture.js";
import { restoreDomainSnapshot } from "../src/l2/runtimeValidation.js";

__suiteDescribe("document-ast-integration", () => {
const account = Object.freeze({ ...fixtureAccount('chatgpt'), email: 'private@example.test', displayName: 'Private name' });
function input(): DomainConversationWithDetail {
    const key = { accountId: account.id, conversationId: 'same-native-id' };
    return { index: { key, title: 'Index title', titleSource: 'provider', createdAt: 1000, updatedAt: 2000 },
        detail: { key: { ...key }, savedAt: 9999999999999, quality: { status: 'partial' }, assets: [], messages: [
            { id: 'provider-z', role: 'assistant', model: 'Source model', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'First body' }] }] },
            { id: 'provider-a', role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Second body' }] }] },
        ] } };
}

// Existing renderer/export coverage, separated from AST unit tests.
test('integration: exported metadata and message order', async () => {
    const domain = validateParserDomain(input());
    const markdown = renderDocumentMarkdown(composeDomainDocument(domain, account), {});
    assert.ok(markdown.includes('provider: "chatgpt"'));
    assert.ok(markdown.indexOf('First body') < markdown.indexOf('Second body'));
    assert.ok((renderDocumentHtml(composeDomainDocument(domain, account), {}).html).includes('Index title'));
    const document = composeDomainDocument(domain, account);
    const otherAccount = fixtureAccount('chatgpt', '20000000-0000-4000-8000-000000000001');
    const other = input(); other.index.key.accountId = otherAccount.id; other.detail.key.accountId = otherAccount.id;
    other.detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'text', text: 'Other account body' }] }];
    const otherDocument = composeDomainDocument(validateParserDomain(other), otherAccount);
    assert.ok(renderDocumentMarkdown(otherDocument, {}).includes('Other account body'));
    assert.ok(!renderDocumentMarkdown(document, {}).includes('Other account body'));
});

test('integration: renderers preserve Composer citation numbers', () => {
    const raw = input();
    raw.detail.messages = [0, 1].map(() => ({ role: 'assistant', citations: [{ id: 'same' }, { id: 'named', title: 'Article', url: 'https://example.test/article' }],
        reasoning: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'same', label: '[99]' }] }],
        content: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'named', label: 'Read this' }, { type: 'citationRef', citationId: 'same' }] }],
    }));
    const document = composeDomainDocument(validateParserDomain(raw), account);
    const markdown = renderDocumentMarkdown(document, {});
    assert.ok(markdown.includes('> [4] [Article](https://example.test/article)'));
    assert.ok(markdown.includes('Read this'));
    assert.ok(markdown.split('\n').includes('> [3]'), 'untitled offline source has one plain display number');
    assert.ok(!markdown.includes('[3] \\[3\\]'), 'untitled source number appears once');
    const html = renderDocumentHtml(document, {}, { locale: 'en' }).html;
    assert.ok(html.includes('>[4] Article</a>'));
    assert.ok(html.includes('gem-citation-chip">[3]</span>'));
    const pdf = renderDocumentTypst(document, {});
    const footer = pdf.messages[1].blocks.at(-1);
    assert.ok(footer?.type === 'note');
    assert.equal(footer.label, 'Sources');
    assert.deepEqual(footer.children, [{ type: 'text', text: '[3]' }, { type: 'lineBreak' },
        { type: 'link', url: 'https://example.test/article', children: [{ type: 'text', text: '[4] Article' }] }]);
});

test('integration: renderers express unavailable media', () => {
    const raw = input();
    raw.detail.assets = [{ id: 'photo', kind: 'image', name: 'Diagram.png' }, { id: 'file', kind: 'file', name: 'Report.pdf' }, { id: 'unowned', kind: 'image' }];
    raw.detail.messages = [
        { role: 'assistant', content: [] },
        { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'photo' }] }], attachmentIds: ['photo', 'file'] },
    ];
    const document = composeDomainDocument(validateParserDomain(raw), account);
    for (const locale of ['en', 'zh'] as const) {
        const text = unavailableResourceText('image', 'Diagram.png', locale);
        assert.ok(renderDocumentHtml(document, {}, { locale }).html.includes(text));
        assert.ok(renderDocumentMarkdown(document, {}, { locale }).includes(text));
        assert.ok(JSON.stringify(renderDocumentTypst(document, {}, { locale })).includes(text));
    }
    const { payload: pdf, diagnostics } = renderTypstFixture(document, { photo: 'assets/photo.png' });
    assert.ok(pdf.messages[1].blocks.some(block => block.type === 'file'), 'PDF file card does not imply download failure');
    assert.deepEqual(diagnostics, []);

});

test('integration: renderer format defaults are fixed and do not bypass the AST', () => {
    const raw = input();
    raw.detail.messages[0].reasoning = [{ type: 'code', code: 'thought', language: 'text' }];
    raw.detail.messages[0].content = [{ type: 'code', code: 'answer', language: 'js', meta: 'Authored filename' }];
    const document = composeDomainDocument(validateParserDomain(raw), account);
    const html = renderDocumentHtml(document, {}).html;
    assert.ok(html.includes('<div class="gem-code-header">'), 'HTML always has code headers');
    assert.ok(html.includes('copyCode(this)'), 'HTML keeps its fixed copy control');
    assert.ok(html.includes('<details class="gem-thoughts">'), 'HTML disclosures default to collapsed');
    const markdown = renderDocumentMarkdown(document, {});
    assert.ok(markdown.includes('<details>') && markdown.includes('```js\nanswer'));
    assert.ok(markdown.includes('Authored filename'), 'authored code metadata remains readable');
    const pdf = renderDocumentTypst(document, {});
    const code = pdf.messages[0].blocks.find(block => block.type === 'code');
    assert.ok(code && code.type === 'code' && code.header.includes('Authored filename'));
    assert.equal(renderDocumentHtml(document, {}, { locale: 'zh' }).html.includes('Authored filename'), true);
});
});

__suiteDescribe("asset-presentation", () => {
const test = require('node:test');
const assert = require('node:assert/strict');
const { resourceLabel, readingLabels } = require('../src/l3b/compose/resourcePresentation.js');
const { renderDocumentMarkdown } = require('../src/l4/format/markdown/renderMarkdown.js');
const { renderDocumentHtml } = require('../src/l4/format/html/renderHtml.js');
const { composeDomainDocument } = require('../src/l3b/compose/composeDomainDocument.js');
const { validateParserDomain } = require('../src/l2/runtimeValidation.js');
const { renderTypstFixture } = require('./helpers/renderTypstFixture.js');

test('resource labels preserve source facts and use shared fixed fallbacks', () => {
    for (const name of ['watermarked_img_11204364633950674587.jpg', 'asset_123456.png', '实验示意图.png', 'https://host/internal.png']) {
        assert.equal(resourceLabel(undefined, name, 'image'), name);
    }
    assert.equal(resourceLabel('  Authored alt  ', 'name', 'image'), '  Authored alt  ');
    assert.equal(resourceLabel('', undefined, 'image'), readingLabels.image);
    assert.equal(resourceLabel('   ', '', 'file'), readingLabels.file);
});

test('authored image alt and caption survive unchanged across Markdown HTML and Typst', () => {
    const name = 'watermarked_img_11204364633950674587.jpg';
    const domain = { index: { key: fixtureKey(String('c'), 'gemini'),   titleSource: "derived",   title: 'Title' }, detail: { key: fixtureKey(String('c'), 'gemini'), quality: { status: 'unknown' }, assets: [{ id: 'i', name, kind: 'image' }], messages: [{ id: 'm', role: 'assistant', content: [{ type: 'image', assetId: 'i', alt: name, caption: [{ type: 'text', text: name }] }] }] } };
    const document = composeDomainDocument(validateParserDomain(domain), fixtureAccountFor(validateParserDomain(domain)));
    const resources = { i: 'assets/image.jpg' };
    const md = renderDocumentMarkdown(document, resources);
    assert.ok(md.includes('![watermarked\\_img\\_11204364633950674587.jpg](assets/image.jpg)'));
    assert.ok(md.includes('watermarked\\_img\\_11204364633950674587.jpg'));
    const { payload } = renderTypstFixture(document, resources);
    assert.deepEqual(payload.messages[0].blocks[0].caption, [{ type: 'text', text: name }]);
    // HTML retains the authored label and the prepared resource path.
    const result = renderDocumentHtml(document, resources);
    assert.ok(result.html.includes(name), 'trusted source-authored captions must not be silently removed');
    assert.ok(result.html.includes('assets/image.jpg'), 'the image must still be rendered from its prepared path');
});
});

__suiteDescribe("document-freeze", () => {
function domain(): DomainConversationWithDetail {
    return { index: { key: fixtureKey(String('freeze'), 'custom'),   titleSource: "derived",   title: 'Boundary' }, detail: { key: fixtureKey(String('freeze'), 'custom'), quality: { status: 'unknown' }, assets: [], messages: [
        { id: 'same unsafe / " identity', role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Question '.repeat(40) }] }] },
        { id: 'answer', role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Answer' }] }] },
    ] } };
}
function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.values(value).forEach(freeze); Object.freeze(value);
}

test('HTML owns DOM identities and does not derive document language from UI locale', () => {
    const document = composeDomainDocument(validateParserDomain(domain()), fixtureAccountFor(validateParserDomain(domain())));
    assert.ok(document.messages.every(message => !('anchor' in message) && !('modelLabel' in message)));
    for (const locale of ['en', 'zh'] as const) {
        const html = renderDocumentHtml(document, {}, { locale }).html;
        assert.match(html, /<html>/);
        assert.match(html, /id="turn-user-0"/);
        assert.match(html, /id="prompt-turn-user-0"/);
        assert.match(html, /id="turn-model-1"/);
    }
    assert.ok(!('documentLanguage' in document));
    assert.match(renderDocumentHtml(document, {}, { locale: 'zh' }).html, /<html>/);
});

test('file badges use only supplied media type or kind, including misleading labels', () => {
    const file: Extract<DisplayBlock, { type: 'file' }> = { type: 'file', resourceId: 'f', label: 'misleading.pdf', kind: 'file' };
    assert.equal(fileBadge(file), 'FILE');
    assert.equal(fileBadge({ ...file, label: 'renamed.exe', mediaType: 'application/x-zip' }), 'ZIP');
    const document = composeDomainDocument(validateParserDomain(domain()), fixtureAccountFor(validateParserDomain(domain())));
    document.messages[0].blocks = [file, { ...file, mediaType: 'text/plain' }];
    const html = renderDocumentHtml(document, { f: 'assets/f' }).html;
    assert.match(html, /gem-att-badge">FILE<\/span>/);
    assert.match(html, /gem-att-badge">TXT<\/span>/);
    const pdf = renderDocumentTypst(document, {});
    assert.deepEqual(pdf.messages[0].blocks.map(block => block.type === 'file' && block.kind), ['FILE', 'TXT']);
});

test('Composer preserves Unix-ms Index timestamps; only renderers format UTC dates', () => {
    const input = domain();
    input.index.createdAt = Date.parse('2026-10-04T00:00:00Z');
    input.index.updatedAt = Date.parse('2026-10-06T23:30:00-07:00');
    const accepted = validateParserDomain(input);
    const document = composeDomainDocument(accepted, fixtureAccountFor(accepted));
    assert.equal(document.metadata.createdAt, input.index.createdAt);
    assert.equal(document.metadata.updatedAt, input.index.updatedAt);
    assert.ok(!('header' in document));
    assert.ok(renderDocumentHtml(document, {}).html.includes('2026-10-07'));
    assert.ok(renderDocumentTypst(document, {}).metadata.includes('2026-10-07'));
    const withoutUpdate = validateParserDomain({ ...input, index: { ...input.index, updatedAt: undefined } });
    const created = composeDomainDocument(withoutUpdate, fixtureAccountFor(withoutUpdate));
    assert.equal(created.metadata.updatedAt, undefined);
    assert.ok(renderDocumentHtml(created, {}).html.includes('2026-10-04'));
    assert.ok(renderDocumentTypst(created, {}).metadata.includes('2026-10-04'));
    const noTimes = validateParserDomain({ ...input, index: { ...input.index, createdAt: undefined, updatedAt: undefined } });
    const missing = composeDomainDocument(noTimes, fixtureAccountFor(noTimes));
    assert.ok(!('createdAt' in missing.metadata) && !('updatedAt' in missing.metadata));
    assert.ok(!renderDocumentHtml(missing, {}).html.includes('1970-01-01'));
});

test('provider parsing retains model identity and normalizes source dates only at L1', () => {
    const source = { id: 'c', title: 'T', updatedAt: '2026-10-06T23:30:00-07:00', createdAt: '2026-10-04', messages: [{ id: 'a', role: 'model', author: { model: 'provider only' }, content: '' }] };
    const first = historicalFixture(source, { providerId: 'gemini' });
    const document = composeDomainDocument(first.conversation, fixtureAccountFor(first.conversation));
    assert.equal(document.metadata.updatedAt, Date.parse('2026-10-06T23:30:00-07:00'));
    assert.ok(renderDocumentHtml(document, {}).html.includes('2026-10-07'));
    source.updatedAt = 'invalid';
    const second = historicalFixture(source, { providerId: 'gemini' });
    const fallback = composeDomainDocument(second.conversation, fixtureAccountFor(second.conversation));
    assert.equal(fallback.metadata.updatedAt, undefined);
    assert.equal(fallback.metadata.createdAt, Date.parse('2026-10-04T00:00:00Z'));
    assert.equal(fallback.messages[0].modelLabel, 'provider only');
    assert.equal(renderDocumentTypst(fallback, {}).messages[0].model, 'provider only');
});

test('parser removes math delimiters; HTML renders source verbatim and preserves malformed source', () => {
    const parsed = historicalFixture({ id: 'math', messages: [{ role: 'model', content: '$x^2$\n\n$$\ny^2\n$$' }] }, { providerId: 'gemini' });
    const document = composeDomainDocument(parsed.conversation, fixtureAccountFor(parsed.conversation));
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

test('PDF renders prepared AST images; one frozen rich JSON AST serves all backends', async () => {
    const input = domain();
    const inline = (id: string) => ({ type: 'image' as const, assetId: id, alt: id });
    const rendered = ['main', 'inline', 'heading', 'header', 'cell', 'nested'];
    const rich = ['image-caption', 'table-caption', 'description', 'body-ending', 'details'];
    input.detail.assets = [...rendered, ...rich].map(id => ({ id, kind: 'image', sourceUri: `https://example.test/${id}` }));
    input.detail.assets.push({ id: 'file', kind: 'file' });
    input.detail.messages[1].content = [
        { type: 'image', assetId: 'main', caption: [inline('image-caption')] },
        { type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'link', href: '/', children: [inline('inline')] }] }] },
        { type: 'heading', level: 2, children: [inline('heading')] },
        { type: 'table', caption: [inline('table-caption')], headerRows: [{ cells: [{ children: [inline('header')] }] }], rows: [{ cells: [{ children: [inline('cell')] }] }] },
        { type: 'quote', blocks: [{ type: 'list', ordered: false, items: [{ blocks: [{ type: 'quote', blocks: [{ type: 'paragraph', children: [inline('nested')] }] }] }] }] },
        { type: 'file', assetId: 'file', description: [inline('description'), inline('inline')] },
    ];
    freeze(input);
    const document: DocumentAst = JSON.parse(JSON.stringify(composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input)))));
    const detail: DisplayInline = { type: 'image', resourceId: 'details', alt: 'details' };
    document.messages[1].blocks.push({ type: 'image', resourceId: 'details', alt: 'Details image', caption: [detail] });
    document.messages[1].blocks.push({ type: 'paragraph', children: [{ type: 'image', resourceId: 'body-ending', alt: 'body-ending' }] });
    freeze(document);
    const before = JSON.stringify(document);
    const imageIds = collectDocumentResources(document).imageIds;
    assert.deepEqual([...imageIds].sort(), [...rendered, ...rich].sort());
    assert.equal(collectDocumentResources(document).imageIds.size, rendered.length + rich.length);
    const bindings = Object.fromEntries([...collectDocumentResources(document).referencedIds].map(id => [id, `assets/${id}.png`]));
    assert.ok(renderDocumentHtml(document, bindings).html.includes('src="assets/image-caption.png"'));
    assert.ok(renderDocumentMarkdown(document, bindings).includes('assets/image-caption.png'));
    const pdf = renderDocumentTypst(document, Object.fromEntries([...imageIds].map(id => [id, bindings[id]])));
    assert.deepEqual(pdf.messages[1].blocks[0].type === 'image' && pdf.messages[1].blocks[0].caption, [{ type: 'image', asset: bindings['image-caption'], alt: 'image-caption' }]);
    assert.deepEqual(pdf.messages[1].blocks[3].type === 'table' && pdf.messages[1].blocks[3].caption, [{ type: 'image', asset: bindings['table-caption'], alt: 'table-caption' }]);
    assert.deepEqual(pdf.messages[1].blocks[5].type === 'file' && pdf.messages[1].blocks[5].description, ['description', 'inline'].map(id => ({ type: 'image', asset: bindings[id], alt: id })));
    assert.deepEqual(pdf.messages[1].blocks[6].type === 'image' && pdf.messages[1].blocks[6].caption, [{ type: 'image', asset: bindings.details, alt: 'details' }]);
    assert.ok(JSON.stringify(pdf.messages[1].blocks[7]).includes(bindings['body-ending']));
    assert.equal(JSON.stringify(document), before);
});
});

__suiteDescribe("document-neutral", () => {
function fixture(): DomainConversationWithDetail {
    return JSON.parse(readFileSync('tests/fixtures/document-domain/document-neutral.json', 'utf8'));
}

function freeze(value: unknown): void { if (!value || typeof value !== 'object') return; Object.freeze(value); Object.values(value).forEach(freeze); }

test__s3('one immutable JSON document serves all three backends without losing rich structure', () => {
    const input = fixture(), inputBefore = JSON.stringify(input); freeze(input);
    const document = composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input)));
    assert.deepEqual(composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input))), document);
    const restored = JSON.parse(JSON.stringify(document)) as typeof document; freeze(restored);
    const before = JSON.stringify(restored), resources = { image: 'assets/image.png', file: 'assets/report.pdf' };
    const md = renderDocumentMarkdown(restored, resources, { locale: 'en' });
    const pdf = renderDocumentTypst(restored, resources, { locale: 'en' });
    const html = renderDocumentHtml(restored, resources, { locale: 'en' }).html;
    assert.ok(md.includes('<table>') && md.includes('colspan="2"') && md.includes('H2') && md.includes('H3'));
    assert.ok(html.includes('colspan="2"') && html.includes('<strong>Rich caption</strong>') && html.includes('<em>Image caption</em>'));
    const table = pdf.messages[0].blocks[2]; assert.equal(table.type, 'table');
    if (table.type !== 'table') throw new Error('Expected table');
    assert.equal(table.headers.length, 2); assert.equal(table.headers[0][0].colspan, 2); assert.deepEqual(table.caption, [{ type: 'strong', children: [{ type: 'text', text: 'Rich caption' }] }]);
    const file = restored.messages[0].blocks[4]; assert.equal(file.type, 'file');
    if (file.type !== 'file') throw new Error('Expected file');
    assert.equal(file.mediaType, 'application/pdf'); assert.equal(file.byteLength, 1234567);
    assert.equal(pdf.messages[0].blocks[4].type === 'file' && pdf.messages[0].blocks[4].metadata, 'PDF · 1.18 MB');
    assert.equal(JSON.stringify(restored), before); assert.equal(JSON.stringify(input), inputBefore);
    assert.deepEqual(renderDocumentTypst(document, resources), renderDocumentTypst(restored, resources));
});

test__s3('Locale changes renderer chrome; HTML and PDF keep fixed internal presentation defaults', () => {
    const document = composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture())));
    const resources = { image: 'assets/image.png', file: 'assets/report.pdf' };
    const before = JSON.stringify(document);
    const en = renderDocumentHtml(document, resources, { locale: 'en' }).html;
    const zh = renderDocumentHtml(document, resources, { locale: 'zh' }).html;
    assert.ok(en.includes('<html>') && en.includes('Thinking Process'));
    assert.ok(en.includes('copyCode(this)'), 'code copying is a fixed HTML feature');
    assert.ok(en.includes('prefers-color-scheme: light'), 'theme follows system CSS instead of public settings');
    assert.ok(zh.includes('Thinking Process') && zh.includes('复制'));
    const pdf = renderDocumentTypst(document, resources, { locale: 'zh' });
    assert.deepEqual(pdf.layout, defaultPdfLayout('zh'), 'PDF layout uses the export locale');
    const englishPdf = renderDocumentTypst(document, resources, { locale: 'en' });
    assert.deepEqual(englishPdf.layout, defaultPdfLayout('en'));
    assert.deepEqual({ ...englishPdf.layout, textLanguage: 'zh' }, pdf.layout,
        'locale changes only the PDF text language, not physical layout');
    const table = pdf.messages[0].blocks.find(b => b.type === 'table');
    assert.ok(table && table.type === 'table' && table.repeatHeader === true);
    assert.ok(renderDocumentMarkdown(document, resources, { locale: 'zh' }).includes('**来源:**'));
    assert.equal(JSON.stringify(document), before);
});

test__s3('AST: neutral tree has no output controls and renderers do not import source models', () => {
    const document = composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture())));
    const forbidden = new Set(['pdfLayout', 'layout', 'gapBeforePt', 'gapAfterPt', 'measurementText', 'minWidthCards', 'profile', 'theme', 'frontMatter', 'copy', 'repeatHeader', 'locale', 'badge', 'openLabel', 'showHeader', 'initiallyCollapsed', 'emptyNotice']);
    function check(value: unknown): void { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.has(key), key); check(child); } }
    check(document);
    // Inspect import/export declarations, not unrelated implementation tokens.
    // TypeScript 7 no longer exposes preProcessFile; keep this guard test-only.
    const importSources = (file: string): string[] =>
        [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s+(?:(?:type\s+)?[^;]*?\bfrom\s+)?(['"])([^'"]+)\1/gm)]
            .map(match => match[2]);
    for (const name of ['html/renderHtml', 'markdown/renderMarkdown', 'typst/renderTypstCore', 'shared/backendPresentation', 'shared/renderOptions', 'shared/renderStrings']) {
        for (const source of importSources(`src/l4/format/${name}.ts`)) {
            assert.doesNotMatch(source, /(^|\/)(?:canonical|domain|provider|content)\//,
                `Renderer ${name} cannot import source-model module ${source}`);
        }
    }
    const composerImports = importSources('src/l3b/compose/composeDomainDocument.ts');
    assert.ok(composerImports.every(source => !source.includes('/renderers/')),
        'Document composition must not import an output backend');
});


test__s3('prepared resource absence is reported by each backend without deleting the display reference', () => {
    const input = fixture(); input.detail.messages[0].reasoning = undefined; input.detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'image', assetId: 'image' }] }];
    const document = composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input))), before = JSON.stringify(document);
    const { payload: pdf, diagnostics } = renderTypstFixture(document);
    assert.ok(diagnostics.some(d => d.code === 'TYPST_V8_INLINE_IMAGE_MISSING'));
    const paragraph = pdf.messages[0].blocks[0]; if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph');
    assert.deepEqual(paragraph.children[0], { type: 'text', text: 'Image unavailable: image.png' });
    const html = renderDocumentHtml(document, {}, { locale: 'en' });
    assert.ok(html.html.includes('Image unavailable: image.png') && html.diagnostics.some(d => d.code === 'HTML_ASSET_UNRESOLVED'));
    assert.ok(renderDocumentMarkdown(document, {}).includes('[Image unavailable: image.png]'));
    assert.equal(JSON.stringify(document), before);
});
});

__suiteDescribe("domain_document_direct", () => {
const prepareDomainResources = async (results: Awaited<ReturnType<typeof fixtureResourceResults>>) => Object.fromEntries(results.map(result => [result.resourceId, result.value.path]));
async function exportDomainMarkdown(domain: Parameters<typeof composeDomainDocument>[0], account: Parameters<typeof composeDomainDocument>[1], options: { resourceResults?: Awaited<ReturnType<typeof fixtureResourceResults>>; exportedAt?: number; locale?: 'en' | 'zh' } = {}) {
    return renderDocumentMarkdown(composeDomainDocument(domain, account), await prepareDomainResources(options.resourceResults ?? []), options);
}
async function exportDomainHtml(domain: Parameters<typeof composeDomainDocument>[0], account: Parameters<typeof composeDomainDocument>[1], options: { resourceResults?: Awaited<ReturnType<typeof fixtureResourceResults>>; exportedAt?: number; locale?: 'en' | 'zh' } = {}) {
    return renderDocumentHtml(composeDomainDocument(domain, account), await prepareDomainResources(options.resourceResults ?? []), options).html;
}

const raw = {
    id: 'direct', title: 'Draft', titles: { rpc: 'Authoritative title' }, timestamp: 1700000000000,
    messages: [
        { id: 'u', role: 'user' as const, content: '![photo](assets/photo.png)',
            attachments: [{ type: 'image', url: 'https://example.test/photo.png', localName: 'assets/photo.png', name: 'photo.png', isGenerated: true,
                generation: { chatId: 'direct', generationOrdinal: 1, imageOrdinal: 0 } }],
            images: [{ type: 'image', url: 'https://example.test/photo.png', localName: 'assets/photo.png', name: 'photo.png' }] },
        { id: 'a', role: 'model' as const, content: 'Answer **[1]** and [cite:2]. `[1]` stays code.', thoughts: 'Reasoning [1]',
            citations: [{ url: 'https://example.test/source', title: 'Source' }], groundingCitationMarkers: ['[cite:2]'],
            documents: [{ type: 'doc', id: 'doc', title: 'report.pdf', localName: 'files/report.pdf', mimeType: 'application/pdf', size: 1234567,
                sections: ['Introduction'], contentMarkdown: '# Report' }] },
    ],
};

function freeze<T>(value: T): T {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}

test('raw -> Domain resolves citations and one resource registry without mutating input', () => {
    const snapshot = structuredClone(raw);
    const domain = historicalFixtureDomain(freeze(structuredClone(raw)));
    assert.deepEqual(raw, snapshot);
    assert.equal(domain.index.title, 'Authoritative title');
    assert.equal(domain.detail.assets.length, 2);
    assert.equal(Reflect.get(domain.detail.assets[0], 'generated'), undefined);
    assert.equal(domain.detail.assets[0].generation?.generationOrdinal, 1);
    assert.deepEqual(domain.detail.assets[1].document?.contentMarkdown, '# Report\n\nIntroduction');
    assert.equal('groundingCitationMarkers' in domain.detail.messages[1], false);
    assert.deepEqual(domain.detail.messages[1].citations, [
        { id: 'citation-0', title: 'Source', url: 'https://example.test/source' }, { id: 'grounding-2' },
    ]);
    const ast = composeDomainDocument(domain, fixtureAccountFor(domain));
    assert.equal(ast.messages[0].blocks.length, 2, 'explicit attachment placement follows the inline content');
    const answer = ast.messages[1].blocks[1];
    assert.equal(answer.type, 'paragraph');
    if (answer.type !== 'paragraph') throw Error('expected paragraph');
    assert.deepEqual(answer.children[1], { type: 'strong', children: [{ type: 'citation', id: 'citation-0', label: '[1]', href: 'https://example.test/source' }] });
    assert.ok(answer.children.some(node => node.type === 'citation' && node.label === '[2]' && !node.href));
    assert.ok(answer.children.some(node => node.type === 'inlineCode' && node.code === '[1]'));
    const file = ast.messages[1].blocks[2];
    assert.equal(file.type, 'file');
    if (file.type === 'file') { assert.equal(file.mediaType, 'application/pdf'); assert.equal(file.byteLength, 1234567); }
});

test('Domain JSON round-trip gives the same AST and HTML/Markdown, including resource identities', async () => {
    const domain = freeze(historicalFixtureDomain(structuredClone(raw)));
    const restored = JSON.parse(JSON.stringify(domain));
    assert.deepEqual(composeDomainDocument(domain, fixtureAccountFor(domain)), composeDomainDocument(restored, fixtureAccountFor(restored)));
    assert.deepEqual(await prepareDomainResources(await fixtureResourceResults(domain)), await prepareDomainResources(await fixtureResourceResults(restored)));
    const options = { exportedAt: Date.parse('2026-10-06T00:00:00Z'), locale: 'en' as const, resourceResults: await fixtureResourceResults(domain, historicalFixture(raw).resourceHints) };
    assert.equal(await exportDomainMarkdown(domain, fixtureAccountFor(domain), options), await exportDomainMarkdown(restored, fixtureAccountFor(restored), options));
    assert.equal(await exportDomainHtml(domain, fixtureAccountFor(domain), options), await exportDomainHtml(restored, fixtureAccountFor(restored), options));
});

test('AST: composer trusts literal Domain content and does not reinterpret Markdown or marker syntax', () => {
    const domain: DomainConversationWithDetail = { index: { key: fixtureKey(String('literal'), 'custom'),   titleSource: "derived",   title: 'Literal' }, detail: { key: fixtureKey(String('literal'), 'custom'), quality: { status: 'unknown' }, assets: [], messages: [
        { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: '**literal** [1] [cite:2] ![pic](url)' }] }],
            citations: [{ id: 'source', url: 'https://example.test' }] },
    ] } };
    const ast = composeDomainDocument(validateParserDomain(domain), fixtureAccountFor(validateParserDomain(domain)));
    assert.equal(ast.metadata.provider, 'custom');
    assert.ok(!('documentLanguage' in ast));
    assert.deepEqual(ast.messages[0].blocks, domain.detail.messages[0].content);
});

test('AST: reasoning and explicit attachments retain each source placement and dangling citations fail closed', () => {
    const domain: DomainConversationWithDetail = { index: { key: fixtureKey(String('placement'), 'custom'),    }, detail: { key: fixtureKey(String('placement'), 'custom'), quality: { status: 'unknown' }, assets: [{ id: 'shared', kind: 'image', name: 'diagram.png' }], messages: [
            { role: 'assistant', content: [], reasoning: [{ type: 'image', assetId: 'shared' }], attachmentIds: ['shared'] },
            { role: 'user', content: [], attachmentIds: ['shared'] },
        ] } };
    const ast = composeDomainDocument(validateParserDomain(domain), fixtureAccountFor(validateParserDomain(domain)));
    assert.equal(ast.messages[0].blocks.length, 2, 'explicit attachment remains after reasoning');
    assert.equal(ast.messages[1].blocks.length, 1);
    const broken = structuredClone(domain);
    broken.detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'unknown' }] }];
    assert.throws(() => composeDomainDocument(validateParserDomain(broken), fixtureAccountFor(validateParserDomain(broken))), /Unregistered Domain citation/);
});

test('direct export dependency closure cannot load Canonical conversation normalization/composition', () => {
    // Traverse runtime relative imports: type-only legacy parser diagnostics do not add a representation.
    const visited = new Set<string>();
    const visit = (file: string): void => {
        if (visited.has(file)) return;
        visited.add(file);
        assert.ok(!/canonical\/(?:conversation|normaliz\w+|renderCanonical\w+|messageInput|assetInput)\.ts$/.test(file), file);
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/(?:import|export)\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)) {
            if (!match[1].startsWith('.')) continue;
            const dependency = path.resolve(path.dirname(file), match[1].replace(/\.js$/, '.ts'));
            if (fs.existsSync(dependency)) visit(dependency);
        }
    };
    visit(path.resolve(__dirname, '../src/l3b/compose/composeDomainDocument.ts'));
    visit(path.resolve(__dirname, '../src/l4/format/html/renderHtml.ts'));
    visit(path.resolve(__dirname, '../src/l4/format/markdown/renderMarkdown.ts'));
});

test('provider citation binding covers rich captions/descriptions and ignores code/math markers', () => {
    const bound = closeSourceCitations({ role: 'assistant', citations: [{ id: 'source', url: 'https://example.test/source' }], content: [
        { type: 'image', assetId: 'image', caption: [{ type: 'strong', children: [{ type: 'text', text: 'caption [1]' }] }] },
        { type: 'file', assetId: 'file', description: [{ type: 'text', text: 'description [1]' }] },
        { type: 'table', caption: [{ type: 'text', text: 'table [1]' }], rows: [] },
        { type: 'code', code: '[1]' }, { type: 'math', source: '[1]' },
    ] });
    const serialized = JSON.stringify(bound.content);
    assert.equal((serialized.match(/"citationRef"/g) ?? []).length, 3);
    assert.ok(serialized.includes('"citationId":"source"'));
    assert.deepEqual(bound.content.slice(3), [{ type: 'code', code: '[1]' }, { type: 'math', source: '[1]' }]);
});

test('prepared paths retain archive namespaces, hash inline bytes and omit failed/remote resources', async () => {
    const domain: DomainConversationWithDetail = { index: { key: fixtureKey(String('resources'), 'custom'),    }, detail: { key: fixtureKey(String('resources'), 'custom'), quality: { status: 'unknown' }, messages: [], assets: [
        { id: 'path', kind: 'file',  },
        { id: 'bytes', kind: 'image', mediaType: 'image/png' },
        { id: 'uri', kind: 'image' },
        { id: 'failed', kind: 'file' },
        { id: 'remote', kind: 'image', sourceUri: 'https://example.test/image.png' },
    ] } };
    const prepared = await prepareDomainResources(await fixtureResourceResults(freeze(domain), { path: { archivePath: 'files/report.pdf' }, failed: { unresolvedReference: 'files/missing.pdf' } }, { bytes: { dataBase64: 'AQID' }, uri: { url: 'data:image/png;base64,AQID' } }));
    assert.equal(prepared.path, 'files/report.pdf');
    assert.match(prepared.bytes, /^assets\/sha256\/\w{2}\/\w{2}\/\w{64}\.png$/);
    assert.equal(prepared.bytes, prepared.uri);
    assert.equal(prepared.failed, undefined);
    assert.equal(prepared.remote, undefined);
});


test('citation numbering is conversation-wide in body, reasoning and Sources, including references without URLs', async () => {
    const domain = validateParserDomain({ index: { key: fixtureKey(String('citations'), 'custom'),   titleSource: "derived",   title: 'Citations' }, detail: { key: fixtureKey(String('citations'), 'custom'), quality: { status: 'complete' }, assets: [], messages: [
        { id: 'first', role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'same', label: '[17]' }] }], citations: [{ id: 'same', url: 'https://example.test/one', title: 'First source' }] },
        { id: 'second', role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'same' }] }], reasoning: [{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'same', label: '[91]' }] }], citations: [{ id: 'same', title: 'Offline source' }] },
    ] } });
    const document = composeDomainDocument(domain, fixtureAccountFor(domain));
    const first = document.messages[0].blocks[0];
    assert.ok(first.type === 'paragraph');
    assert.deepEqual(first.children, [{ type: 'citation', id: 'same', label: '[17]', href: 'https://example.test/one' }]);
    const second = document.messages[1].blocks[1];
    assert.ok(second.type === 'paragraph');
    assert.deepEqual(second.children, [{ type: 'citation', id: 'same', label: '[2]' }]);
    const reasoning = document.messages[1].blocks[0];
    assert.ok(reasoning.type === 'disclosure');
    assert.deepEqual(reasoning.blocks, [{ type: 'paragraph', children: [{ type: 'citation', id: 'same', label: '[91]' }] }]);
    assert.equal(document.messages[0].sources?.[0].number, 1);
    assert.equal(document.messages[1].sources?.[0].number, 2);
    const markdown = await exportDomainMarkdown(domain, fixtureAccountFor(domain));
    assert.ok(markdown.includes('[2]'));
    assert.ok(markdown.includes('Offline source'));
});
});

__suiteDescribe("renderer-strings-locale", () => {
const test = require('node:test');
const assert = require('node:assert');

const { getRendererStrings } = require('../src/l4/format/shared/renderStrings.js');
const { composeDomainDocument } = require('../src/l3b/compose/composeDomainDocument.js');
const { renderTypstFixture } = require('./helpers/renderTypstFixture.js');
const { renderDocumentHtml } = require('../src/l4/format/html/renderHtml.js');

function domainFixture(messages: any[], extra: any = {}) {
    const createdAt = require('../src/l1/parsers/shared/time.js').normalizeTimestamp('createdAt' in extra ? extra.createdAt : Date.parse('2026-09-20T10:00:00Z'));
    const updatedAt = require('../src/l1/parsers/shared/time.js').normalizeTimestamp(extra.updatedAt);
    return restoreDomainSnapshot({ index: { key: fixtureKey(String('c1'), 'gemini'),   title: 'Test convo', titleSource: "derived",
        ...(createdAt !== undefined ? { createdAt } : {}), ...(updatedAt !== undefined ? { updatedAt } : {}) },
        detail: { key: fixtureKey(String('c1'), 'gemini'), quality: { status: 'unknown' }, assets: extra.assets ?? [], messages } });
}

function msg(blocks: any[]) {
    return { id: 'm1', role: 'assistant', content: blocks };
}

const opts = {};

test('getRendererStrings returns zh and en copies', () => {
    const zh = getRendererStrings('zh');
    const en = getRendererStrings('en');
    assert.strictEqual(zh.thinkingSummary, '思考摘要');
    assert.strictEqual(zh.sources, '来源');
    assert.strictEqual(zh.sizeUnknown, '大小未知');
    assert.strictEqual(zh.dateUnknown, '日期未知');
    assert.strictEqual(zh.unsupportedContent, '不支持的内容');
    assert.ok(zh.mathFallback.includes('无法排版'));
    assert.strictEqual(en.thinkingSummary, 'Thinking Summary');
    assert.strictEqual(en.sources, 'Sources');
});

test('typst zh locale localizes chrome copy', () => {
    const blocks = [
        { type: 'unknown', sourceType: 'gemini.mystery', text: 'Mystery content' },
        { type: 'math', source: 'x^2' },
    ];
    const b = domainFixture([{ ...msg(blocks), reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Visible reasoning' }] }] }]);
    const { payload } = renderTypstFixture(composeDomainDocument(b, fixtureAccountFor(b)), {}, { ...opts, locale: 'zh' });
    const nodes = payload.messages[0].blocks;
    const thought = nodes.find((n: any) => n.type === 'note' && n.label === 'Thinking Process');
    assert.ok(thought, 'Composer reasoning title stays fixed while renderer chrome is localized');
    const unknown = nodes.find((n: any) => n.type === 'unknown');
    assert.ok(unknown.label.startsWith('不支持的内容'));
    const math = nodes.find((n: any) => n.type === 'math');
    assert.ok(math.fallbackLabel.includes('无法排版'));
});

test('typst defaults to en when locale omitted', () => {
    const b = domainFixture([{ ...msg([]), reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Visible reasoning' }] }] }]);
    const { payload } = renderTypstFixture(composeDomainDocument(b, fixtureAccountFor(b)), {}, opts);
    const thought = payload.messages[0].blocks.find((n: any) => n.type === 'note');
    assert.strictEqual(thought.label, 'Thinking Process');
});

test('typst zh date unknown is localized', () => {
    const b = domainFixture([msg([])]);
    delete b.index.createdAt;
    const { payload } = renderTypstFixture(composeDomainDocument(b, fixtureAccountFor(b)), {}, { ...opts, locale: 'zh' });
    assert.ok(payload.metadata.includes('日期未知'));
});

test('html uses the same string source', () => {
    const blocks: any[] = [];
    const zh = renderDocumentHtml(composeDomainDocument(domainFixture([{ ...msg(blocks), reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Visible reasoning' }] }] }]), fixtureAccountFor(domainFixture([{ ...msg(blocks), reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Visible reasoning' }] }] }]))), {}, { locale: 'zh' });
    assert.ok(zh.html.includes('Thinking Process'));
    const en = renderDocumentHtml(composeDomainDocument(domainFixture([{ ...msg(blocks), reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Visible reasoning' }] }] }]), fixtureAccountFor(domainFixture([{ ...msg(blocks), reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Visible reasoning' }] }] }]))), {}, { locale: 'en' });
    assert.ok(en.html.includes('Thinking Process'));
});

function roleMsg(role: string, extra: any = {}) {
    return { id: `m-${role}`, role, content: [], ...extra };
}

function firstNoteText(message: any) {
    return message.blocks[0].children[0].text;
}

test('role prefix strings live in the string table (en + zh)', () => {
    const en = getRendererStrings('en');
    assert.strictEqual(en.systemMessage, 'System message');
    assert.strictEqual(en.developerMessage, 'Developer message');
    assert.strictEqual(en.unknownRole, 'Unknown role');
    const zh = getRendererStrings('zh');
    assert.strictEqual(zh.systemMessage, '系统消息');
    assert.strictEqual(zh.developerMessage, '开发者消息');
    assert.strictEqual(zh.unknownRole, '未知角色');
});

test('typst localizes role prefix notes', () => {
    const msgs = [
        roleMsg('system'),
        roleMsg('developer'),
        roleMsg('unknown'),
    ];
    const zh = renderTypstFixture(composeDomainDocument(domainFixture(msgs), fixtureAccountFor(domainFixture(msgs))), {}, { ...opts, locale: 'zh' });
    assert.strictEqual(firstNoteText(zh.payload.messages[0]), '系统消息');
    assert.strictEqual(firstNoteText(zh.payload.messages[1]), '开发者消息');
    assert.strictEqual(firstNoteText(zh.payload.messages[2]), '未知角色');
    const en = renderTypstFixture(composeDomainDocument(domainFixture(msgs), fixtureAccountFor(domainFixture(msgs))), {}, opts);
    assert.strictEqual(firstNoteText(en.payload.messages[0]), 'System message');
    assert.strictEqual(firstNoteText(en.payload.messages[1]), 'Developer message');
    assert.strictEqual(firstNoteText(en.payload.messages[2]), 'Unknown role');
});

test('user/assistant roles get no prefix note', () => {
    const { payload } = renderTypstFixture(composeDomainDocument(domainFixture([roleMsg('user'), roleMsg('assistant')]), fixtureAccountFor(domainFixture([roleMsg('user'), roleMsg('assistant')]))), {}, opts);
    assert.strictEqual(payload.messages[0].blocks.length, 0);
    assert.strictEqual(payload.messages[1].blocks.length, 0);
});
});
