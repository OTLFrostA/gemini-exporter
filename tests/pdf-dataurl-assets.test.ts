import { fixtureAccountFor } from './helpers/domainFixture.js';
import { resourceValue } from './helpers/resources.js';
import type { ResourceBytes } from '../src/shared/resources/resourceResult.js';
const { historicalFixture } = require('./helpers/nativeFixture.js');
/** Inline source data stays in acquisition context; decoded bytes belong to PreparedResources. */
export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const { composeDomainDocument } = require('../src/l3b/compose/composeDomainDocument.js');
import { createSourceResourceContext } from '../src/l1/resources/sourceResources.js';
import { prepareExportResources } from '../src/application/export/prepareExportResources.js';
import { planExportPaths } from '../src/l4/packaging/index.js';
import { compileDocumentPdf } from '../src/l4/format/pdf/compileDocumentPdf.js';
import { buildMinimalValidPdf } from './helpers/stubPdfCompiler.js';
import { resourceDiagnostics } from '../src/shared/resources/resourceResult.js';
const { collectDocumentResources } = require('../src/l3b/ast/resourceReferences.js');
const { decodeDataUrl, decodeDataUrlAsset } = require('../src/l4/format/resources/dataUrl.js');
const { assertDomainClosure } = require('../src/l2/closure.js');
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_SHA256 = 'c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77';
const PNG_REF = `assets/sha256/c4/14/${PNG_SHA256}.png`;
async function prepare(content: string, id = 'dataurl') {
    const input = { id, title: 'data url assets', messages: [{ id: 'm1', role: 'user', content }] };
    const before = JSON.stringify(input);
    const parsed = historicalFixture(input, { providerId: 'gemini' });
    const domain = parsed.conversation;
    assertDomainClosure((domain).detail);
    const document = composeDomainDocument(domain, fixtureAccountFor(domain));
    const semantic = JSON.stringify({ domain, document });
    const context = createSourceResourceContext();
    const key = domain.index.key;
    // Retain only inline readers here. Remote acquisition is intentionally offline.
    context.retainParsed(key, { ...parsed, conversationId: key.conversationId, acquisitionHints: Object.fromEntries(Object.entries(parsed.acquisitionHints).filter(([, value]: [string, any]) => /^data:/i.test(value.url ?? value.sourceUrl ?? ''))) });
    try {
        const references = collectDocumentResources(document);
        const resources = await prepareExportResources(domain.detail.assets, references.referencedIds,
            (asset, signal) => context.acquire(key, asset, signal, async () => { throw new Error('no network fetch in offline test'); }));
        const [plan] = planExportPaths([{ conversation: domain, prepared: resources, fileIds: references.fileIds }], 'pdf');
        const mounts: Array<{ id: string; bytes: Uint8Array }> = [];
        let pathMap = new Map<string, string>();
        const compiled = await compileDocumentPdf(document, plan.resources, resources, {
            name: 'mount-inspection', async compile(payload, ctx) {
                pathMap = new Map(payload.assetPaths);
                for (const id of pathMap.keys()) {
                    const resolved = await ctx.assets.resolve(id);
                    if (resolved?.bytes) mounts.push({ id, bytes: resolved.bytes });
                }
                return { pdfBytes: buildMinimalValidPdf(), diagnostics: [] };
            },
        }, { signal: new AbortController().signal, reportProgress() {} });
        assert.equal(JSON.stringify({ domain, document }), semantic);
        assert.equal(JSON.stringify(input), before);
        return { domain, acquisitionHints: parsed.acquisitionHints, document, resources, pathMap, mounts,
            diagnostics: [...resourceDiagnostics([...resources.values()]), ...compiled.diagnostics],
            unresolved: [...resources.values()].filter(value => !value.ok) };
    } finally { context.release(); }
}
test('inline PNG bytes stay outside Domain; Packaging paths mount the exact prepared bytes', async () => {
    const source = `data:image/png;base64,${PNG_B64}`;
    const result = await prepare(`![dot](${source})`);
    assert.equal(result.domain.detail.assets.length, 1);
    const asset = result.domain.detail.assets[0];
    assert.equal(asset.sourceUri, undefined);
    assert.equal(result.acquisitionHints[asset.id].url, source);
    assert.match(result.pathMap.get(asset.id), /^assets\/.*\.png$/);
    assert.equal(resourceValue<ResourceBytes>(result.resources.get(asset.id)).mediaType, 'image/png');
    assert.deepEqual(Buffer.from(resourceValue<ResourceBytes>(result.resources.get(asset.id)).bytes), Buffer.from(PNG_B64, 'base64'));
    assert.deepEqual(Buffer.from(result.mounts[0].bytes), Buffer.from(PNG_B64, 'base64'), 'mounted bytes must equal the original PNG');
    assert.ok(!result.diagnostics.some((d: {code: string}) => d.code === 'FORMAT_CONTENT_OMITTED'));
    assert.deepEqual(JSON.parse(JSON.stringify(result.domain)), result.domain);
    for (const field of ['storageRef', 'status', 'sha256']) assert.ok(!(field in asset));
});
test('image without authored alt remains resolvable without inventing a semantic filename', async () => {
    const result = await prepare(`![](data:image/png;base64,${PNG_B64})`);
    assert.match(result.pathMap.get(result.domain.detail.assets[0].id), /^assets\/.*\.png$/);
    assert.equal(result.mounts.length, 1);
});
test('percent-encoded SVG input decodes before image mounting', async () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const result = await prepare(`![v](data:image/svg+xml,${encodeURIComponent(text)})`);
    const id = result.domain.detail.assets[0].id;
    assert.deepEqual(Buffer.from(resourceValue<ResourceBytes>(result.resources.get(id)).bytes), Buffer.from(text));
    assert.ok(result.pathMap.get(id)?.endsWith('.svg'));
    assert.ok(!result.diagnostics.some((d: {code: string}) => d.code === 'FORMAT_CONTENT_OMITTED'));
});
test('strict data URL decoder refuses oversized inline payloads before allocating decoded bytes', () => {
    const over = 'A'.repeat(Math.ceil((10 * 1024 * 1024 + 1) / 3) * 4);
    const result = decodeDataUrl(`data:image/png;base64,${over}`);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'DATA_URL_TOO_LARGE');
});
test('malformed original data URL failures are sidecar diagnostics', async () => {
    for (const uri of ['data:image/png;base64', 'data:image/png;base64,!!!not-base64!!!', 'data:image/png,%zz']) {
        const result = await prepare(`![x](${uri})`);
        const id = result.domain.detail.assets[0].id;
        assert.equal(result.domain.detail.assets[0].sourceUri, undefined);
        assert.equal(result.acquisitionHints[id].url, uri);
        assert.equal(result.mounts.length, 0);
        assert.ok(result.diagnostics.some((d: {code: string}) => d.code === 'RESOURCE_UNAVAILABLE' || d.code === 'FORMAT_CONTENT_OMITTED'));
    }
});
test('remote input remains a URI fact; offline preparation cannot invent bytes', async () => {
    const uri = 'https://example.com/inline.png';
    const result = await prepare(`![a](${uri})`);
    const id = result.domain.detail.assets[0].id;
    assert.equal(result.domain.detail.assets[0].sourceUri, uri);
    assert.equal(result.resources.get(id)?.ok, false);
    assert.equal(result.pathMap.size, 0);
    assert.match(result.unresolved[0]?.reason, /no network fetch/);
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
    assert.equal(second.domain.detail.assets.length, 0);
    assert.equal(second.resources.size, 0);
    const id = first.domain.detail.assets[0].id;
    assert.equal(second.resources.get(id), undefined);
    assert.deepEqual(Buffer.from(resourceValue<ResourceBytes>(first.resources.get(id)).bytes), Buffer.from(PNG_B64, 'base64'));
});
test('repeated original data URI has one semantic asset and two content placements', async () => {
    const uri = `data:image/png;base64,${PNG_B64}`;
    const result = await prepare(`![one](${uri})\n\n![two](${uri})`);
    assert.equal(result.domain.detail.assets.length, 1);
    assert.equal(result.resources.size, 1);
    assert.equal(result.mounts.length, 1);
    assert.equal(result.domain.detail.messages[0].content.length, 2);
    const ids = result.domain.detail.messages[0].content.map((block: any) => block.children[0].assetId);
    assert.deepEqual(ids, [result.domain.detail.assets[0].id, result.domain.detail.assets[0].id]);
});
