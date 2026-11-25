import { describe as __suiteDescribe } from 'node:test';
import { test } from "node:test";
import assert from "node:assert/strict";
import { v2Document } from "./helpers/l4V2Fixtures.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { renderDocumentTypst } from "./helpers/renderTypstFixture.js";
import { type DocumentAst } from "../src/l3b/ast/ast.js";
import { type ResourceBindings } from "../src/l4/shared/resourceBindings.js";
import test__s1 from "node:test";
import { fileBadge } from "../src/l4/format/shared/backendPresentation.js";
import { type DisplayBlock } from "../src/l3b/ast/ast.js";
import { type PreparedResources } from "../src/shared/resources/resourceResult.js";
import { type IPdfCompiler } from "../src/l4/format/pdf/pdfCompiler.js";
import { compileDocumentPdf } from "../src/l4/format/pdf/compileDocumentPdf.js";
import { simulateMitexInitFailureForTesting } from "../src/l4/format/typst/mathConverter.js";
import { resetMitexForTesting } from "../src/l4/format/typst/mathConverter.js";
import { MAX_ASSET_BYTES } from "../src/l4/format/resources/imageContent.js";
import { missingResource } from "../src/shared/resources/resourceResult.js";
import { type ResourceFailure } from "../src/shared/resources/resourceResult.js";
import { type ResourceBytes } from "../src/shared/resources/resourceResult.js";

__suiteDescribe("l4-v2-renderer-unit", () => {
/** Frozen L3b v2 DocumentAst + Packaging bindings are input mocks; real L4 outputs are under test. */









const bindings: ResourceBindings = { image: 'assets/Chosen name.png', file: 'files/report.txt' };
const document: DocumentAst = v2Document([
    { type: 'heading', level: 2, children: [{ type: 'text', text: 'Heading <unsafe>' }] },
    { type: 'paragraph', children: [
        { type: 'strong', children: [{ type: 'text', text: 'Hello & friends' }] },
        { type: 'text', text: ' ' },
        { type: 'link', href: 'https://example.com/path?q=1', children: [{ type: 'text', text: 'Source' }] },
        { type: 'text', text: ' ' },
        { type: 'link', href: 'javascript:alert(1)', children: [{ type: 'text', text: 'Untrusted' }] },
    ] },
    { type: 'code', language: 'typescript', code: 'const x = 1 < 2;', meta: 'example.ts' },
    { type: 'list', ordered: false, items: [
        { blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'first' }] }] },
        { blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'second' }] }] },
    ] },
    { type: 'image', resourceId: 'image', alt: 'Diagram' },
    { type: 'file', resourceId: 'file', label: 'report.txt', kind: 'file' },
    { type: 'disclosure', kind: 'reasoning', title: 'Reasoning', blocks: [
        { type: 'paragraph', children: [{ type: 'text', text: 'private outline' }] },
    ] },
    { type: 'unsupported', sourceType: 'future', text: 'Keep me' },
], { title: 'v2 Fixture', id: 'c1' });

test('v2 AST passes through all three real L4 text/Typst backends without a composer', () => {
    const before = structuredClone(document);
    const html = renderDocumentHtml(document, bindings);
    const md = renderDocumentMarkdown(document, bindings);
    const typst = renderDocumentTypst(document, bindings);
    assert.match(html.html, /<h2 class="gem-heading">Heading &lt;unsafe&gt;<\/h2>/);
    assert.ok(html.html.includes('assets/Chosen%20name.png'));
    assert.ok(html.html.includes('files/report.txt'));
    assert.ok(html.html.includes('private outline'));
    // The v2 HTML renderer reports an informational diagnostic for a future
    // unsupported node instead of silently losing the source fact.
    assert.deepEqual(html.diagnostics.map(d => d.code), ['HTML_UNKNOWN_BLOCK']);
    assert.equal(html.diagnostics.some(d => d.code === 'FORMAT_CONTENT_OMITTED'), false);
    assert.ok(md.includes('## Heading &lt;unsafe&gt;'));
    assert.ok(md.includes('assets/Chosen%20name.png'));
    assert.ok(md.includes('files/report.txt'));
    assert.ok(md.includes('<details>'));
    assert.equal(typst.messages.length, 1);
    assert.ok(typst.messages[0].blocks.length > 0);
    assert.deepEqual(document, before, 'L4 must not mutate upstream AST');
});

