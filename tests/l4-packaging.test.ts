import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planExportPaths, buildExportFiles, packageExportFiles } from '../src/core/export/packaging/index.js';
import { restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import { fixtureAccountFor, fixtureKey } from './helpers/domainFixture.js';
import type { PreparedResources } from '../src/core/resources/resourceResult.js';
import { __setModuleOverride } from '../src/core/utils/moduleOverrides.js';
import { ZipWriter } from '../src/core/engine/writers/zipWriter.js';
import { assertExportPath } from '../src/core/export/packaging/exportPath.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { serializeDomainJson } from '../src/core/renderers/json/serializeDomainJson.js';
const JSZip = require('../lib/jszip.min.js');
const prepared: PreparedResources = new Map([
    ['a', { ok: true, resourceId: 'a', value: { bytes: new Uint8Array([1, 2]), mediaType: 'image/png' } }],
    ['b', { ok: true, resourceId: 'b', value: { bytes: new Uint8Array([3]), mediaType: 'image/png' } }],
    ['failed', { ok: false, resourceId: 'failed', reason: 'missing', code: 'MISSING' }],
]);
function conversation(title = 'Chat') {
    const key = fixtureKey('same123456', 'gemini');
    return restoreDomainSnapshot({ index: { key, title, titleSource: 'derived' }, detail: {
        key, quality: { status: 'complete' }, messages: [], assets: [
            { id: 'a', kind: 'image', name: 'Photo.png' }, { id: 'b', kind: 'image', name: 'photo.png' },
            { id: 'failed', kind: 'file', name: 'missing.bin' },
        ],
    } });
}
test('Packaging reserves batch paths case-insensitively and keeps resource IDs local', () => {
    const first = conversation();
    const second = conversation('chat');
    second.index.key.accountId = '10000000-0000-4000-8000-000000000002';
    second.detail.key = { ...second.index.key };
    const plans = planExportPaths([{ conversation: first, prepared }, { conversation: second, prepared }], 'markdown');
    assert.deepEqual(plans.map(p => p.fileName), ['Chat_123456.md', 'chat_123456_2.md']);
    assert.deepEqual(Object.values(plans[0].resources), ['assets/123456_Photo.png', 'assets/123456_photo_2.png']);
    assert.deepEqual(Object.values(plans[1].resources), ['assets/123456_Photo_3.png', 'assets/123456_photo_4.png']);
    assert.equal(plans[0].resources.failed, undefined);
});
test('Packaging reserves long sanitized collision suffixes without writer truncation', () => {
    const c = conversation('z'.repeat(200));
    c.detail.assets[0].name = 'x'.repeat(68) + '.longextension';
    c.detail.assets[1].name = c.detail.assets[0].name;
    const plans = planExportPaths(Array.from({ length: 12 }, () => ({ conversation: c, prepared })), 'html');
    const paths = plans.flatMap(p => [p.fileName, ...Object.values(p.resources)]);
    assert.equal(new Set(paths.map(p => p.toLowerCase())).size, paths.length);
    paths.forEach(assertExportPath);
});
test('Packaging sanitizes traversal, encoded separators and reserved filenames before binding', () => {
    const c = conversation();
    c.detail.assets[0].name = '../../%2e%2e%2fCON.png';
    const [plan] = planExportPaths([{ conversation: c, prepared }], 'json');
    Object.values(plan.resources).forEach(assertExportPath);
    assert.ok(!plan.resources.a.includes('%'));
});
for (const format of ['markdown', 'html', 'json'] as const) {
    test(`${format}: each binding becomes an external file, with main first and unchanged bytes`, async () => {
        const [plan] = planExportPaths([{ conversation: conversation(), prepared }], format);
        const files = buildExportFiles(format, plan, 'body', prepared);
        assert.deepEqual(files.map(f => f.fileName), [plan.fileName, ...Object.values(plan.resources)]);
        assert.deepEqual(Object.keys(files[0]).sort(), ['content', 'fileName', 'mimeType']);
        const resource = prepared.get('a')!;
        assert.ok(resource.ok);
        assert.equal(files[1].content, resource.value.bytes);
        __setModuleOverride('JSZip', JSZip);
        const [artifact] = await packageExportFiles([files], 'browserDownload', false);
        const zip = await JSZip.loadAsync(await (artifact.content as Blob).arrayBuffer());
        for (const file of files) assert.ok(zip.file(file.fileName), file.fileName);
        assert.equal(zip.file(plan.fileName) !== null, true);
        assert.ok(!Object.keys(zip.files).some(path => path.startsWith('gemini_export/')));
    });
}
test('Packaging rejects dangling external bindings before Delivery; PDF emits only main', () => {
    const [plan] = planExportPaths([{ conversation: conversation(), prepared }], 'pdf');
    assert.throws(() => buildExportFiles('markdown', plan, 'body', new Map()), /Bound resource unavailable/);
    assert.equal(buildExportFiles('pdf', plan, new Uint8Array([1]), prepared).length, 1);
});
test('ZIP decision uses actual flattened files and delivery, never format or batch count', async () => {
    __setModuleOverride('JSZip', JSZip);
    const a = { fileName: 'a.pdf', mimeType: 'application/pdf', content: new Uint8Array([1]) };
    const b = { ...a, fileName: 'b.pdf' };
    assert.deepEqual(await packageExportFiles([[a]], 'browserDownload', false), [a]);
    assert.deepEqual(await packageExportFiles([[a], [], [b]], 'folderWriter', false), [a, b]);
    assert.equal((await packageExportFiles([[a]], 'folderWriter', true))[0].fileName, 'a.zip');
    assert.match((await packageExportFiles([[a], [b]], 'browserDownload', false))[0].fileName, /^conversations_\d+\.zip$/);
    assert.deepEqual(await packageExportFiles([[]], 'browserDownload', true), []);
    await assert.rejects(packageExportFiles([[a, a]], 'folderWriter', false), /Duplicate/);
});
test('ZIP writer rejects unsafe paths rather than rewriting renderer bindings', () => {
    __setModuleOverride('JSZip', JSZip);
    const writer = new ZipWriter();
    for (const path of ['', '/root', '../x', 'assets/%2e%2e/x', 'a\\b', 'CON', 'a//b', 'a/'.repeat(2), 'z'.repeat(90) + '.md']) {
        assert.throws(() => writer.writeFile(path, 'x'), /Unsafe|Noncanonical|Empty/);
    }
});
test('ZIP generation failures reject without producing a delivery artifact', async () => {
    __setModuleOverride('JSZip', class { file() {} async generateAsync() { throw new Error('zip failed'); } });
    await assert.rejects(packageExportFiles([[{ fileName: 'a.md', mimeType: 'text/markdown', content: 'body' }]], 'browserDownload', true), /zip failed/);
});

test('Format references resolve to the same planned ZIP entries for Markdown, HTML and JSON', async () => {
    __setModuleOverride('JSZip', JSZip);
    const c = conversation();
    c.detail.messages = [{ role: 'assistant', content: [{ type: 'image', assetId: 'a' }, { type: 'image', assetId: 'b' }] }];
    const account = fixtureAccountFor(c);
    const document = composeDomainDocument(c, account);
    for (const format of ['markdown', 'html', 'json'] as const) {
        const [plan] = planExportPaths([{ conversation: c, prepared }], format);
        const content = format === 'markdown' ? renderDocumentMarkdown(document, plan.resources)
            : format === 'html' ? renderDocumentHtml(document, plan.resources).html
            : serializeDomainJson(c, account, plan.resources);
        const files = buildExportFiles(format, plan, content, prepared);
        const [packed] = await packageExportFiles([files], 'browserDownload', false);
        const zip = await JSZip.loadAsync(await (packed.content as Blob).arrayBuffer());
        for (const path of Object.values(plan.resources)) {
            assert.ok(content.includes(path), `${format} reference: ${path}`);
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
    const [plan] = planExportPaths([{ conversation: c, prepared: resources }], 'markdown');
    assert.deepEqual(Object.values(plan.resources), [
        'assets/123456_Generated Image.png', 'assets/123456_Generated Image_2.png',
        'files/123456_Notes.md', 'files/123456_unnamed.id.bin',
    ]);
    const files = buildExportFiles('markdown', plan, 'body', resources);
    assert.equal(files[1].mimeType, 'image/png');
    assert.equal(files[4].mimeType, 'application/octet-stream');
});
