import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v2Conversation, v2Document } from './helpers/l4V2Fixtures.js';
import { renderDocumentDocx } from '../src/l4/format/docx/renderDocx.js';
import { createExportPathPlanner, buildExportFiles } from '../src/l4/packaging/index.js';
import { __setZipConstructor } from '../src/l4/packaging/writers/zipWriter.js';
import type { PreparedResources } from '../src/shared/resources/resourceResult.js';
const JSZip = require('../lib/jszip.min.js');

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2GAAAAAASUVORK5CYII=', 'base64'));

test('DOCX renders actual OOXML, editable text, safe links, a merged table and embedded image', async () => {
    __setZipConstructor(JSZip);
    const document = v2Document([
        { type: 'paragraph', children: [
            { type: 'strong', children: [{ type: 'text', text: 'Hello & <World>' }] },
            { type: 'text', text: ' ' },
            { type: 'link', href: 'https://example.com/?a=1&b=2', children: [{ type: 'text', text: 'website' }] },
            { type: 'text', text: ' ' },
            { type: 'link', href: 'javascript:alert(1)', children: [{ type: 'text', text: 'unsafe link' }] },
        ] },
        { type: 'heading', level: 2, children: [{ type: 'text', text: 'Heading' }] },
        { type: 'code', code: 'const x = "<";', language: 'typescript' },
        { type: 'list', ordered: true, items: [
            { blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'First item' }] }] },
            { blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Second item' }] }] },
        ] },
        { type: 'table', columnAlignments: ['left', 'right'], headerRows: [
            [{ column: 0, colSpan: 2, rowSpan: 1, children: [{ type: 'text', text: 'Merged heading' }] }],
        ], rows: [[
            { column: 0, colSpan: 1, rowSpan: 1, children: [{ type: 'text', text: 'Left' }] },
            { column: 1, colSpan: 1, rowSpan: 1, children: [{ type: 'text', text: 'Right' }] },
        ]] },
        { type: 'image', resourceId: 'image', alt: 'Diagram' },
        { type: 'math', source: '\\frac{a}{b}' },
    ], { title: 'Docx & example' });
    const before = structuredClone(document);
    const prepared: PreparedResources = new Map([
        ['image', { ok: true, resourceId: 'image', value: { bytes: png, mediaType: 'image/png' } }],
    ]);
    const bytes = await renderDocumentDocx(document, { image: 'assets/diagram.png' }, prepared);
    assert.deepEqual(document, before);
    assert.ok(bytes.length > 1000);
    const zip = await JSZip.loadAsync(bytes);
    assert.ok(zip.file('[Content_Types].xml'));
    assert.ok(zip.file('word/styles.xml'));
    assert.ok(zip.file('word/media/image-1.png'));
    const doc = await zip.file('word/document.xml').async('string');
    const rels = await zip.file('word/_rels/document.xml.rels').async('string');
    assert.ok(doc.includes('Docx &amp; example'));
    assert.ok(doc.includes('Hello &amp; &lt;World&gt;'));
    assert.ok(doc.includes('First item') && doc.includes('Second item'));
    assert.ok(doc.includes('Merged heading') && doc.includes('<w:gridSpan w:val="2"/>'));
    assert.ok(doc.includes('Diagram') && doc.includes('r:embed="rId'));
    assert.ok(doc.includes('frac{a}{b}'), 'original LaTeX is preserved for editing');
    assert.ok(rels.includes('https://example.com/?a=1&amp;b=2'));
    assert.ok(!rels.includes('javascript:'));
    assert.ok(doc.includes('unsafe link'), 'untrusted link label is not dropped');
});

test('DOCX planner embeds supported images but preserves files and unsupported image formats alongside Word', () => {
    const c = v2Conversation('Document', [
        { id: 'image', kind: 'image', name: 'photo.png', mediaType: 'image/png' },
        { id: 'unsupported', kind: 'image', name: 'picture.webp', mediaType: 'image/webp' },
        { id: 'file', kind: 'file', name: 'notes.txt', mediaType: 'text/plain' },
    ]);
    const prepared: PreparedResources = new Map([
        ['image', { ok: true, resourceId: 'image', value: { bytes: png, mediaType: 'image/png' } }],
        ['unsupported', { ok: true, resourceId: 'unsupported', value: { bytes: new Uint8Array([1, 2]), mediaType: 'image/webp' } }],
        ['file', { ok: true, resourceId: 'file', value: { bytes: new Uint8Array([3, 4]), mediaType: 'text/plain' } }],
    ]);
    const plan = createExportPathPlanner('docx')(c, prepared, new Set(['file']));
    assert.match(plan.fileName, /\.docx$/);
    assert.equal(plan.externalResourceIds.has('image'), false);
    assert.equal(plan.externalResourceIds.has('unsupported'), true);
    assert.equal(plan.externalResourceIds.has('file'), true);
    const files = buildExportFiles('docx', plan, new Uint8Array([1]), prepared);
    assert.equal(files.length, 3);
    assert.equal(files[0].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});

test('DOCX handles empty conversation and unavailable images without losing the text', async () => {
    __setZipConstructor(JSZip);
    const empty = v2Document([{ type: 'image', resourceId: 'missing', alt: 'Lost drawing' }], { title: 'Image failure' });
    const zip = await JSZip.loadAsync(await renderDocumentDocx(empty, {}, new Map(), { locale: 'zh' }));
    const body = await zip.file('word/document.xml').async('string');
    assert.ok(body.includes('Lost drawing'));
});
