/**
 * tests/pdf-dataurl-assets.test.ts
 * Tier 1 tests for data: URL -> byte-backed asset decoding (Scheme B).
 *
 * Covers: small base64 image -> 'available' + content-addressed storageRef +
 * bytes retrievable from the inline byte store + mimeType/sizeBytes/sha256 +
 * no sourceUrl + no PSEUDO_AVAILABLE from validateBundle; oversized payload
 * -> guard + diagnostic; malformed URLs -> 'missing' + diagnostic; URL-encoded
 * (non-base64) payloads; http(s) inline images unchanged.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const canonical = require('../src/core/export/canonical/index.js');
const { normalizeGeminiConversation, validateBundle } = canonical;
const assetsApi = require('../src/core/export/assets/index.js');
const {
    getInlineAssetBytes,
    hasInlineAssetBytes,
    clearInlineAssetBytes,
    decodeDataUrlAsset,
} = assetsApi;

// 1x1 transparent PNG, 70 bytes.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_SHA256 = 'c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77';
const PNG_REF = `assets/sha256/c4/14/${PNG_SHA256}.png`;

function convoWithContent(content: string) {
    return {
        id: 'c-dataurl',
        title: 'data url assets',
        messages: [{ id: 'm1', role: 'user', content }],
    };
}

function inlineAssetOf(bundle: any): any {
    assert.strictEqual(bundle.assets.length, 1);
    return bundle.assets[0];
}

test('small base64 data: URL decodes to a byte-backed available asset', async () => {
    clearInlineAssetBytes();
    const src = `data:image/png;base64,${PNG_B64}`;
    const { bundle, diagnostics } = await normalizeGeminiConversation(convoWithContent(`![dot](${src})`));
    const asset = inlineAssetOf(bundle);
    assert.strictEqual(asset.status, 'available');
    assert.strictEqual(asset.storageRef, PNG_REF);
    assert.strictEqual(asset.mimeType, 'image/png');
    assert.strictEqual(asset.sizeBytes, 70);
    assert.strictEqual(asset.sha256, PNG_SHA256);
    assert.ok(!('sourceUrl' in asset), 'full data: URL must not be stored in sourceUrl');
    assert.strictEqual(asset.name, 'dot', 'alt text wins over the derived name');

    const bytes = getInlineAssetBytes(asset.storageRef);
    assert.ok(bytes instanceof Uint8Array, 'bytes are retrievable from the inline byte store');
    assert.deepStrictEqual(Buffer.from(bytes), Buffer.from(PNG_B64, 'base64'), 'stored bytes match the decoded payload');

    const issues = validateBundle(bundle);
    assert.ok(!issues.some((d: any) => d.severity === 'error'), 'no validation errors');
    assert.ok(!issues.some((d: any) => d.code === 'PSEUDO_AVAILABLE'), 'no PSEUDO_AVAILABLE for the byte-backed asset');
    assert.ok(!diagnostics.some((d: any) => d.code === 'DATA_URL_TOO_LARGE' || d.code === 'DATA_URL_MALFORMED'));
});

test('data: URL asset without alt text gets a derived file name', async () => {
    clearInlineAssetBytes();
    const { bundle } = await normalizeGeminiConversation(convoWithContent(`![](data:image/png;base64,${PNG_B64})`));
    const asset = inlineAssetOf(bundle);
    assert.strictEqual(asset.name, 'image.png');
});

test('URL-encoded (non-base64) data: URL decodes', async () => {
    clearInlineAssetBytes();
    const payload = '%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E';
    const { bundle } = await normalizeGeminiConversation(convoWithContent(`![v](data:image/svg+xml,${payload})`));
    const asset = inlineAssetOf(bundle);
    assert.strictEqual(asset.status, 'available');
    assert.strictEqual(asset.mimeType, 'image/svg+xml');
    assert.ok(asset.storageRef.endsWith('.svg'), `storageRef keeps the svg extension: ${asset.storageRef}`);
    const expected = new TextEncoder().encode(decodeURIComponent(payload));
    assert.deepStrictEqual(Buffer.from(getInlineAssetBytes(asset.storageRef)!), Buffer.from(expected));
    assert.strictEqual(asset.sizeBytes, expected.length);
    const issues = validateBundle(bundle);
    assert.ok(!issues.some((d: any) => d.code === 'PSEUDO_AVAILABLE'));
});

test('oversized data: URL is refused with DATA_URL_TOO_LARGE', async () => {
    clearInlineAssetBytes();
    // 10 MiB + 1 byte of decoded payload; the guard fires before allocating.
    const overB64 = 'A'.repeat(Math.ceil((10 * 1024 * 1024 + 1) / 3) * 4);
    const { bundle, diagnostics } = await normalizeGeminiConversation(
        convoWithContent(`![big](data:image/png;base64,${overB64})`));
    const asset = inlineAssetOf(bundle);
    assert.strictEqual(asset.status, 'missing');
    assert.ok(asset.failureReason, 'failureReason is set');
    assert.ok(!('storageRef' in asset), 'no storageRef for a refused payload');
    assert.ok(!hasInlineAssetBytes('assets/sha256'), 'nothing stored');
    const diag = diagnostics.find((d: any) => d.code === 'DATA_URL_TOO_LARGE');
    assert.ok(diag, 'DATA_URL_TOO_LARGE warning diagnostic emitted');
    assert.strictEqual(diag.severity, 'warning');
    const issues = validateBundle(bundle);
    assert.ok(!issues.some((d: any) => d.code === 'ASSET_NO_REASON'), 'missing asset carries a failureReason');
});

test('malformed data: URLs become missing with DATA_URL_MALFORMED', async () => {
    const bad = [
        'data:image/png;base64', // no comma
        'data:image/png;base64,!!!not-base64!!!', // bad base64
        'data:image/png,%zz', // bad percent-encoding
    ];
    for (const src of bad) {
        clearInlineAssetBytes();
        const { bundle, diagnostics } = await normalizeGeminiConversation(convoWithContent(`![x](${src})`));
        const asset = inlineAssetOf(bundle);
        assert.strictEqual(asset.status, 'missing', src);
        assert.ok(asset.failureReason, `failureReason is set for ${src}`);
        assert.ok(diagnostics.some((d: any) => d.code === 'DATA_URL_MALFORMED'), `DATA_URL_MALFORMED for ${src}`);
    }
});

test('http(s) inline images keep the old remote behavior', async () => {
    clearInlineAssetBytes();
    const src = 'https://example.com/inline.png';
    const { bundle, diagnostics } = await normalizeGeminiConversation(convoWithContent(`![a](${src})`));
    const asset = inlineAssetOf(bundle);
    assert.strictEqual(asset.status, 'remote');
    assert.strictEqual(asset.sourceUrl, src);
    assert.ok(!('storageRef' in asset));
    assert.ok(!diagnostics.some((d: any) => d.code === 'DATA_URL_TOO_LARGE' || d.code === 'DATA_URL_MALFORMED'));
});

test('decodeDataUrlAsset unit checks: header parsing and strictness', () => {
    const ok = decodeDataUrlAsset(`data:image/png;base64,${PNG_B64}`);
    assert.ok(ok.ok);
    if (ok.ok) {
        assert.strictEqual(ok.mimeType, 'image/png');
        assert.strictEqual(ok.storageRef, PNG_REF);
        assert.strictEqual(ok.suggestedName, 'image.png');
    }
    // Whitespace inside base64 is insignificant.
    const spaced = decodeDataUrlAsset(`data:image/png;base64,${PNG_B64.slice(0, 20)} ${PNG_B64.slice(20)}`);
    assert.ok(spaced.ok && spaced.storageRef === PNG_REF);

    const noComma = decodeDataUrlAsset('data:image/png;base64');
    assert.ok(!noComma.ok && noComma.code === 'DATA_URL_MALFORMED');

    const badPad = decodeDataUrlAsset('data:image/png;base64,AB=C');
    assert.ok(!badPad.ok && badPad.code === 'DATA_URL_MALFORMED');

    const emptyType = decodeDataUrlAsset('data:,hello');
    assert.ok(emptyType.ok && emptyType.mimeType === 'application/octet-stream');
    if (emptyType.ok) assert.deepStrictEqual(Buffer.from(emptyType.bytes), Buffer.from('hello'));
});

test('inline byte store put/get/has round-trip', () => {
    clearInlineAssetBytes();
    assert.ok(!hasInlineAssetBytes('assets/sha256/zz/ref.png'));
    const { putInlineAssetBytes } = assetsApi;
    putInlineAssetBytes('assets/sha256/zz/ref.png', new Uint8Array([1, 2, 3]));
    assert.ok(hasInlineAssetBytes('assets/sha256/zz/ref.png'));
    assert.deepStrictEqual(Array.from(getInlineAssetBytes('assets/sha256/zz/ref.png')!), [1, 2, 3]);
    clearInlineAssetBytes();
    assert.ok(!hasInlineAssetBytes('assets/sha256/zz/ref.png'));
});
