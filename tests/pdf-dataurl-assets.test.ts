/** Original data URI facts are parsed into Domain; decoded bytes belong to PreparedResources. */
export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProviderConversation } = require('../src/core/provider/conversationParser.js');
const { composeDomainDocument } = require('../src/core/export/document/composeDomainDocument.js');
const { preparePdfResources } = require('../src/core/export/pdf/prepareResources.js');
const { collectPdfImageIds } = require('../src/core/export/pdf/imageResources.js');
const { resourceStage } = require('../src/core/export/pdf/pipeline/resourceStage.js');
const { decodeDataUrl, decodeDataUrlAsset } = require('../src/core/export/assets/dataUrl.js');
const { assertDomainClosure } = require('../src/core/domain/closure.js');
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_SHA256 = 'c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77';
const PNG_REF = `assets/sha256/c4/14/${PNG_SHA256}.png`;
async function prepare(content: string, id = 'dataurl') {
    const input = { id, title: 'data url assets', messages: [{ id: 'm1', role: 'user', content }] };
    const before = JSON.stringify(input);
    const parsed = parseProviderConversation(input);
    const domain = parsed.conversation;
    assertDomainClosure(domain);
    const document = composeDomainDocument(domain).document;
    const semantic = JSON.stringify({ domain, document });
    const prepared = await preparePdfResources(domain, collectPdfImageIds(document), parsed.acquisitionHints);
    const staged = await resourceStage({ document, resources: prepared.resources }, { signal: new AbortController().signal, log() {}, reportProgress() {} });
    assert.equal(JSON.stringify({ domain, document }), semantic);
    assert.equal(JSON.stringify(input), before);
    return { domain, document, resources: prepared.resources, diagnostics: [...prepared.diagnostics, ...staged.diagnostics], ...staged.output };
}
test('original base64 PNG facts survive JSON; preparation produces the real content address', async () => {
    const source = `data:image/png;base64,${PNG_B64}`;
    const result = await prepare(`![dot](${source})`);
    assert.equal(result.domain.assets.length, 1);
    const asset = result.domain.assets[0];
    assert.equal(asset.source.uri, source);
    assert.equal(result.pathMap.get(asset.id), PNG_REF);
    assert.equal(result.resources.get(asset.id).mediaType, 'image/png');
    assert.deepEqual(Buffer.from(result.resources.get(asset.id).bytes), Buffer.from(PNG_B64, 'base64'));
    assert.equal(result.mounts[0].bytes.length, 70);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(JSON.parse(JSON.stringify(result.domain)), result.domain);
    for (const field of ['storageRef', 'status', 'sha256']) assert.ok(!(field in asset));
});
test('image without authored alt remains resolvable without inventing a semantic filename', async () => {
    const result = await prepare(`![](data:image/png;base64,${PNG_B64})`);
    assert.equal(result.pathMap.get(result.domain.assets[0].id), PNG_REF);
    assert.equal(result.mounts.length, 1);
});
test('percent-encoded SVG input decodes before image mounting', async () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const result = await prepare(`![v](data:image/svg+xml,${encodeURIComponent(text)})`);
    const id = result.domain.assets[0].id;
    assert.deepEqual(Buffer.from(result.resources.get(id).bytes), Buffer.from(text));
    assert.ok(result.pathMap.get(id).endsWith('.svg'));
    assert.deepEqual(result.diagnostics, []);
});
test('oversized original data URL is refused in preparation without changing Domain', async () => {
    const over = 'A'.repeat(Math.ceil((10 * 1024 * 1024 + 1) / 3) * 4);
    const result = await prepare(`![big](data:image/png;base64,${over})`);
    const id = result.domain.assets[0].id;
    assert.equal(result.resources.get(id).bytes, undefined);
    assert.ok(result.resources.get(id).failureReason);
    assert.equal(result.pathMap.size, 0);
    assert.ok(result.diagnostics.some((d: any) => d.code === 'DATA_URL_TOO_LARGE' && d.severity === 'warning'));
});
test('malformed original data URL failures are sidecar diagnostics', async () => {
    for (const uri of ['data:image/png;base64', 'data:image/png;base64,!!!not-base64!!!', 'data:image/png,%zz']) {
        const result = await prepare(`![x](${uri})`);
        const id = result.domain.assets[0].id;
        assert.equal(result.domain.assets[0].source.uri, uri);
        assert.equal(result.resources.get(id).bytes, undefined);
        assert.ok(result.diagnostics.some((d: any) => d.code === 'DATA_URL_MALFORMED'));
    }
});
test('remote input remains a URI fact; offline preparation cannot invent bytes', async () => {
    const uri = 'https://example.com/inline.png';
    const result = await prepare(`![a](${uri})`);
    const id = result.domain.assets[0].id;
    assert.equal(result.domain.assets[0].source.uri, uri);
    assert.equal(result.resources.get(id).bytes, undefined);
    assert.equal(result.pathMap.size, 0);
    assert.match(result.unresolved[0].reason, /no network fetch/);
});
test('decodeDataUrlAsset unit checks: header parsing and strictness', async () => {
    const ok = await decodeDataUrlAsset(`data:image/png;base64,${PNG_B64}`);
    assert.ok(ok.ok);
    if (ok.ok) {
        assert.strictEqual(ok.mimeType, 'image/png');
        assert.strictEqual(ok.storageRef, PNG_REF);
        assert.strictEqual(ok.sha256, PNG_SHA256);
        assert.strictEqual(ok.suggestedName, 'image.png');
    }
    // Whitespace inside base64 is insignificant.
    const spaced = await decodeDataUrlAsset(`data:image/png;base64,${PNG_B64.slice(0, 20)} ${PNG_B64.slice(20)}`);
    assert.ok(spaced.ok && spaced.storageRef === PNG_REF);

    const noComma = await decodeDataUrlAsset('data:image/png;base64');
    assert.ok(!noComma.ok && noComma.code === 'DATA_URL_MALFORMED');

    const badPad = await decodeDataUrlAsset('data:image/png;base64,AB=C');
    assert.ok(!badPad.ok && badPad.code === 'DATA_URL_MALFORMED');

    const emptyType = await decodeDataUrlAsset('data:,hello');
    assert.ok(emptyType.ok && emptyType.mimeType === 'application/octet-stream');
    if (emptyType.ok) assert.deepStrictEqual(Buffer.from(emptyType.bytes), Buffer.from('hello'));
});

