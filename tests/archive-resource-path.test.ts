import { describe as __suiteDescribe } from 'node:test';
import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreDomainSnapshot } from "../src/l2/runtimeValidation.js";
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { planExportPaths } from "../src/l4/packaging/index.js";
import { buildExportFiles } from "../src/l4/packaging/index.js";
import { packageExportFiles } from "../src/l4/packaging/index.js";
import { serializeDomainJson } from "../src/l4/format/json/serializeDomainJson.js";
import { __setZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { type PreparedResources } from "../src/shared/resources/resourceResult.js";
import { indexFixture } from "./helpers/indexFixture.js";
import test__s4 from "node:test";
import { ZipWriter } from "../src/l4/packaging/writers/zipWriter.js";
import { prepareExportResources } from "../src/application/export/prepareExportResources.js";
import { createSourceResourceContext } from "../src/l1/resources/sourceResources.js";
import { __getZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { type WriteFileContent } from "../src/l4/shared/writerInterface.js";
import { type WriteFileOptions } from "../src/l4/shared/writerInterface.js";
import test__s5 from "node:test";
import { runExport } from "../src/application/export/runExport.js";
import { getExportRecord } from "../src/l3a/storageService.js";
import { exportKey } from "./helpers/v2ExportHost.js";
import { exportRequest } from "./helpers/v2ExportHost.js";
import { seedExportConversation } from "./helpers/v2ExportHost.js";
import { v2ExportHost } from "./helpers/v2ExportHost.js";

__suiteDescribe("archive-resource-path", () => {
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeArchiveResourceName: normalizeLocalName } = require('../src/shared/utils/archivePath.js');
const { extractAttachmentInlineBytes } = require('../src/l1/resources/attachmentBytes.js');
const { parseFixture } = require('./helpers/documentFixture.js');
const { renderDocumentHtml } = require('../src/l4/format/html/renderHtml.js');



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

test('Domain attachment uses files namespace through HTML output', async () => {
    const { domain, document, resources } = await parseFixture({ id: 'cb8bd7', messages: [{
        id: 'm1', role: 'user', content: 'Attachment', attachments: [{
            type: 'file', name: 'test_config.json', localName: 'files/cb8bd7_test_config.json',
        }],
    }] });
    assert.equal(resources[domain.detail.assets[0].id], 'files/cb8bd7_test_config.json');
    const result = renderDocumentHtml(document, resources);
    assert.match(typeof result === 'string' ? result : result.html, /href="files\/cb8bd7_test_config.json"/);
});

test('archive resource names allow legitimate literal percent characters in filenames', () => {
    for (const [input, expected] of [
        ['75%酒精.jpg', 'assets/75%酒精.jpg'],
        ['5%阿昔洛韦.png', 'assets/5%阿昔洛韦.png'],
        ['files/report_50%.md', 'files/report_50%.md'],
        ['files/cold%sore.png', 'files/cold%sore.png'],
        ['files/test%2.pdf', 'files/test%2.pdf'],
        ['files/test%.pdf', 'files/test%.pdf'],
        ['assets/100%_pure.webp', 'assets/100%_pure.webp'],
        ['files/report_%E7%96.md', 'files/report_%E7%96.md'],
    ]) {
        assert.equal(normalizeLocalName(input), expected);
    }
});

test('extractAttachmentInlineBytes decodes contentMarkdown as UTF-8 bytes', () => {
    const markdown = '# Hello 世界 🧪\nSome content';
    const bytes = extractAttachmentInlineBytes({ contentMarkdown: markdown });
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(bytes), markdown);
    assert.deepEqual(bytes, new TextEncoder().encode(markdown), 'multibyte Unicode must be encoded as UTF-8');

    const attEmpty = { contentMarkdown: '   ' };
    assert.equal(extractAttachmentInlineBytes(attEmpty), null);
});
});

