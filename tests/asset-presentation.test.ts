export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const { assetPresentation, isHumanMeaningfulFilename } = require('../src/core/export/document/resourcePresentation.js');
const { renderDocumentMarkdown } = require('../src/core/export/document/renderMarkdown.js');
const { renderDocumentHtml } = require('../src/core/export/document/renderHtml.js');
const { composeDomainDocument } = require('../src/core/export/document/composeDomainDocument.js');
const { renderTypstFixture } = require('./helpers/renderTypstFixture.js');

test('asset labels suppress opaque storage names and preserve meaningful multilingual names', () => {
    for (const name of ['watermarked_img_11204364633950674587.jpg', 'asset_123456.png', 'a'.repeat(32) + '_photo.jpg', '123456789.jpg', 'https://host/internal.png', 'a1b2c3d4-1234-4321-abcd-123456789012.png']) {
        assert.equal(isHumanMeaningfulFilename(name), false, name);
    }
    for (const name of ['实验示意图.png', 'test_config.json', 'Figure 2 — PSF', 'Figure: PSF', 'report-2026.pdf']) assert.equal(isHumanMeaningfulFilename(name), true, name);
    assert.equal(assetPresentation({ name: 'asset_123.png' }, 'Human caption').caption, 'Human caption');
});

test('opaque generated image caption policy agrees across Markdown HTML and Typst', () => {
    const name = 'watermarked_img_11204364633950674587.jpg';
    const domain = { providerId: 'gemini', id: 'c', title: 'Title', timestamp: null, assets: [{ id: 'i', name, kind: 'image' }], messages: [{ id: 'm', role: 'assistant', content: [{ type: 'image', assetId: 'i', alt: name, caption: [{ type: 'text', text: name }] }] }] };
    const document = composeDomainDocument(domain).document;
    const resources = { i: 'assets/image.jpg' };
    const md = renderDocumentMarkdown(document, resources);
    assert.ok(md.includes('![Image](assets/image.jpg)'));
    assert.ok(!md.includes(name));
    const { payload } = renderTypstFixture(document, resources);
    assert.equal(payload.messages[0].blocks[0].caption, undefined);
    // HTML keeps the asset reference in href, but no opaque display label.
    const result = renderDocumentHtml(document, resources);
    assert.ok(!JSON.stringify(result).includes(name));
    assert.ok(result.html.includes('<h1 class="gem-conversation-title">Title</h1>'));
});