test('decodeDataUrl stays synchronous and returns bytes without a digest', () => {
    const decoded: any = decodeDataUrl(`data:image/png;base64,${PNG_B64}`);
    assert.ok(decoded.ok);
    assert.strictEqual(decoded.mimeType, 'image/png');
    assert.ok(!('sha256' in decoded), 'sync decode must not compute a digest');
    assert.ok(!('storageRef' in decoded), 'sync decode must not build a storageRef');
    assert.deepStrictEqual(Buffer.from(decoded.bytes), Buffer.from(PNG_B64, 'base64'));
    const bad: any = decodeDataUrl('data:image/png;base64');
    assert.ok(!bad.ok && bad.code === 'DATA_URL_MALFORMED');
});

test('prepared bytes are isolated between export runs and remain intact in the owning run', async () => {
    const first = await prepare(`![dot](data:image/png;base64,${PNG_B64})`, 'first');
    const second = await prepare('no images', 'second');
    assert.notEqual(first.resources, second.resources);
    assert.equal(second.domain.assets.length, 0);
    assert.equal(second.resources.size, 0);
    const id = first.domain.assets[0].id;
    assert.equal(second.resources.get(id), undefined);
    assert.deepEqual(Buffer.from(first.resources.get(id).bytes), Buffer.from(PNG_B64, 'base64'));
});
test('repeated original data URI has one semantic asset and two content placements', async () => {
    const uri = `data:image/png;base64,${PNG_B64}`;
    const result = await prepare(`![one](${uri})\n\n![two](${uri})`);
    assert.equal(result.domain.assets.length, 1);
    assert.equal(result.resources.size, 1);
    assert.equal(result.mounts.length, 1);
    assert.equal(result.domain.messages[0].content.length, 2);
    const ids = result.domain.messages[0].content.map((block: any) => block.children[0].assetId);
    assert.deepEqual(ids, [result.domain.assets[0].id, result.domain.assets[0].id]);
});
