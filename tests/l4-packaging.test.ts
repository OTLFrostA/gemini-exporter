import { describe as __suiteDescribe } from 'node:test';
import { test } from "node:test";
import assert from "node:assert/strict";
import { createExportPathPlanner } from "../src/l4/packaging/index.js";
import { planExportPaths } from "../src/l4/packaging/index.js";
import { buildExportFiles } from "../src/l4/packaging/index.js";
import { buildResourceFiles } from "../src/l4/packaging/index.js";
import { packageExportFiles } from "../src/l4/packaging/index.js";
import { v2Account } from "./helpers/l4V2Fixtures.js";
import { v2Conversation } from "./helpers/l4V2Fixtures.js";
import { v2Document } from "./helpers/l4V2Fixtures.js";
import { type PreparedResources } from "../src/shared/resources/resourceResult.js";
import { __setZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { ZipWriter } from "../src/l4/packaging/writers/zipWriter.js";
import { isPrecompressedAsset } from "../src/l4/packaging/writers/zipWriter.js";
import { assertExportPath } from "../src/l4/packaging/exportPath.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import { renderDocumentTypst } from "./helpers/renderTypstFixture.js";
import { compileDocumentPdf } from "../src/l4/format/pdf/compileDocumentPdf.js";
import { PdfResourceError } from "../src/l4/format/pdf/errors.js";
import { missingResource } from "../src/shared/resources/resourceResult.js";
import { type PreparedResources as PreparedResources__s1 } from "../src/shared/resources/resourceResult.js";
import { type DocumentAst } from "../src/l3b/ast/ast.js";
import { type IPdfCompiler } from "../src/l4/format/pdf/pdfCompiler.js";
import { normalizeArchiveResourceName } from "../src/shared/utils/archivePath.js";

__suiteDescribe("l4-packaging", () => {
const JSZip = require('../lib/jszip.min.js');
test('ZIP preserves supplementary Unicode across streaming chunk boundaries', async () => {
    __setZipConstructor(JSZip);
    const content = 'x'.repeat(16383) + '👤 你\n' + 'y'.repeat(16382) + '🤖 助手';
    const writer = new ZipWriter();
    writer.writeFile('long.md', content);
    const zip = await JSZip.loadAsync(await (await writer.generateBlob()).arrayBuffer());
    const bytes = await zip.file('long.md').async('uint8array');
    assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(bytes), content);
});
const prepared: PreparedResources = new Map([
    ['a', { ok: true, resourceId: 'a', value: { bytes: new Uint8Array([1, 2]), mediaType: 'image/png' } }],
    ['b', { ok: true, resourceId: 'b', value: { bytes: new Uint8Array([3]), mediaType: 'image/png' } }],
    ['failed', { ok: false, resourceId: 'failed', reason: 'missing', code: 'MISSING' }],
]);
test('linked document paths are reserved before bytes arrive and attachment ZIP preserves them', async () => {
    __setZipConstructor(JSZip);
    const c = conversation();
    const planner = createExportPathPlanner('markdown');
    const plan = planner(c, new Map(), new Set(), undefined, new Set(['a', 'b']));
    const bodyPlan = { ...plan, externalResourceIds: new Set<string>() };
    const [body] = buildExportFiles('markdown', bodyPlan, 'body', new Map());
    assert.equal(body.fileName, plan.fileName);
    const attachments = buildResourceFiles(plan, prepared);
    const [archive] = await packageExportFiles([attachments], 'browserDownload', 'attachments.zip');
    assert.equal(archive.fileName, 'attachments.zip');
    const zip = await JSZip.loadAsync(await (archive.content as Blob).arrayBuffer());
    for (const path of Object.values(plan.resources)) assert.ok(zip.file(path), path);
    assert.deepEqual(Object.values(plan.resources), ['assets/123456_Photo.png', 'assets/123456_photo_2.png']);
});
test('one nested attachment is still delivered as a root-level ZIP', async () => {
    __setZipConstructor(JSZip);
    const [archive] = await packageExportFiles([[{fileName:'files/report.md',mimeType:'text/markdown',content:'report'}]],
        'browserDownload', 'attachments.zip');
    assert.equal(archive.fileName, 'attachments.zip');
    const zip = await JSZip.loadAsync(await (archive.content as Blob).arrayBuffer());
    assert.equal(await zip.file('files/report.md').async('string'), 'report');
});
test('independent tasks cannot bind a new document to stale attachment paths from a previous task', () => {
    const c = conversation();
    const expected = new Set(['a']);
    const first = createExportPathPlanner('markdown','task-one')(c,new Map(),new Set(),undefined,expected);
    const second = createExportPathPlanner('markdown','task-two')(c,new Map(),new Set(),undefined,expected);
    assert.equal(first.fileName,second.fileName,'folder document names remain stable');
    assert.notEqual(first.resources.a,second.resources.a);
    assert.match(first.resources.a,/^assets\/task-one\//);
    assert.match(second.resources.a,/^assets\/task-two\//);
});
function conversation(title = 'Chat') {
    // Fake L2's frozen v2 ReadonlyDomain input, never invoke L2 validation.
    return v2Conversation(title, [
        { id: 'a', kind: 'image', name: 'Photo.png' }, { id: 'b', kind: 'image', name: 'photo.png' },
        { id: 'failed', kind: 'file', name: 'missing.bin' },
    ]);
}
test('Packaging reserves batch paths case-insensitively and keeps resource IDs local', () => {
    const first = conversation();
    const second = conversation('chat');
    second.index.key.accountId = '10000000-0000-4000-8000-000000000002';
    second.detail.key = { ...second.index.key };
    const plans = planExportPaths([{ conversation: first, prepared, fileIds: new Set<string>() }, { conversation: second, prepared, fileIds: new Set<string>() }], 'markdown');
    assert.deepEqual(plans.map(p => p.fileName), ['Chat_123456.md', 'chat_123456_2.md']);
    assert.deepEqual(Object.values(plans[0].resources), ['assets/123456_Photo.png', 'assets/123456_photo_2.png']);
    assert.deepEqual(Object.values(plans[1].resources), ['assets/123456_Photo_3.png', 'assets/123456_photo_4.png']);
    assert.equal(plans[0].resources.failed, undefined);
});
test('Incremental path planner preserves the exact batch namespace and bindings', () => {
    const first = conversation();
    const second = conversation('chat');
    const planNext = createExportPathPlanner('markdown');
    const sequential = [planNext(first, prepared, new Set<string>()), planNext(second, prepared, new Set<string>())];
    const batch = planExportPaths([{ conversation: first, prepared, fileIds: new Set<string>() }, { conversation: second, prepared, fileIds: new Set<string>() }], 'markdown');
    assert.deepEqual(sequential, batch);
    assert.equal(sequential[1].fileName, 'chat_123456_2.md');
    assert.equal(sequential[1].resources.a, 'assets/123456_Photo_3.png');
});
test('Packaging reserves long sanitized collision suffixes without writer truncation', () => {
    const c = conversation('z'.repeat(200));
    c.detail.assets[0].name = 'x'.repeat(68) + '.longextension';
    c.detail.assets[1].name = c.detail.assets[0].name;
    const plans = planExportPaths(Array.from({ length: 12 }, () => ({ conversation: c, prepared, fileIds: new Set<string>() })), 'html');
    const paths = plans.flatMap(p => [p.fileName, ...Object.values(p.resources)]);
    assert.equal(new Set(paths.map(p => p.toLowerCase())).size, paths.length);
    paths.forEach(assertExportPath);
});
test('Packaging sanitizes traversal, encoded separators and reserved filenames before binding', () => {
    const c = conversation();
    c.detail.assets[0].name = '../../%2e%2e%2fCON.png';
    const [plan] = planExportPaths([{ conversation: c, prepared, fileIds: new Set<string>() }], 'json');
    Object.values(plan.resources).forEach(assertExportPath);
    assert.ok(!plan.resources.a.includes('%'));
});
for (const format of ['markdown', 'html', 'json'] as const) {
    test(`${format}: each binding becomes an external file, with main first and unchanged bytes`, async () => {
        const [plan] = planExportPaths([{ conversation: conversation(), prepared, fileIds: new Set<string>() }], format);
        const files = buildExportFiles(format, plan, 'body', prepared);
        assert.deepEqual(files.map(f => f.fileName), [plan.fileName, ...Object.values(plan.resources)]);
        assert.deepEqual(Object.keys(files[0]).sort(), ['content', 'fileName', 'mimeType']);
        const resource = prepared.get('a')!;
        assert.ok(resource.ok);
        assert.equal(files[1].content, resource.value.bytes);
        __setZipConstructor(JSZip);
        const [artifact] = await packageExportFiles([files], 'browserDownload');
        const zip = await JSZip.loadAsync(await (artifact.content as Blob).arrayBuffer());
        for (const file of files) assert.ok(zip.file(file.fileName), file.fileName);
        assert.equal(zip.file(plan.fileName) !== null, true);
        assert.ok(!Object.keys(zip.files).some(path => path.startsWith('gemini_export/')));
    });
}
test('Packaging rejects dangling external bindings before Delivery; Image-only PDF emits only main', () => {
    const input = { conversation: conversation(), prepared, fileIds: new Set<string>() };
    const [markdownPlan] = planExportPaths([input], 'markdown');
    // A Markdown plan must export its successful bindings; losing a prepared
    // resource after path planning fails closed before Delivery.
    assert.throws(() => buildExportFiles('markdown', markdownPlan, 'body', new Map()), /Bound resource unavailable/);
    const [pdfPlan] = planExportPaths([input], 'pdf');
    assert.equal(pdfPlan.externalResourceIds.size, 0, 'PDF without AST File references embeds images only');
    assert.equal(buildExportFiles('pdf', pdfPlan, new Uint8Array([1]), prepared).length, 1);
});
test('DOCX files are already compressed for batch ZIP packaging', () => {
    assert.equal(isPrecompressedAsset('conversation.docx'), true);
});

test('ZIP decision uses actual flattened files and delivery, never format or batch count', async () => {
    __setZipConstructor(JSZip);
    const a = { fileName: 'a.pdf', mimeType: 'application/pdf', content: new Uint8Array([1]) };
    const b = { ...a, fileName: 'b.pdf' };
    assert.deepEqual(await packageExportFiles([[a]], 'browserDownload'), [a]);
    assert.deepEqual(await packageExportFiles([[a], [], [b]], 'folderWriter'), [a, b]);
    assert.deepEqual(await packageExportFiles([[a]], 'folderWriter'), [a]);
    assert.match((await packageExportFiles([[a], [b]], 'browserDownload'))[0].fileName, /^conversations_\d+\.zip$/);
    assert.deepEqual(await packageExportFiles([[]], 'browserDownload'), []);
    await assert.rejects(packageExportFiles([[a, a]], 'folderWriter'), /Duplicate/);
});
test('ZIP writer rejects unsafe paths rather than rewriting renderer bindings', () => {
    __setZipConstructor(JSZip);
    const writer = new ZipWriter();
    for (const path of ['', '/root', '../x', 'assets/%2e%2e/x', 'a\\b', 'CON', 'a//b', 'a/'.repeat(2), 'z'.repeat(90) + '.md']) {
        assert.throws(() => writer.writeFile(path, 'x'), /Unsafe|Noncanonical|Empty/);
    }
});
test('ZIP generation failures reject without producing a delivery artifact', async () => {
    __setZipConstructor(class { file() {} async generateAsync(): Promise<never> { throw new Error('zip failed'); } });
    await assert.rejects(packageExportFiles([[{ fileName: 'a.md', mimeType: 'text/markdown', content: 'body' }, { fileName: 'b.md', mimeType: 'text/markdown', content: 'second' }]], 'browserDownload'), /zip failed/);
});

test('Format references resolve to the same planned ZIP entries for Markdown and HTML', async () => {
    __setZipConstructor(JSZip);
    const c = conversation();
    // L3b is outside L4; pass a v2 AST fixture directly to real format backends.
    const document = v2Document([
        { type: 'image', resourceId: 'a', alt: 'Photo' },
        { type: 'image', resourceId: 'b', alt: 'Photo' },
    ], { title: c.index.title, id: c.index.key.conversationId });
    for (const format of ['markdown', 'html'] as const) {
        const [plan] = planExportPaths([{ conversation: c, prepared, fileIds: new Set<string>() }], format);
        const content = format === 'markdown' ? renderDocumentMarkdown(document, plan.resources)
            : renderDocumentHtml(document, plan.resources).html;
        const files = buildExportFiles(format, plan, content, prepared);
        const [packed] = await packageExportFiles([files], 'browserDownload');
        const zip = await JSZip.loadAsync(await (packed.content as Blob).arrayBuffer());
        for (const path of Object.values(plan.resources)) {
            const encoded = path.split('/').map(encodeURIComponent).join('/');
            assert.ok(content.includes(encoded), `${format} reference: ${path}`);
            assert.ok(zip.file(path), `${format} entry: ${path}`);
        }
    }
});

test('Packaging adds missing resource extensions and preserves existing ones', () => {
    const c = conversation();
    c.detail.assets = [
        { id: 'a', kind: 'image', name: 'Generated Image', mediaType: 'image/png' },
        { id: 'b', kind: 'image', name: 'Generated Image.png', mediaType: 'image/png' },
        { id: 'doc', kind: 'file', name: 'Notes', document: { contentMarkdown: '# Notes' } },
        { id: 'unnamed.id', kind: 'file' },
    ];
    const bytes = new Uint8Array([1]);
    // Application has filled the trusted Domain MIME fallback for a and b.
    const resources: PreparedResources = new Map(c.detail.assets.map(asset => [asset.id, {
        ok: true, resourceId: asset.id, value: { bytes, mediaType: asset.mediaType },
    }]));
    const [plan] = planExportPaths([{ conversation: c, prepared: resources, fileIds: new Set<string>() }], 'markdown');
    assert.deepEqual(Object.values(plan.resources), [
        'assets/123456_Generated Image.png', 'assets/123456_Generated Image_2.png',
        'files/123456_Notes.md', 'files/123456_unnamed.id.bin',
    ]);
    const files = buildExportFiles('markdown', plan, 'body', resources);
    assert.equal(files[1].mimeType, 'image/png');
    assert.equal(files[4].mimeType, 'application/octet-stream');
});

test('folder attachment paths are stable across tasks, formats and batch order, with account and provider scopes', () => {
    const c = conversation();
    const account = v2Account();
    const expected = new Set(['a', 'b']);
    const first = createExportPathPlanner('markdown')(c, new Map(), new Set(), undefined, expected, account);
    assert.deepEqual(Object.values(first.resources), [
        `assets/gemini/${account.id}/same123456/Photo.png`,
        `assets/gemini/${account.id}/same123456/photo_2.png`,
    ]);
    const next = createExportPathPlanner('html');
    next(v2Conversation('Other', c.detail.assets, { conversationId: 'other123456' }), new Map(), new Set(), undefined, expected, account);
    assert.deepEqual(next(c, new Map(), new Set(), undefined, expected, account).resources, first.resources);
    assert.deepEqual(next(c, new Map(), new Set(), undefined, expected, account).resources, first.resources);
    const secondAccount = v2Account('gemini', '10000000-0000-4000-8000-000000000002');
    const other = v2Conversation('Other account', c.detail.assets, { accountId: secondAccount.id });
    assert.notEqual(next(other, new Map(), new Set(), undefined, expected, secondAccount).resources.a, first.resources.a);
    assert.match(next(c, new Map(), new Set(), undefined, expected, v2Account('chatgpt')).resources.a, /^assets\/chatgpt\//);
});
});

__suiteDescribe("l4-internal-contract", () => {
function domain() {
    // Mock the L2 v2 boundary using data only, not L2's production validator.
    return v2Conversation('Contract', [
        { id: 'image', kind: 'image', name: 'photo.png' },
        { id: 'file', kind: 'file', name: 'notes.txt' },
        { id: 'dual', kind: 'image', name: 'both.png' },
    ]);
}
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const fileBytes = new Uint8Array([65, 66, 67]);
const prepared: PreparedResources__s1 = new Map([
    ['image', { ok: true, resourceId: 'image', value: { bytes: png, mediaType: 'image/png' } }],
    ['file', { ok: true, resourceId: 'file', value: { bytes: fileBytes, mediaType: 'text/plain' } }],
    ['dual', { ok: true, resourceId: 'dual', value: { bytes: png, mediaType: 'image/png' } }],
]);

test('L4 Packaging uses AST File purposes, not source asset kind, to deliver PDF originals', async () => {
    const c = domain();
    const fileIds = new Set(['file', 'dual']);
    const plan = createExportPathPlanner('pdf')(c, prepared, fileIds);
    assert.deepEqual([...plan.externalResourceIds], ['file', 'dual']);
    assert.equal(Object.keys(plan.resources).length, 3);
    const pdfBytes = new TextEncoder().encode('%PDF-1.7\n' + ' '.repeat(80));
    const files = buildExportFiles('pdf', plan, pdfBytes, prepared);
    assert.deepEqual(files.map(f => f.fileName), [plan.fileName, plan.resources.file, plan.resources.dual]);
    assert.equal(files[1].content, fileBytes);
    assert.equal(files[2].content, png);
    const planned = planExportPaths([{ conversation: c, prepared, fileIds }], 'pdf');
    assert.deepEqual(planned[0], plan);
    const JSZip = require('../lib/jszip.min.js');
    __setZipConstructor(JSZip);
    const output = await packageExportFiles([files], 'browserDownload');
    assert.equal(output.length, 1);
    assert.equal(output[0].mimeType, 'application/zip');
    const zip = await JSZip.loadAsync(await (output[0].content as Blob).arrayBuffer());
    for (const f of files) assert.ok(zip.file(f.fileName), f.fileName);
    assert.equal(zip.file(plan.resources.image), null);
});

test('L4 Packaging externalizes every bound resource for Markdown, HTML and JSON', () => {
    for (const format of ['markdown', 'html', 'json'] as const) {
        const plan = planExportPaths([{ conversation: domain(), prepared, fileIds: new Set<string>() }], format)[0];
        assert.deepEqual([...plan.externalResourceIds], ['image', 'file', 'dual']);
        assert.equal(buildExportFiles(format, plan, 'body', prepared).length, 4);
    }
    const pdf = createExportPathPlanner('pdf')(domain(), prepared, new Set<string>());
    assert.equal(pdf.externalResourceIds.size, 0);
    assert.equal(buildExportFiles('pdf', pdf, new Uint8Array([1]), prepared).length, 1);
});

const document: DocumentAst = {
    title: 'Contract',
    metadata: { id: 'test', provider: 'gemini' },
    messages: [{
        role: 'assistant',
        blocks: [
            { type: 'paragraph', children: [
                { type: 'link', href: 'javascript:alert(1)', children: [{ type: 'text', text: 'Unsafe label' }] },
                { type: 'link', href: 'https://example.com/path?q=1', children: [{ type: 'text', text: 'Safe label' }] },
            ] },
            { type: 'disclosure', kind: 'reasoning', title: 'Reasoning', blocks: [
                { type: 'paragraph', children: [{ type: 'text', text: 'Visible thoughts' }] },
            ] },
        ],
    }],
};

test('L4 reading formats have fixed en/front matter/collapse behavior and safe links', () => {
    const markdown = renderDocumentMarkdown(document, {});
    assert.ok(markdown.startsWith('---\ntitle: "Contract"\nid: "test"'));
    assert.ok(markdown.includes('<details>\n<summary>Reasoning</summary>'));
    assert.ok(!markdown.includes('](javascript:'));
    assert.ok(markdown.includes('[Safe label](https://example.com/path?q=1)'));
    const { html } = renderDocumentHtml(document, {});
    assert.ok(html.includes('1 messages'));
    assert.ok(html.includes('<details class="gem-thoughts">'));
    assert.ok(!html.includes('class="gem-thoughts" open'));
    assert.ok(!html.includes('href="javascript:'));
    assert.ok(html.includes('href="https://example.com/path?q=1"'));
    assert.ok(html.includes('Unsafe label'));
    const payload = renderDocumentTypst(document, {});
    const para = payload.messages[0].blocks[0];
    assert.equal(para.type, 'paragraph');
    if (para.type !== 'paragraph') return;
    assert.equal(para.children[0].type, 'text');
    assert.equal(para.children[1].type, 'link');
    assert.equal(payload.layout.page.widthMm > 0, true);
});

const pdfBytes = new TextEncoder().encode('%PDF-1.7\n' + ' '.repeat(80));
const pdfDocument: DocumentAst = {
    title: 'PDF',
    metadata: { id: 'one', provider: 'gemini' },
    messages: [{ role: 'assistant', blocks: [
        { type: 'image', resourceId: 'image', alt: 'Photo' },
        { type: 'file', resourceId: 'file', label: 'Notes', kind: 'file' },
    ] }],
};
function compileContext() {
    return { signal: new AbortController().signal, reportProgress() {} };
}

test('L4 PDF mounts AST Image bytes only, not successful File-only resources', async () => {
    const compiler: IPdfCompiler = { name: 'test', async compile(payload, context) {
        assert.deepEqual([...payload.assetPaths], [['image', 'assets/photo.png']]);
        assert.equal(await context.assets.resolve('file'), null);
        assert.deepEqual(await context.assets.resolve('image'), { bytes: png });
        return { pdfBytes, diagnostics: [] };
    } };
    const result = await compileDocumentPdf(pdfDocument,
        { image: 'assets/photo.png', file: 'files/notes.txt' }, prepared, compiler, compileContext());
    assert.equal(result.pdfBytes, pdfBytes);
    assert.ok(!result.diagnostics.some(d => d.code === 'FORMAT_CONTENT_OMITTED'));
});

test('L4 PDF marks acquired unsupported images as omitted, not acquisition failures', async () => {
    const corrupted: PreparedResources__s1 = new Map([
        ['image', { ok: true, resourceId: 'image', value: { bytes: new Uint8Array([1, 2]), mediaType: 'image/png' } }],
        ['file', { ok: true, resourceId: 'file', value: { bytes: fileBytes, mediaType: 'text/plain' } }],
    ]);
    const compiler: IPdfCompiler = { name: 'test', async compile(payload) {
        assert.equal(payload.assetPaths.size, 0);
        assert.equal(payload.document.messages[0].blocks[0].type, 'unknown');
        return { pdfBytes, diagnostics: [] };
    } };
    const out = await compileDocumentPdf(pdfDocument, { image: 'assets/photo.png' },
        corrupted, compiler, compileContext());
    assert.ok(out.diagnostics.some(d => d.code === 'FORMAT_CONTENT_OMITTED'));
});

test('L4 PDF safely degrades image-decoder failure without reacquiring resource', async () => {
    let compiles = 0;
    const compiler: IPdfCompiler = { name: 'test', async compile(payload) {
        compiles++;
        if (compiles === 1) {
            assert.equal(payload.assetPaths.has('image'), true);
            throw new PdfResourceError([missingResource('image', 'Unsupported decoder', 'TYPST_ASSET_DECODE_FAILED')]);
        }
        assert.equal(payload.assetPaths.size, 0);
        assert.equal(payload.document.messages[0].blocks[0].type, 'unknown');
        return { pdfBytes, diagnostics: [] };
    } };
    const out = await compileDocumentPdf(pdfDocument, { image: 'assets/photo.png' },
        prepared, compiler, compileContext());
    assert.equal(compiles, 2);
    assert.ok(out.diagnostics.some(d => d.code === 'FORMAT_CONTENT_OMITTED'));
});

test('L4 Markdown preserves merged table span structure and safely escapes HTML content', () => {
    const doc: DocumentAst = {
        title: 'Merged table',
        metadata: { id: 'merge', provider: 'gemini' },
        messages: [{ role: 'assistant', blocks: [{
            type: 'table',
            columnAlignments: ['left', 'right'],
            headerRows: [[{ children: [{ type: 'text', text: 'A' }], column: 0, colSpan: 2, rowSpan: 1 }]],
            rows: [[{ children: [{ type: 'text', text: '<unsafe>' }], column: 0, colSpan: 1, rowSpan: 1 },
                { children: [{ type: 'strong', children: [{ type: 'text', text: 'Emphasis' }] }], column: 1, colSpan: 1, rowSpan: 1 }]],
        }] }],
    };
    const markdown = renderDocumentMarkdown(doc, {});
    assert.ok(markdown.includes('<th colspan="2">A</th>'));
    assert.ok(markdown.includes('&lt;unsafe&gt;'));
    assert.ok(markdown.includes('<strong>Emphasis</strong>'));
    assert.ok(!markdown.includes('<unsafe>'));
});
});

__suiteDescribe("l4-resource-path", () => {
/** Pure L4 resource path tests with a frozen v2 AST input. L1 extraction is tested separately. */






test('L4 archive paths preserve namespaces, and bare filenames use assets', () => {
    for (const [input, expected] of [
        ['foo.png', 'assets/foo.png'], ['assets/foo.png', 'assets/foo.png'],
        ['files/foo.md', 'files/foo.md'], ['files/nested/foo.pdf', 'files/nested/foo.pdf'],
        ['./files//foo.md', 'files/foo.md'], ['files\\nested\\foo.pdf', 'files/nested/foo.pdf'],
    ]) assert.equal(normalizeArchiveResourceName(input), expected);
});
test('L4 archive paths reject traversal, absolute drives and encoded separators', () => {
    for (const path of ['../foo', '../../etc/passwd', '/absolute/path', 'C:/foo', '//server/foo',
        'files/../foo', 'files/%2e%2e/foo', '%2fabsolute', 'files/%00foo', 'files/..\\foo']) {
        assert.throws(() => normalizeArchiveResourceName(path), /archive resource path/i);
    }
});
test('L4 archive paths preserve legitimate literal percent characters', () => {
    for (const [input, expected] of [
        ['75%酒精.jpg', 'assets/75%酒精.jpg'], ['5%阿昔洛韦.png', 'assets/5%阿昔洛韦.png'],
        ['files/report_50%.md', 'files/report_50%.md'], ['files/test%.pdf', 'files/test%.pdf'],
        ['assets/100%_pure.webp', 'assets/100%_pure.webp'],
    ]) assert.equal(normalizeArchiveResourceName(input), expected);
});
test('L4 HTML takes a prepared files/ path from Packaging, not an L1 attachment parser', () => {
    const document = v2Document([{ type: 'file', kind: 'file', resourceId: 'resource-1', label: 'test_config.json' }]);
    const result = renderDocumentHtml(document, { 'resource-1': 'files/cb8bd7_test_config.json' });
    assert.match(result.html, /href="files\/cb8bd7_test_config.json"/);
    assert.deepEqual(result.diagnostics, []);
});
});
