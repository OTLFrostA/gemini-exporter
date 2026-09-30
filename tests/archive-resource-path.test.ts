export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLocalName } = require('../src/core/export/canonical/gemini/normalizeAssets.js');
const { normalizeGeminiConversation } = require('../src/core/export/canonical/index.js');
const { renderCanonicalHtml } = require('../src/core/export/canonical/renderCanonicalHtml.js');

test('archive namespaces preserve writer paths and bare names default to assets', () => {
    for (const [input, expected] of [
        ['foo.png', 'assets/foo.png'], ['assets/foo.png', 'assets/foo.png'],
        ['files/foo.md', 'files/foo.md'], ['files/nested/foo.pdf', 'files/nested/foo.pdf'],
        ['./files//foo.md', 'files/foo.md'], ['files\\nested\\foo.pdf', 'files/nested/foo.pdf'],
    ]) assert.equal(normalizeLocalName(input), expected);
});

test('archive resource names reject traversal, absolute, drive and encoded unsafe paths', () => {
    for (const path of ['../foo', '../../etc/passwd', '/absolute/path', 'C:/foo', '//server/foo',
        'files/../foo', 'files/%2e%2e/foo', '%2fabsolute', 'files/%00foo', 'files/..\\foo']) {
        assert.throws(() => normalizeLocalName(path), /archive resource path/i);
    }
});

test('canonical attachment uses files namespace through HTML output', async () => {
    const { bundle } = await normalizeGeminiConversation({ id: 'cb8bd7', messages: [{
        id: 'm1', role: 'user', content: 'Attachment', attachments: [{
            type: 'file', name: 'test_config.json', localName: 'files/cb8bd7_test_config.json',
        }],
    }] });
    assert.equal(bundle.assets[0].storageRef, 'files/cb8bd7_test_config.json');
    const result = renderCanonicalHtml(bundle);
    assert.match(typeof result === 'string' ? result : result.html, /href="files\/cb8bd7_test_config.json"/);
});