test('upstream bindings are required: missing resource remains visible without invoking acquisition', () => {
    const html = renderDocumentHtml(document, {});
    const md = renderDocumentMarkdown(document, {});
    const typst = renderDocumentTypst(document, {});
    assert.equal(html.diagnostics.filter(d => d.code === 'HTML_ASSET_UNRESOLVED').length, 2);
    assert.ok(html.html.includes('gem-missing-asset'));
    assert.ok(md.includes('Diagram') && md.includes('report.txt'));
    assert.ok(typst.messages[0].blocks.some(block => block.type === 'unknown'));
});

test('L4 safely degrades untrusted v2 link references', () => {
    const html = renderDocumentHtml(document, bindings).html;
    const markdown = renderDocumentMarkdown(document, bindings);
    assert.ok(html.includes('Untrusted'));
    assert.ok(markdown.includes('Untrusted'));
    assert.ok(!html.includes('href="javascript:'));
    assert.ok(!markdown.includes('](javascript:'));
    assert.ok(html.includes('href="https://example.com/path?q=1"'));
});

test('table spans are presented from L3b v2 cells without re-running composer layout', () => {
    const table = v2Document([{ type: 'table', columnAlignments: ['left', 'right'],
        headerRows: [[{ column: 0, colSpan: 2, rowSpan: 1, children: [{ type: 'text', text: 'Merged' }] }]],
        rows: [[
            { column: 0, colSpan: 1, rowSpan: 1, children: [{ type: 'text', text: 'left' }] },
            { column: 1, colSpan: 1, rowSpan: 1, children: [{ type: 'text', text: 'right' }] },
        ]] }]);
    const html = renderDocumentHtml(table, {}).html;
    const markdown = renderDocumentMarkdown(table, {});
    const typst = renderDocumentTypst(table, {});
    assert.ok(html.includes('colspan="2"'));
    assert.ok(markdown.includes('<th colspan="2">Merged</th>'));
    assert.equal(typst.messages[0].blocks[0].type, 'table');
});

test('locale is a renderer-only option, independent of the v2 document schema', () => {
    const en = renderDocumentHtml(document, bindings, { locale: 'en' }).html;
    const zh = renderDocumentHtml(document, bindings, { locale: 'zh' }).html;
    assert.notEqual(en, zh);
    assert.ok(renderDocumentMarkdown(document, bindings, { locale: 'zh' }).length > 0);
    assert.equal(renderDocumentTypst(document, bindings, { locale: 'zh' }).messages.length, 1);
});
});

