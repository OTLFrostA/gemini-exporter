import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import { composeDomainDocument } from '../src/core/export/document/composeDomainDocument.js';
import { renderDocumentHtml } from '../src/core/export/document/renderHtml.js';
import { renderDocumentMarkdown } from '../src/core/export/document/renderMarkdown.js';
import { renderDocumentTypst, defaultPdfLayout } from '../src/core/export/document/renderTypst.js';

function fixture(): DomainConversationDetail {
    return JSON.parse(readFileSync('tests/fixtures/document-domain/document-neutral.json', 'utf8'));
}

function freeze(value: unknown): void { if (!value || typeof value !== 'object') return; Object.freeze(value); Object.values(value).forEach(freeze); }

test('one immutable JSON document serves all three backends without losing rich structure', () => {
    const input = fixture(), inputBefore = JSON.stringify(input); freeze(input);
    const { document } = composeDomainDocument(input, { documentLanguage: 'zh-CN' });
    assert.deepEqual(composeDomainDocument(input, { documentLanguage: 'zh-CN' }).document, document);
    const restored = JSON.parse(JSON.stringify(document)) as typeof document; freeze(restored);
    const before = JSON.stringify(restored), resources = { image: 'assets/image.png', file: 'assets/report.pdf' };
    const md = renderDocumentMarkdown(restored, resources, { locale: 'en' });
    const pdf = renderDocumentTypst(restored, resources, { locale: 'en' });
    const html = renderDocumentHtml(restored, resources, { locale: 'en' }).html;
    assert.ok(md.includes('| H1 |  |') && md.includes('| H2 | H3 |'));
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

test('UI locale, theme and page policy change independently of document language and content', () => {
    const { document } = composeDomainDocument(fixture(), { documentLanguage: 'zh-CN' });
    const resources = { image: 'assets/image.png', file: 'assets/report.pdf' }, before = JSON.stringify(document);
    const en = renderDocumentHtml(document, resources, { locale: 'en', theme: 'light', copyCode: false }).html;
    const zh = renderDocumentHtml(document, resources, { locale: 'zh' }).html;
    assert.ok(en.includes('<html lang="zh-CN">') && en.includes('Thinking Process') && en.includes('light-theme'));
    assert.ok(zh.includes('思考过程') && zh.includes('复制'));
    assert.ok(!en.includes('<button class="gem-copy-btn"'));
    const layout = defaultPdfLayout('zh-CN'); layout.page.widthMm = 148;
    const pdf = renderDocumentTypst(document, resources, { locale: 'en', layout, repeatTableHeader: false });
    assert.equal(pdf.layout.page.widthMm, 148); assert.equal(pdf.layout.textLanguage, 'zh-CN');
    assert.ok(renderDocumentMarkdown(document, resources, { locale: 'zh' }).includes('**来源:**'));
    assert.equal(JSON.stringify(document), before);
});

test('neutral contract carries no units, output formats, UI controls or source-model dependencies', () => {
    const { document } = composeDomainDocument(fixture());
    const forbidden = new Set(['pdfLayout', 'layout', 'gapBeforePt', 'gapAfterPt', 'measurementText', 'minWidthCards', 'profile', 'theme', 'frontMatter', 'copy', 'repeatHeader', 'locale', 'badge', 'metadata', 'openLabel']);
    function check(value: unknown): void { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.has(key), key); check(child); } }
    check(document);
    for (const name of ['renderHtml', 'renderMarkdown', 'renderTypst', 'backendPresentation', 'renderOptions', 'renderStrings']) {
        assert.doesNotMatch(readFileSync(`src/core/export/document/${name}.ts`, 'utf8'), /from ['"].*(?:canonical|domain|provider|content)\//);
    }
    assert.doesNotMatch(readFileSync('src/core/export/document/composeDomainDocument.ts', 'utf8'), /visualContract|getRendererStrings|RenderOptions|isMarkdown|isPdf|\.75|gapBeforePt/);
});


test('prepared resource absence is reported by each backend without deleting the display reference', () => {
    const input = fixture(); input.messages[0].reasoning = undefined; input.messages[0].content = [{ type: 'paragraph', children: [{ type: 'image', assetId: 'image' }] }];
    const { document } = composeDomainDocument(input), before = JSON.stringify(document);
    const diagnostics: import('../src/core/diagnostics/documentDiagnostic.js').DocumentDiagnostic[] = [];
    const pdf = renderDocumentTypst(document, {}, { onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
    assert.ok(diagnostics.some(d => d.code === 'TYPST_V8_INLINE_IMAGE_MISSING'));
    const paragraph = pdf.messages[0].blocks[0]; if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph');
    assert.deepEqual(paragraph.children[0], { type: 'text', text: 'image' });
    const html = renderDocumentHtml(document, {}, { locale: 'en' });
    assert.ok(html.html.includes('Image missing · image') && html.diagnostics.some(d => d.code === 'HTML_ASSET_UNRESOLVED'));
    assert.ok(renderDocumentMarkdown(document, {}).includes('[Image unavailable: image]'));
    assert.equal(JSON.stringify(document), before);
});
