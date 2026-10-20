import { fixtureKey, fixtureAccountFor } from './helpers/domainFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const { resourceLabel, readingLabels } = require('../src/core/document/compose/resourcePresentation.js');
const { renderDocumentMarkdown } = require('../src/core/renderers/markdown/renderMarkdown.js');
const { renderDocumentHtml } = require('../src/core/renderers/html/renderHtml.js');
const { composeDomainDocument } = require('../src/core/document/compose/composeDomainDocument.js');
const { validateParserDomain } = require('../src/core/domain/runtimeValidation.js');
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
