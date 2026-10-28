import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { docxImageInfo } from '../src/l4/shared/docxImageType.js';
import { v2Conversation, v2Document } from './helpers/l4V2Fixtures.js';
import { renderDocumentDocx } from '../src/l4/format/docx/renderDocx.js';
import { createExportPathPlanner, buildExportFiles } from '../src/l4/packaging/index.js';
import type { PreparedResources } from '../src/shared/resources/resourceResult.js';
const JSZip = require('../lib/jszip.min.js');

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2GAAAAAASUVORK5CYII=', 'base64'));

test('DOCX renders actual OOXML, editable text, safe links, a merged table and embedded image', async () => {
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
    assert.ok(Object.keys(zip.files).some(name => /^word\/media\/.+\.png$/.test(name)));
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
    const empty = v2Document([{ type: 'image', resourceId: 'missing', alt: 'Lost drawing' }], { title: 'Image failure' });
    const zip = await JSZip.loadAsync(await renderDocumentDocx(empty, {}, new Map(), { locale: 'zh' }));
    const body = await zip.file('word/document.xml').async('string');
    assert.ok(body.includes('Lost drawing'));
});


test('DOCX preserves portrait, landscape and progressive JPEG proportions in the actual OOXML', async () => {
    for (const [name, width, height] of [['portrait', 300, 900], ['landscape', 900, 300], ['progressive', 300, 900]] as const) {
        const bytes = readFileSync(`tests/fixtures/docx/${name}.jpg`);
        assert.deepEqual(docxImageInfo('image/jpeg', bytes), { type: 'jpg', width, height });
        const prepared: PreparedResources = new Map([
            ['image', { ok: true, resourceId: 'image', value: { bytes, mediaType: 'image/jpeg' } }],
        ]);
        const document = v2Document([{ type: 'image', resourceId: 'image', alt: name }]);
        const zip = await JSZip.loadAsync(await renderDocumentDocx(document, { image: 'assets/photo.jpg' }, prepared));
        const xml = await zip.file('word/document.xml').async('string');
        const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml);
        assert.ok(extent, 'Word drawing has physical dimensions');
        const displayedWidth = Number(extent[1]) / 9525;
        const displayedHeight = Number(extent[2]) / 9525;
        assert.ok(displayedWidth <= 520 && displayedHeight <= 610);
        assert.ok(Math.abs(displayedWidth / displayedHeight / (width / height) - 1) < 0.005,
            `${name} must retain its aspect ratio after integer pixel scaling`);
        const embedded = Object.keys(zip.files).find(name => /^word\/media\/.+\.jpg$/.test(name));
        assert.ok(embedded);
        assert.deepEqual(await zip.file(embedded).async('uint8array'), new Uint8Array(bytes), 'source JPEG is not re-encoded');
    }
});

test('DOCX unreadable image dimensions preserve companion bytes and readable fallback text', async () => {
    const jpeg = readFileSync('tests/fixtures/docx/portrait.jpg');
    const brokenImages = [
        new Uint8Array([255, 216, 255]),
        new Uint8Array([255, 216, 255, 224, 255, 255]), // metadata extends past EOF
        new Uint8Array([255, 216, 255, 192, 0, 2]), // frame too short
        jpeg.subarray(0, 40),
        new Uint8Array([255, 216, 255, 218, 0, 2]), // scan without a frame
    ];
    for (const bytes of brokenImages) {
        assert.equal(docxImageInfo('image/jpeg', bytes), undefined);
        const prepared: PreparedResources = new Map([
            ['image', { ok: true, resourceId: 'image', value: { bytes, mediaType: 'image/jpeg' } }],
        ]);
        const plan = createExportPathPlanner('docx')(v2Conversation('Broken', [
            { id: 'image', kind: 'image', name: 'broken.jpg', mediaType: 'image/jpeg' },
        ]), prepared, new Set());
        const output = await renderDocumentDocx(v2Document([{ type: 'image', resourceId: 'image', alt: 'Original image' }]), plan.resources, prepared);
        const zip = await JSZip.loadAsync(output);
        const xml = await zip.file('word/document.xml').async('string');
        assert.ok(xml.includes('Original image') && xml.includes(plan.resources.image));
        assert.ok(!xml.includes('<w:drawing>'));
        assert.equal(plan.externalResourceIds.has('image'), true);
        const files = buildExportFiles('docx', plan, output, prepared);
        assert.deepEqual(files.find(file => file.fileName === plan.resources.image)?.content, bytes);
    }
});

test('DOCX image headers use byte-view offsets and reject zero dimensions', () => {
    const padded = new Uint8Array(png.length + 9);
    padded.set(png, 9);
    assert.deepEqual(docxImageInfo('image/png', padded.subarray(9)), { type: 'png', width: 1, height: 1 });
    const zeroPng = new Uint8Array(png);
    zeroPng.fill(0, 16, 20);
    assert.equal(docxImageInfo('image/png', zeroPng), undefined);
    const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 44, 1, 132, 3]);
    assert.deepEqual(docxImageInfo('image/gif', gif), { type: 'gif', width: 300, height: 900 });
    gif.fill(0, 6, 8);
    assert.equal(docxImageInfo('image/gif', gif), undefined);
});
