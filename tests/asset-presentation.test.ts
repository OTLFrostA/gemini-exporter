import { fixtureKey, fixtureAccountFor } from './helpers/domainFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const { assetPresentation, isHumanMeaningfulFilename } = require('../src/core/document/compose/resourcePresentation.js');
const { renderDocumentMarkdown } = require('../src/core/renderers/markdown/renderMarkdown.js');
const { renderDocumentHtml } = require('../src/core/renderers/html/renderHtml.js');
const { composeDomainDocument } = require('../src/core/document/compose/composeDomainDocument.js');
const { validateParserDomain } = require('../src/core/domain/runtimeValidation.js');
const { renderTypstFixture } = require('./helpers/renderTypstFixture.js');

test('asset labels suppress opaque storage names and preserve meaningful multilingual names', () => {
    for (const name of ['watermarked_img_11204364633950674587.jpg', 'asset_123456.png', 'a'.repeat(32) + '_photo.jpg', '123456789.jpg', 'https://host/internal.png', 'a1b2c3d4-1234-4321-abcd-123456789012.png']) {
        assert.equal(isHumanMeaningfulFilename(name), false, name);
    }
    for (const name of ['实验示意图.png', 'test_config.json', 'Figure 2 — PSF', 'Figure: PSF', 'report-2026.pdf']) assert.equal(isHumanMeaningfulFilename(name), true, name);
    assert.equal(assetPresentation({ name: 'asset_123.png' }, 'Human caption').caption, 'Human caption');
});

test('authored image alt and caption survive unchanged across Markdown HTML and Typst', () => {
    const name = 'watermarked_img_11204364633950674587.jpg';
    const domain = { index: { key: fixtureKey(String('c'), 'gemini'),   titleSource: "derived",   title: 'Title' }, detail: { key: fixtureKey(String('c'), 'gemini'), quality: { status: 'unknown' }, assets: [{ id: 'i', name, kind: 'image' }], messages: [{ id: 'm', role: 'assistant', content: [{ type: 'image', assetId: 'i', alt: name, caption: [{ type: 'text', text: name }] }] }] } };
    const document = composeDomainDocument(validateParserDomain(domain), fixtureAccountFor(validateParserDomain(domain)));
    const resources = { i: 'assets/image.jpg' };
    const md = renderDocumentMarkdown(document, resources);
    assert.ok(md.includes('![' + name + '](assets/image.jpg)'));
    assert.ok(md.includes(name));
    const { payload } = renderTypstFixture(document, resources);
    assert.deepEqual(payload.messages[0].blocks[0].caption, [{ type: 'text', text: name }]);
    // HTML keeps the asset reference in href, but no opaque display label.
    const result = renderDocumentHtml(document, resources);
    assert.ok(result.html.includes(name), 'trusted source-authored captions must not be silently removed');
    assert.ok(result.html.includes('assets/image.jpg'), 'the image must still be rendered from its prepared path');
});