__suiteDescribe("document-file-badge", () => {
test__s1('file badge maps office/media types to short labels and safely falls back', () => {
    const cases = [
        ['application/pdf', 'PDF'], ['application/msword', 'DOC'],
        ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'DOCX'],
        ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'XLSX'],
        ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PPTX'],
        [' APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT ; charset=UTF-8', 'DOCX'],
        ['application/vnd.oasis.opendocument.text', 'ODT'], ['text/plain; charset=utf-8', 'TXT'],
        ['image/svg+xml', 'SVG'], ['application/x-zip-compressed', 'ZIP'],
        ['application/vnd.unknown-very-long-subtype', 'FILE'], ['__proto__/unknown', 'FILE'], ['application/octet-stream', 'FILE'],
    ];
    const blocks: Extract<DisplayBlock, { type: 'file' }>[] = cases.map(([mediaType]) => ({ type: 'file', resourceId: 'f', label: 'misleading.exe', kind: 'file', mediaType }));
    assert.deepEqual(blocks.map(fileBadge), cases.map(([, badge]) => badge));
    assert.equal(fileBadge({ ...blocks[0], kind: 'file', mediaType: undefined }), 'FILE');
    for (const [kind, expected] of [['image', 'IMAGE'], ['audio', 'AUDIO'], ['video', 'VIDEO'], ['other', 'FILE']] as const) {
        assert.equal(fileBadge({ ...blocks[0], kind, mediaType: 'application/unknown' }), expected);
    }
    assert.equal(fileBadge({ ...blocks[0], kind: 'other', mediaType: 'image/unknown' }), 'IMAGE');
    const document: DocumentAst = { title: 'Badges', metadata: { id: 'fixture', provider: 'test' }, messages: [{ role: 'assistant', blocks }] };
    const html = renderDocumentHtml(document, { f: 'assets/f' }).html;
    const pdf = renderDocumentTypst(document, {});
    assert.deepEqual([...html.matchAll(/gem-att-badge">([^<]+)</g)].map(match => match[1]), cases.map(([, badge]) => badge));
    assert.deepEqual(pdf.messages[0].blocks.map(block => block.type === 'file' && block.kind), cases.map(([, badge]) => badge));
});
});

__suiteDescribe("l4-html-v2-unit", () => {
/** L4 HTML unit tests: L3b's frozen v2 DocumentAst is a fixture, not a live composer. */






test('HTML uses the supplied v2 AST and prepared offline file destination unchanged', () => {
    const document = v2Document([
        { type: 'paragraph', children: [{ type: 'text', text: 'look at this' }] },
        { type: 'file', resourceId: 'file-1', label: 'x.pdf', kind: 'file' },
    ], { title: 'HTML export', role: 'user' });
    const resources: ResourceBindings = { 'file-1': 'files/x.pdf' };
    const before = JSON.stringify(document);
    const result = renderDocumentHtml(document, resources);
    assert.ok(result.html.startsWith('<!DOCTYPE html>'));
    assert.match(result.html, /href="files\/x.pdf"/);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(JSON.stringify(document), before, 'L4 must not mutate its upstream AST fixture');
    assert.ok(!JSON.stringify(document).includes('files/x.pdf'), 'export paths are Packaging-owned');
});
test('HTML missing v2 resource binding emits a visible fallback and diagnostic', () => {
    const document = v2Document([
        { type: 'paragraph', children: [{ type: 'text', text: 'file below' }] },
        { type: 'file', resourceId: 'missing-file', kind: 'file', label: 'y.pdf' },
    ]);
    const result = renderDocumentHtml(document, {});
    assert.ok(result.html.includes('gem-missing-asset'));
    assert.ok(result.html.includes('y.pdf'));
    assert.equal(result.diagnostics.filter(d => d.code === 'HTML_ASSET_UNRESOLVED').length, 1);
});
});

__suiteDescribe("pdf-format", () => {
const document: DocumentAst = {
    title: 'Title', metadata: { id: 'c', provider: 'p' },
    messages: [{ role: 'assistant', blocks: [
        { type: 'image', resourceId: 'image', alt: 'Figure' },
        { type: 'file', resourceId: 'file', label: 'notes.pdf', kind: 'file' },
        { type: 'math', source: 'x^2' },
    ] }],
};
const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const prepared: PreparedResources = new Map([['image', { ok: true, resourceId: 'image', value: { bytes: image, mediaType: 'image/png' } }]]);
const bindings = { image: 'assets/Chosen name.png', file: 'files/notes.pdf' };
const pdf = new TextEncoder().encode('%PDF-1.7\n' + ' '.repeat(80));
const context = () => ({ signal: new AbortController().signal, reportProgress() {} });

test('PDF mounts the Packaging path verbatim and only resolves supplied image bytes', async () => {
    const before = structuredClone(document);
    let calls = 0;
    const compiler: IPdfCompiler = { name: 'test', async compile(payload, ctx) {
        calls++;
        assert.deepEqual([...payload.assetPaths], [['image', bindings.image]]);
        assert.equal((payload.document.messages[0].blocks[0] as { asset: string }).asset, bindings.image);
        assert.deepEqual(await ctx.assets.resolve('image'), { bytes: image });
        assert.equal(await ctx.assets.resolve('file'), null);
        assert.equal(await ctx.assets.resolve('unknown'), null);
        assert.equal(payload.document.messages[0].blocks[1].type, 'file');
        return { pdfBytes: pdf, diagnostics: [{ severity: 'info', code: 'COMPILED', message: 'ok' }] };
    } };
    const result = await compileDocumentPdf(document, bindings, prepared, compiler, context());
    assert.equal(calls, 1);
    assert.equal(result.pdfBytes, pdf);
    assert.equal(result.diagnostics.at(-1)?.code, 'COMPILED');
    assert.deepEqual(document, before);
});

test('corrupt and absent images produce readable placeholders, retaining captions', async () => {
    const doc = structuredClone(document);
    doc.messages[0].blocks[0] = { type: 'image', resourceId: 'image', alt: 'Figure', caption: [{ type: 'text', text: 'Important caption' }] };
    const compiler: IPdfCompiler = { name: 'test', async compile(payload) {
        assert.equal(payload.assetPaths.size, 0);
        const block = payload.document.messages[0].blocks[0];
        assert.equal(block.type, 'unknown');
        assert.match(JSON.stringify(block), /Important caption/);
        return { pdfBytes: pdf, diagnostics: [] };
    } };
    const corrupt: PreparedResources = new Map([['image', { ok: true, resourceId: 'image', value: { bytes: new Uint8Array([1]), mediaType: 'image/png' } }]]);
    const result = await compileDocumentPdf(doc, bindings, corrupt, compiler, context());
    assert.ok(result.diagnostics.some(d => d.code === 'ASSET_CORRUPT'));
    assert.ok(result.diagnostics.some(d => d.code === 'FORMAT_CONTENT_OMITTED'), 'acquired-but-unrenderable image is partial');
    await compileDocumentPdf(doc, {}, new Map(), compiler, context());
});

test('compile failure propagates without a second render, retry or delivery', async () => {
    let calls = 0;
    const compiler: IPdfCompiler = { name: 'test', async compile() { calls++; throw new Error('sandbox failed'); } };
    await assert.rejects(compileDocumentPdf(document, bindings, prepared, compiler, context()), /sandbox failed/);
    assert.equal(calls, 1);
});

test('invalid PDF output and cancellation are explicit failures', async () => {
    for (const bytes of [new Uint8Array(), new Uint8Array(100), new TextEncoder().encode('%PDF-')]) {
        const compiler: IPdfCompiler = { name: 'test', async compile() { return { pdfBytes: bytes, diagnostics: [] }; } };
        await assert.rejects(compileDocumentPdf(document, {}, new Map(), compiler, context()), /invalid PDF/);
    }
    const abort = new AbortController(); abort.abort();
    const compiler: IPdfCompiler = { name: 'test', async compile() { assert.fail('aborted compilation must not start'); } };
    await assert.rejects(compileDocumentPdf(document, {}, new Map(), compiler, { ...context(), signal: abort.signal }), { name: 'AbortError' });
});

test('each conversation retains its own bindings and bytes for overlapping resource IDs', async () => {
    for (const path of ['assets/first.png', 'assets/second.png']) {
        const compiler: IPdfCompiler = { name: 'test', async compile(payload) {
            assert.equal(payload.assetPaths.get('image'), path);
            return { pdfBytes: pdf, diagnostics: [] };
        } };
        await compileDocumentPdf(document, { image: path }, prepared, compiler, context());
    }
});

test('all renderers use supplied local bindings and visibly degrade invalid paths', () => {
    for (const path of ['', '../image.png', '/image.png', 'https://example.test/image.png', 'javascript:alert(1)']) {
        const resources: ResourceBindings = { image: path };
        assert.doesNotMatch(renderDocumentMarkdown(document, resources), /!\[/);
        assert.ok(renderDocumentHtml(document, resources).diagnostics.some(d => d.code === 'HTML_ASSET_UNRESOLVED'));
        assert.equal(renderDocumentTypst(document, resources).messages[0].blocks[0].type, 'unknown');
    }
    assert.match(renderDocumentMarkdown(document, bindings), /assets\/Chosen%20name.png/);
    assert.match(renderDocumentHtml(document, bindings).html, /assets\/Chosen%20name.png/);
});

test('MiTeX initialization failure preserves source math with a diagnostic', async () => {
    resetMitexForTesting();
    simulateMitexInitFailureForTesting(() => new Error('unavailable'));
    const compiler: IPdfCompiler = { name: 'test', async compile(payload) {
        const math = payload.document.messages[0].blocks[2];
        assert.equal(math.type, 'math');
        assert.match(JSON.stringify(math), /x\^2/);
        assert.equal('typst' in math, false);
        return { pdfBytes: pdf, diagnostics: [] };
    } };
    try {
        const result = await compileDocumentPdf(document, {}, new Map(), compiler, context());
        assert.ok(result.diagnostics.some(d => d.code === 'TYPST_MATH_INIT_FAILED'));
    } finally {
        simulateMitexInitFailureForTesting(null);
        resetMitexForTesting();
    }
});

test('abort during compilation rejects even when the compiler returns bytes', async () => {
    const abort = new AbortController();
    const compiler: IPdfCompiler = { name: 'test', async compile() {
        abort.abort();
        return { pdfBytes: pdf, diagnostics: [] };
    } };
    await assert.rejects(compileDocumentPdf(document, {}, new Map(), compiler, { ...context(), signal: abort.signal }), { name: 'AbortError' });
});
});

__suiteDescribe("pdf-image-resource-matrix", () => {
/** Image validation and binary mounting use only Document AST + ResourceBytess. */






async function mount(resources: Record<string, ResourceBytes | ResourceFailure>, ids = Object.keys(resources)) {
    const document: DocumentAst = { title: 'Image matrix', metadata: { id: 'fixture', provider: 'test' }, messages: [{ role: 'assistant', blocks: ids.map(resourceId => ({ type: 'image', resourceId, alt: resourceId })) }] };
    const before = JSON.stringify(document);
    const prepared = new Map(Object.entries(resources).map(([resourceId, value]) => [resourceId, 'ok' in value ? value : { ok: true as const, resourceId, value }]));
    const bindings = Object.fromEntries(ids.map(id => [id, `assets/${id}.fixture`]));
    const pathMap = new Map<string, string>();
    const mounts: Array<{ bytes: Uint8Array }> = [];
    const result = await compileDocumentPdf(document, bindings, prepared, {
        name: 'image-check-probe', async compile(payload, context) {
            for (const [id, path] of payload.assetPaths) {
                assert.equal(path, bindings[id], 'Format must preserve Packaging paths');
                pathMap.set(id, path);
                const mounted = await context.assets.resolve(id);
                assert.ok(mounted?.bytes);
                mounts.push({ bytes: mounted.bytes });
            }
            return { pdfBytes: new TextEncoder().encode('%PDF-1.7\n' + ' '.repeat(80)), diagnostics: [] };
        },
    }, { signal: new AbortController().signal, reportProgress() {} });
    assert.equal(JSON.stringify(document), before);
    return { pathMap, mounts, diagnostics: result.diagnostics };
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


test('PDF uses the supplied path and retains validated bytes without hashing', async () => {
    const bytes = pngBytes();
    const result = await mount({ a: { bytes, name: 'pic.png', mediaType: 'image/png' } });
    assert.equal(result.pathMap.get('a'), 'assets/a.fixture');
    assert.equal(result.mounts[0].bytes, bytes);
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
        assert.deepEqual(codesFor(result, id), [code, 'FORMAT_CONTENT_OMITTED']);
    });
}
test('same filenames or duplicate bytes never change Packaging paths', async () => {
    const one = pngBytes(16, 1), two = pngBytes(16, 2);
    const result = await mount({ a: { name: 'a.png', bytes: one }, b: { name: 'a.png', bytes: two }, c: { name: 'other.png', bytes: one } });
    assert.notEqual(result.pathMap.get('a'), result.pathMap.get('b'));
    assert.notEqual(result.pathMap.get('a'), result.pathMap.get('c'));
    assert.equal(result.pathMap.size, 3);
    assert.equal(result.mounts.length, 3);
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
    assert.deepEqual(codesFor(refused, 'huge'), ['ASSET_TOO_LARGE', 'FORMAT_CONTENT_OMITTED']);
});
test('unprepared, absent and failed images never acquire bytes in the offline stage', async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('resourceStage must never fetch'); };
    try {
        const result = await mount({ remote: missingResource('remote', 'no network fetch'), missing: missingResource('missing', 'evicted from cache'), failed: missingResource('failed', 'decode error'), notFetched: missingResource('notFetched', 'no network fetch') }, ['remote', 'missing', 'failed', 'notFetched', 'absent']);
        assert.equal(result.pathMap.size, 0);
        assert.equal(result.diagnostics.filter(d => d.code === 'TYPST_V8_IMAGE_MISSING').length, 5);

    } finally { globalThis.fetch = previous; }
});
test('validated image type wins over conflicting names and MIME metadata', async () => {
    const result = await mount({ extension: { bytes: pngBytes(), name: 'photo.jpg', mediaType: 'image/png' }, mime: { bytes: pngBytes(), name: 'x.jpg', mediaType: 'image/jpeg' } });
    assert.equal(result.pathMap.get('extension'), 'assets/extension.fixture');
    assert.deepEqual(codesFor(result, 'extension'), ['ASSET_EXTENSION_MISMATCH']);
    assert.equal(result.pathMap.get('mime'), 'assets/mime.fixture');
    assert.ok(codesFor(result, 'mime').includes('ASSET_MIME_MISMATCH'));
    assert.ok(codesFor(result, 'mime').includes('ASSET_EXTENSION_MISMATCH'));
});
test('SVG and JPEG aliases are validated without renaming Packaging paths', async () => {
    const result = await mount({ svg: { bytes: svgBytes(), mediaType: 'image/svg+xml', name: 'v.svg' }, jpeg: { bytes: jpegBytes(), mediaType: 'image/jpg', name: 'p.jpeg' } });
    assert.equal(result.pathMap.get('svg'), 'assets/svg.fixture');
    assert.equal(result.pathMap.get('jpeg'), 'assets/jpeg.fixture');
    assert.deepEqual(codesFor(result, 'svg'), []);
});
test('Packaging paths are stable across separate compilations', async () => {
    const resources = { k: { bytes: pngBytes(32, 7), mediaType: 'image/png' } };
    assert.deepEqual((await mount(resources)).pathMap, (await mount(resources)).pathMap);
});
test('an unavailable hasher cannot interfere with PDF Format', async () => {
    const previous = crypto.subtle.digest;
    crypto.subtle.digest = async () => { throw new Error('PDF must not hash'); };
    try {
        const result = await mount({ hash: { bytes: pngBytes(), mediaType: 'image/png' } });
        assert.equal(result.pathMap.get('hash'), 'assets/hash.fixture');
        assert.deepEqual(result.diagnostics, []);
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
        assert.equal(result.pathMap.get(id), `assets/${id}.fixture`, `${id} must resolve as SVG, got diagnostics: ${JSON.stringify(codesFor(result, id))}`);
        assert.deepStrictEqual(codesFor(result, id), [], `${id} must resolve cleanly`);
    }
});

test('svg sniff: unterminated prolog or duplicate xml declaration is refused', async () => {
    const cases: Array<[string, string]> = [
        ['10000000-0000-4000-8000-000000000002', '<!-- never closed <svg/>'],
        ['10000000-0000-4000-8000-000000000003', '<?xml version="1.0"'],
        ['10000000-0000-4000-8000-000000000004', '<?xml version="1.0"?><?xml version="1.0"?><svg/>'],
    ];
    for (const [id, text] of cases) {
        const result = await mount({ [id]: { mediaType: 'image/svg+xml', name: 'v.svg', bytes: Buffer.from(text, 'utf8') } });
        assert.strictEqual(result.pathMap.get(id), undefined, `${id} must be refused`);
        assert.ok(codesFor(result, id).length > 0, `${id} refusal must carry a diagnostic`);
    }
});
});