__suiteDescribe("archive-resource-gate", () => {
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
test('strict archive resource resolver and Tier2 gate regressions', () => {
    const result = spawnSync('python3', ['-m', 'unittest', 'tests.archive_resources_test'], {
        cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
});

__suiteDescribe("l4-json-packaging.integration", () => {
/**
 * Cross-module evidence retained from Packaging's former mixed unit scenario:
 * actual v2 L2 trust boundary + L4 JSON archive + L4 ZIP.
 * Not part of the isolated L4 unit gate, which stubs L2 services.
 */








const JSZip = require('../lib/jszip.min.js');

test('v2 L2 trusted Domain -> L4 JSON references -> same planned ZIP entries', async () => {
    const key = fixtureKey('same123456', 'gemini');
    const conversation = restoreDomainSnapshot({
        index: { key, title: 'Chat', titleSource: 'derived' },
        detail: { key, quality: { status: 'complete' }, messages: [
            { role: 'assistant', content: [{ type: 'image', assetId: 'a' }, { type: 'image', assetId: 'b' }] },
        ], assets: [
            { id: 'a', kind: 'image', name: 'Photo.png' },
            { id: 'b', kind: 'image', name: 'photo.png' },
        ] },
    });
    const prepared: PreparedResources = new Map([
        ['a', { ok: true, resourceId: 'a', value: { bytes: new Uint8Array([1, 2]), mediaType: 'image/png' } }],
        ['b', { ok: true, resourceId: 'b', value: { bytes: new Uint8Array([3]), mediaType: 'image/png' } }],
    ]);
    const [plan] = planExportPaths([{ conversation, prepared, fileIds: new Set<string>() }], 'json');
    const content = serializeDomainJson(conversation, fixtureAccountFor(conversation), plan.resources);
    const files = buildExportFiles('json', plan, content, prepared);
    __setZipConstructor(JSZip);
    const [packed] = await packageExportFiles([files], 'browserDownload');
    const zip = await JSZip.loadAsync(await (packed.content as Blob).arrayBuffer());
    for (const path of Object.values(plan.resources)) {
        assert.ok(content.includes(path), 'JSON reference: ' + path);
        assert.ok(zip.file(path), 'ZIP entry: ' + path);
    }
});
});

__suiteDescribe("p1_h2_pathwriter", () => {
const test = require('node:test');
const assert = require('node:assert');

const pathUtils = require('../src/shared/utils/pathUtils.js');
const { mergeConversationIndex, indexActivityTime } = require('../src/l2/conversationIndex.js');

test('p1_h2 - P1-102: con.md is rewritten, not left as a reserved name', () => {
    const out = pathUtils.sanitizeFileName('con.md');
    assert.notStrictEqual(out.toLowerCase(), 'con.md');
    assert.ok(out.endsWith('.md'), `extension preserved, got ${out}`);
});

test('p1_h2 - P1-103: COM/LPT 1..99 are reserved', () => {
    for (const name of ['com1', 'com10', 'com99', 'lpt1', 'lpt42', 'lpt99']) {
        const out = pathUtils.sanitizeFileName(name);
        assert.notStrictEqual(out.toLowerCase(), name, `${name} must be rewritten`);
    }
    const out = pathUtils.sanitizeFileName('lpt99.txt');
    assert.notStrictEqual(out.toLowerCase(), 'lpt99.txt');
    assert.ok(out.endsWith('.txt'));
});

test('p1_h2 - P1-104: long emoji names truncate without lone surrogates', () => {
    const out = pathUtils.sanitizeFileName('😀'.repeat(100));
    assert.strictEqual([...out].length, 70);
    for (const ch of out) {
        const cp = ch.codePointAt(0)!;
        assert.ok(!(cp >= 0xd800 && cp <= 0xdfff), 'lone surrogate found');
    }
});

test('p1_h2 - P1-105: buildExportFileName strips path traversal from extension', () => {
    const out = pathUtils.buildExportFileName('title', 'c_123', '../../etc/passwd');
    assert.ok(!out.includes('/') && !out.includes('..'), `got ${out}`);
    assert.ok(out.length > 0);
});

test('p1_h2 - P1-105b: buildExportFileName preserves _cid6 under downstream sanitizeRelativePath even with long titles', () => {
    const longTitle = '在 Kerr 黑洞时空几何背景下，基于 Newman-Penrose 零四标架投影推导 Teukolsky 主方程（Teukolsky Master Equation），并严格展示辐射规范下拉普拉斯-';
    const out = pathUtils.buildExportFileName(longTitle, '2f088360411acd53', 'md');
    assert.ok(out.endsWith('_1acd53.md'), `filename must end with _1acd53.md, got ${out}`);
    const cleaned = pathUtils.sanitizeRelativePath(out, 'file');
    assert.strictEqual(cleaned, out, 'downstream sanitizeRelativePath must not truncate _cid6');
});

test('p1_h2 - P1-107: takeout placeholder titles do not flow back in', () => {
    const bad = indexFixture({ id: 'c_1', titles: { takeout: 'Google Gemini' } });
    assert.strictEqual(bad.title, undefined, 'placeholder must not be selected as a title');
    const good = indexFixture({ id: 'c_1', title: 'Weekend hiking plan', titleSource: 'derived' });
    assert.strictEqual(good.titleSource, 'derived');
    assert.strictEqual(good.title, 'Weekend hiking plan');
});

test('p1_h2 - P1-108: mergeConversation honors digit-string updatedAt', () => {
    const oldC = { id: 'c_1', updatedAt: '2024-01-01T00:00:00.000Z', title: 'Old' };
    const inc = { id: 'c_1', updatedAt: '1726358400000', title: 'New' };
    const r = mergeConversationIndex(indexFixture(oldC), indexFixture(inc));
    assert.notDeepStrictEqual(r, indexFixture(oldC), 'newer digit-string timestamp should win');
    const eff = indexActivityTime(r);
    assert.strictEqual(eff, 1726358400000);
});

test('p1_h2 - P1-110: fenced/inline code keeps HTML-like content', () => {
    const html = '<pre><code class="language-html">&lt;div&gt;hi&lt;/div&gt;</code></pre>'
        + '<p>real <b>bold</b> text</p>'
        + '<p>sample <code>List&lt;String&gt;</code> and <code>&lt;h1&gt;t&lt;/h1&gt;</code></p>';
    const { convertHtmlToMarkdown } = require('../src/l1/parsers/shared/html/htmlToMarkdown.js');
    const out = convertHtmlToMarkdown(html);
    assert.ok(out.includes('<div>hi</div>'), 'fenced code content must survive');
    assert.ok(out.includes('`List<String>`'), 'inline code generic must survive');
    assert.ok(out.includes('`<h1>t</h1>`'), 'inline code must not be rewritten by heading pass');
    assert.ok(out.includes('**bold**'), 'real bold outside code still converts');
});

test('p1_h2 - P1-115: ZipWriter refuses beyond safe budget instead of warning', async () => {
    (globalThis as any).self = (globalThis as any).self || {};
    (globalThis as any).self.JSZip = (globalThis as any).self.JSZip || require('../lib/jszip.min.js');
    const { ZipWriter } = require('../src/l4/packaging/writers/zipWriter.js');
    const w = new ZipWriter();
    assert.throws(
        () => w.writeFile('big.bin', { byteLength: 300 * 1024 * 1024 } as any),
        /200MB/
    );
});

test('p1_h2 - P1-116: FsWriter serializes concurrent writes to the same path', async () => {
    const { FsWriter } = require('../src/l4/delivery/writers/fsWriter.js');
    const events: string[] = [];
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    // Tag writables by creation order to observe interleaving.
    let n = 0;
    const dirHandle2: any = {
        getDirectoryHandle: async () => dirHandle2,
        getFileHandle: async (_name: string, _opts: any) => ({
            createWritable: async () => {
                const tag = `w${++n}`;
                return {
                    write: async () => { events.push(`${tag}:start`); await delay(30); events.push(`${tag}:end`); },
                    close: async () => {}
                };
            }
        })
    };
    const w = new FsWriter(dirHandle2);
    await Promise.all([w.writeFile('same.txt', 'aaa'), w.writeFile('same.txt', 'bbb')]);
    const i0s = events.indexOf('w1:start'), i0e = events.indexOf('w1:end');
    const i1s = events.indexOf('w2:start'), i1e = events.indexOf('w2:end');
    assert.ok(i0s !== -1 && i1s !== -1, `both writes ran: ${events.join(',')}`);
    const interleaved = (i0s < i1s && i1s < i0e) || (i1s < i0s && i0s < i1e);
    assert.ok(!interleaved, `same-path writes must serialize, got ${events.join(',')}`);
});

test('p1_h2 - review fix (c): writeChains map does not grow without bound', async () => {
    const { FsWriter } = require('../src/l4/delivery/writers/fsWriter.js');
    const written: string[] = [];
    const fakeFile = () => ({
        createWritable: async () => ({
            write: async (c: any) => { written.push(String(c)); },
            close: async () => {}
        })
    });
    const fakeDir = {
        name: 'gemini_export',
        getFileHandle: async () => fakeFile()
    };
    const w = new FsWriter(fakeDir);
    // concurrent writes to the same path must serialize and leave no chain residue
    await Promise.all([
        w.writeFile('same.md', 'one'),
        w.writeFile('same.md', 'two'),
        w.writeFile('other.md', 'three')
    ]);
    assert.strictEqual(w.__writeChains.size, 0, `chain map must be empty after writes, got ${w.__writeChains.size}`);
    assert.deepStrictEqual(written.slice().sort(), ['one', 'three', 'two']);
});
});

__suiteDescribe("b1_writer_unified", () => {
// Retained writer behaviors on V2 Packaging and task-owned resource acquisition.









const captured = new Map<string, { content: WriteFileContent; options: WriteFileOptions }>();
class MockJSZip {
    file(path: string, content: WriteFileContent, options: WriteFileOptions) { captured.set(path, { content, options }); }
    async generateAsync() { return new Blob(['mock-zip']); }
}
let previousJSZip: ReturnType<typeof __getZipConstructor>;
test__s4.beforeEach(() => { previousJSZip = __getZipConstructor(); captured.clear(); __setZipConstructor(MockJSZip); });
test__s4.afterEach(() => { __setZipConstructor(previousJSZip); });

test__s4('B1 - 10 PNG resources pass through Packaging and writer with byte accounting and STORE compression', async () => {
    const assets = Array.from({ length: 10 }, (_, i) => ({ id: `image-${i}`, kind: 'image' as const }));
    const required = new Set(assets.map(asset => asset.id));
    const bytes = new Uint8Array(64 * 1024);
    const prepared = await prepareExportResources(assets, required, async () => ({ bytes }));
    const files = buildExportFiles('markdown', { fileName: 'chat.md',
        resources: Object.fromEntries(assets.map((asset, i) => [asset.id, `assets/img${i}.png`])),
        externalResourceIds: required }, 'body', prepared);
    const writer = new ZipWriter();
    writer.MAX_SAFE_ZIP_BYTES = 4 + 10 * bytes.byteLength;
    for (const file of files) writer.writeFile(file.fileName, file.content);
    assert.throws(() => writer.writeFile('assets/overflow.bin', new Uint8Array([0])), /上限/);
    assert.equal(captured.size, 11);
    assert.equal(captured.has('assets/overflow.bin'), false);
    for (const [path, entry] of captured) assert.equal(entry.options.compression, path.endsWith('.png') ? 'STORE' : 'DEFLATE');
});
test__s4('B1 - 200MB limit rejects the 201st one-MB resource before writing it', () => {
    const writer = new ZipWriter(), bytes = new Uint8Array(1024 * 1024);
    assert.equal(writer.MAX_SAFE_ZIP_BYTES, 200 * 1024 * 1024);
    for (let i = 0; i < 200; i++) writer.writeFile(`assets/big_${i}.bin`, bytes);
    assert.throws(() => writer.writeFile('assets/big_200.bin', bytes), /200MB/);
    assert.equal(captured.size, 200);
});
test__s4('B1 - task-owned Takeout bytes flow through the same Packaging writer without a network request', async () => {
    const context = createSourceResourceContext();
    const key = { accountId: '10000000-0000-4000-8000-000000000001', conversationId: 'chat' };
    const asset = { id: 'takeout', kind: 'file' as const };
    try {
        context.retain(key, asset.id, async () => ({ bytes: new Uint8Array([9, 9, 9]) }));
        const prepared = await prepareExportResources([asset], new Set([asset.id]), candidate => context.acquire(key, candidate));
        const files = buildExportFiles('markdown', { fileName: 'chat.md', resources: { takeout: 'files/f.bin' },
            externalResourceIds: new Set([asset.id]) }, 'body', prepared);
        await packageExportFiles([files], 'browserDownload');
        assert.deepEqual(captured.get('files/f.bin')?.content, new Uint8Array([9, 9, 9]));
    } finally { context.release(); }
});
test__s4('B1 - Packaging emits only declared conversation artifacts without retired session metadata', async () => {
    await packageExportFiles([[{ fileName: 'a.md', content: 'A', mimeType: 'text/markdown' }],
        [{ fileName: 'b.md', content: 'B', mimeType: 'text/markdown' }]], 'browserDownload');
    assert.deepEqual([...captured.keys()], ['a.md', 'b.md']);
});
test__s4('B1 - empty Packaging cannot create diagnostics or session recovery artifacts', async () => {
    assert.deepEqual(await packageExportFiles([[]], 'browserDownload'), []);
    assert.equal(captured.size, 0);
});
test__s4('B1 - unavailable bound resources fail closed before writer delivery', () => {
    assert.throws(() => buildExportFiles('markdown', { fileName: 'chat.md', resources: { missing: 'files/missing.bin' },
        externalResourceIds: new Set(['missing']) }, 'body', new Map()), /Bound resource unavailable/);
    assert.equal(captured.size, 0);
});
});

__suiteDescribe("zip_utf8_byte_cap", () => {
const JSZip = require('../lib/jszip.min.js');

test__s5('batch browser export enforces the ZIP cap in UTF-8 bytes before delivery or commit', async t => {
    const host = v2ExportHost(t);
    const previousZip = __getZipConstructor();
    const originalWrite = ZipWriter.prototype.writeFile;
    let writes = 0;
    __setZipConstructor(JSZip);
    ZipWriter.prototype.writeFile = function (...args) {
        this.MAX_SAFE_ZIP_BYTES = 4096;
        writes++;
        return originalWrite.apply(this, args);
    };
    t.after(() => {
        ZipWriter.prototype.writeFile = originalWrite;
        __setZipConstructor(previousZip);
    });
    const ids = ['汉'.repeat(600), 'small'];
    for (const id of ids) await seedExportConversation(id);
    const result = await runExport(exportRequest(ids));

    assert.ok(writes > 0, 'the application must reach the real ZIP writer');
    assert.equal(host.clicks(), 0, 'oversized UTF-8 content must not be downloaded');
    assert.equal(host.blobs.length, 0);
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, ids.map(exportKey));
    for (const id of ids) assert.equal(await getExportRecord(exportKey(id)), null);
});

test__s5('ZIP cap accepts exact UTF-8 boundaries and rejects overflow before adding a file', t => {
    const previousZip = __getZipConstructor();
    __setZipConstructor(JSZip);
    t.after(() => __setZipConstructor(previousZip));
    for (const content of ['', 'a'.repeat(10), '汉汉汉a', '😀😀aa']) {
        const writer = new ZipWriter();
        writer.MAX_SAFE_ZIP_BYTES = 10;
        writer.writeFile('body.txt', content);
        assert.equal(writer.totalBytes, new TextEncoder().encode(content).byteLength);
        writer.writeFile('empty.txt', '');
    }
    for (const content of ['汉'.repeat(10), 'a'.repeat(11), '😀😀汉']) {
        const writer = new ZipWriter();
        writer.MAX_SAFE_ZIP_BYTES = 10;
        assert.throws(() => writer.writeFile('body.txt', content), { code: 'PACKAGING_SIZE_LIMIT' });
        assert.equal((writer.zip as InstanceType<typeof JSZip>).file('body.txt'), null);
    }
    const writer = new ZipWriter();
    writer.MAX_SAFE_ZIP_BYTES = 10;
    writer.writeFile('first.txt', '汉汉');
    assert.throws(() => writer.writeFile('second.txt', '汉汉'), { code: 'PACKAGING_SIZE_LIMIT' });
});
});
