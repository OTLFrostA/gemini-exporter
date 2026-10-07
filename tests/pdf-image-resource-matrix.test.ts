/** Image validation and binary mounting use only Document AST + PreparedResources. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resourceStage } from '../src/core/export/pdf/pipeline/resourceStage.js';
import { MAX_ASSET_BYTES, buildVirtualAssetPath } from '../src/core/export/assets/imageContent.js';
import { sha256Hex } from '../src/core/export/assets/sha256.js';
import type { PreparedResource } from '../src/core/export/assets/preparedResources.js';
import type { DocumentAst } from '../src/core/export/document/ast.js';
function sha256hex(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
const PATH_RE = /^assets\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z0-9]+$/;
async function mount(resources: Record<string, PreparedResource>, ids = Object.keys(resources)) {
    const document: DocumentAst = { schemaVersion: 2, header: { title: 'Image matrix', providerLabel: 'test', messageCount: 1 }, messages: [{ type: 'message', id: 'm', label: 'assistant', variant: 'flow', blocks: ids.map(resourceId => ({ type: 'image', resourceId, alt: resourceId })) }] };
    const before = JSON.stringify(document);
    const result = await resourceStage({ document, resources: new Map(Object.entries(resources)) }, { signal: new AbortController().signal, log() {}, reportProgress() {} });
    assert.equal(JSON.stringify(document), before);
    return { ...result.output, diagnostics: result.diagnostics };
}
function codesFor(result: Awaited<ReturnType<typeof mount>>, id: string) { return result.diagnostics.filter(d => d.path === `asset:${id}`).map(d => d.code); }
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];

function pngBytes(extra = 16, seed = 1): Uint8Array {
    const b = new Uint8Array(PNG_MAGIC.length + extra);
    b.set(PNG_MAGIC, 0);
    for (let i = PNG_MAGIC.length; i < b.length; i++) b[i] = (i * seed) & 0xff;
    return b;
}

function jpegBytes(extra = 16): Uint8Array {
    const b = new Uint8Array(JPEG_MAGIC.length + extra);
    b.set(JPEG_MAGIC, 0);
    for (let i = JPEG_MAGIC.length; i < b.length; i++) b[i] = i & 0xff;
    return b;
}

function svgBytes(): Uint8Array {
    return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', 'utf8');
}


test('real Web Crypto SHA-256 matches independent node crypto, including full image bytes', async () => {
    const bytes = pngBytes();
    assert.equal(await sha256Hex(bytes), sha256hex(bytes));
    const result = await mount({ a: { bytes, name: 'pic.png', mediaType: 'image/png' } });
    assert.match(result.pathMap.get('a')!, PATH_RE);
    assert.equal(result.pathMap.get('a'), buildVirtualAssetPath(sha256hex(bytes), 'png'));
    assert.equal(result.mounts[0].bytes, bytes);
    assert.equal(result.mounts[0].mimeType, 'image/png');
    assert.deepEqual(result.diagnostics, []);
});
for (const [id, resource, code] of [
    ['corrupt', { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), mediaType: 'image/png', name: 'x.png' }, 'ASSET_CORRUPT'],
    ['tiff', { bytes: new Uint8Array([7, 7, 7, 7]), mediaType: 'image/tiff', name: 'x.tiff' }, 'ASSET_UNSUPPORTED_MIME'],
    ['untyped', { bytes: new Uint8Array([9, 9, 9, 9]), name: 'blob' }, 'ASSET_UNSUPPORTED_MIME'],
    ['zero', { bytes: new Uint8Array(), mediaType: 'image/png' }, 'ASSET_ZERO_BYTES'],
] as const) {
    test(`invalid image is omitted with a diagnostic: ${id}`, async () => {
        const result = await mount({ [id]: resource });
        assert.equal(result.pathMap.get(id), undefined);
        assert.deepEqual(codesFor(result, id), [code]);
        assert.equal(result.unresolved[0].assetId, id);
    });
}
test('same filename cannot merge different bytes; duplicate bytes share only their physical mount', async () => {
    const one = pngBytes(16, 1), two = pngBytes(16, 2);
    const result = await mount({ a: { name: 'a.png', bytes: one }, b: { name: 'a.png', bytes: two }, c: { name: 'other.png', bytes: one } });
    assert.notEqual(result.pathMap.get('a'), result.pathMap.get('b'));
    assert.equal(result.pathMap.get('a'), result.pathMap.get('c'));
    assert.equal(result.pathMap.size, 3);
    assert.equal(result.mounts.length, 2);
});
test('multi-MB images below the binary size limit retain their complete bytes', async () => {
    const bytes = pngBytes(2 * 1024 * 1024);
    const result = await mount({ big: { bytes, mediaType: 'image/png' } });
    assert.ok(result.pathMap.get('big'));
    assert.equal(result.mounts[0].bytes.length, bytes.length);
});
test('50 MiB binary gate accepts the actual boundary and rejects one byte above it', async () => {
    assert.equal(MAX_ASSET_BYTES, 50 * 1024 * 1024);
    const edge = pngBytes(MAX_ASSET_BYTES - PNG_MAGIC.length);
    const passed = await mount({ edge: { bytes: edge, mediaType: 'image/png' } });
    assert.ok(passed.pathMap.get('edge'));
    const over = new Uint8Array(MAX_ASSET_BYTES + 1);
    const refused = await mount({ huge: { bytes: over, mediaType: 'image/png' } });
    assert.equal(refused.pathMap.size, 0);
    assert.deepEqual(codesFor(refused, 'huge'), ['ASSET_TOO_LARGE']);
    assert.ok(refused.diagnostics[0].message.includes(String(MAX_ASSET_BYTES)));
});
test('unprepared, absent and failed images never acquire bytes in the offline stage', async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('resourceStage must never fetch'); };
    try {
        const result = await mount({ remote: {}, missing: { failureReason: 'evicted from cache' }, failed: { failureReason: 'decode error' }, notFetched: {} }, ['remote', 'missing', 'failed', 'notFetched', 'absent']);
        assert.equal(result.pathMap.size, 0);
        assert.equal(result.unresolved.length, 5);
        for (const entry of result.unresolved) assert.deepEqual(codesFor(result, entry.assetId), ['RESOURCE_ASSET_UNRESOLVED']);
        assert.match(result.unresolved[0].reason, /no network fetch/);
        assert.match(result.unresolved[1].reason, /evicted from cache/);
        assert.match(result.unresolved[2].reason, /decode error/);
        assert.match(result.unresolved[4].reason, /no registered prepared resource/);
    } finally { globalThis.fetch = previous; }
});
test('validated image type wins over conflicting names and MIME metadata', async () => {
    const result = await mount({ extension: { bytes: pngBytes(), name: 'photo.jpg', mediaType: 'image/png' }, mime: { bytes: pngBytes(), name: 'x.jpg', mediaType: 'image/jpeg' } });
    assert.ok(result.pathMap.get('extension')!.endsWith('.png'));
    assert.deepEqual(codesFor(result, 'extension'), ['ASSET_EXTENSION_MISMATCH']);
    assert.ok(result.pathMap.get('mime')!.endsWith('.png'));
    assert.ok(codesFor(result, 'mime').includes('ASSET_MIME_MISMATCH'));
    assert.ok(codesFor(result, 'mime').includes('ASSET_EXTENSION_MISMATCH'));
});
test('SVG and JPEG alias are validated with their correct mount extensions', async () => {
    const result = await mount({ svg: { bytes: svgBytes(), mediaType: 'image/svg+xml', name: 'v.svg' }, jpeg: { bytes: jpegBytes(), mediaType: 'image/jpg', name: 'p.jpeg' } });
    assert.ok(result.pathMap.get('svg')!.endsWith('.svg'));
    assert.ok(result.pathMap.get('jpeg')!.endsWith('.jpg'));
    assert.deepEqual(codesFor(result, 'svg'), []);
});
test('content-addressed paths are deterministic across separate preparation runs', async () => {
    const resources = { k: { bytes: pngBytes(32, 7), mediaType: 'image/png' } };
    assert.deepEqual((await mount(resources)).pathMap, (await mount(resources)).pathMap);
});
test('real hashing failure is reported without inventing a successful mount', async () => {
    const previous = crypto.subtle.digest;
    crypto.subtle.digest = async () => { throw new Error('no hasher'); };
    try {
        const result = await mount({ hash: { bytes: pngBytes(), mediaType: 'image/png' } });
        assert.equal(result.pathMap.size, 0);
        assert.deepEqual(codesFor(result, 'hash'), ['ASSET_HASH_FAILED']);
        assert.match(result.unresolved[0].reason, /no hasher/);
    } finally { crypto.subtle.digest = previous; }
});
test('svg sniff: non-svg markup starting with < is NOT image/svg+xml', async () => {
    const cases: Array<[string, string]> = [
        ['x1', '<html>hello</html>'],
        ['x2', '<foo>bar</foo>'],
        ['x3', '<script>alert(1)</script>'],
        ['x4', '  \n <svgfoo></svgfoo>'],      // looks like svg but is a different tag
        ['x5', '<SVG></SVG>'],                // XML is case-sensitive; <SVG> is not <svg>
    ];
    for (const [id, text] of cases) {
        const result = await mount({ [id]: { mediaType: 'image/svg+xml', name: 'v.svg', bytes: Buffer.from(text, 'utf8') } });
        assert.strictEqual(result.pathMap.get(id), undefined, `${id} (${text}) must not resolve as SVG`);
        const codes = codesFor(result, id);
        assert.ok(
            codes.includes('ASSET_CORRUPT') || codes.includes('ASSET_UNSUPPORTED_MIME'),
            `${id} must be refused with a diagnostic, got: ${codes.join(',')}`,
        );
        assert.ok(!result.pathMap.get(id)?.endsWith('.svg'), `${id} must not get a .svg path`);
    }
});

test('svg sniff: xml declaration, comments, doctype and BOM still resolve', async () => {
    const cases: Array<[string, string]> = [
        ['s1', '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'],
        ['s2', '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"/>'],
        ['s3', '<!-- a comment --><svg/>'],
        ['s4', '<!-- one --><!-- two -->\n<svg width="10"/>'],
        ['s5', '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>'],
        ['s6', 'BOM-PLACEHOLDER'],
        ['s7', '  \n\t <svg viewBox="0 0 1 1"/>'],
    ];
    const BOM = '\uFEFF';
    for (const [id, text] of cases) {
        const content = id === 's6' ? BOM + '<svg/>' : text;
        const result = await mount({ [id]: { mediaType: 'image/svg+xml', name: 'v.svg', bytes: Buffer.from(content, 'utf8') } });
        assert.ok(result.pathMap.get(id)?.endsWith('.svg'), `${id} must resolve as SVG, got diagnostics: ${JSON.stringify(codesFor(result, id))}`);
        assert.deepStrictEqual(codesFor(result, id), [], `${id} must resolve cleanly`);
    }
});

test('svg sniff: unterminated prolog or duplicate xml declaration is refused', async () => {
    const cases: Array<[string, string]> = [
        ['u1', '<!-- never closed <svg/>'],
        ['u2', '<?xml version="1.0"'],
        ['u3', '<?xml version="1.0"?><?xml version="1.0"?><svg/>'],
    ];
    for (const [id, text] of cases) {
        const result = await mount({ [id]: { mediaType: 'image/svg+xml', name: 'v.svg', bytes: Buffer.from(text, 'utf8') } });
        assert.strictEqual(result.pathMap.get(id), undefined, `${id} must be refused`);
        assert.ok(codesFor(result, id).length > 0, `${id} refusal must carry a diagnostic`);
    }
});
