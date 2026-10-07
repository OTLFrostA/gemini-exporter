import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resourceStage } from '../src/core/export/pdf/pipeline/resourceStage.js';
import type { StageContext } from '../src/core/export/pdf/pipeline/types.js';
import type { PreparedResource } from '../src/core/export/assets/preparedResources.js';
import type { DocumentAst, DisplayBlock } from '../src/core/export/document/ast.js';

function png(seed = 1): Uint8Array {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
}
const image = (id: string): DisplayBlock => ({ type: 'image', resourceId: id, alt: id });
function document(blocks: DisplayBlock[]): DocumentAst {
    return { schemaVersion: 2, header: { title: 'T', providerLabel: 'test', messageCount: 1 }, messages: [
        { type: 'message', id: 'm', anchor: 'm', label: 'assistant', variant: 'flow', blocks },
    ] };
}
const ctx = (signal = new AbortController().signal): StageContext => ({ signal, log() {}, reportProgress() {} });

test('image placements resolve bytes and content-addressed mounts; repeated bytes share a mount', async () => {
    const bytes = png();
    const resources = new Map([['a', { bytes }], ['b', { bytes }]]);
    const tree = document([image('a'), { type: 'paragraph', children: [{ type: 'image', resourceId: 'b', alt: '' }] }]);
    const original = structuredClone(tree);
    const result = await resourceStage({ document: tree, resources }, ctx());
    assert.equal(result.output.pathMap.size, 2);
    assert.equal(result.output.mounts.length, 1);
    assert.equal(result.output.mounts[0].bytes, bytes);
    assert.equal(result.output.mounts[0].mimeType, 'image/png');
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(tree, original);
});

test('resource walk includes rich captions, links, tables, disclosure and file descriptions', async () => {
    const inline = (id: string) => ({ type: 'image' as const, resourceId: id, alt: '' });
    const tree = document([
        { ...image('main'), caption: [inline('caption')] } as DisplayBlock,
        { type: 'table', columnAlignments: ['left'], caption: [inline('table-caption')], headerRows: [[{ column: 0, colSpan: 1, rowSpan: 1, align: 'left', children: [inline('header')] }]], rows: [[{ column: 0, colSpan: 1, rowSpan: 1, align: 'left', children: [{ type: 'link', href: '/', children: [inline('cell')] }] }]] },
        { type: 'disclosure', kind: 'reasoning', blocks: [image('reasoning')] },
        { type: 'file', resourceId: 'file', kind: 'file', label: 'report', description: [inline('description')] },
    ]);
    const ids = ['main', 'caption', 'table-caption', 'header', 'cell', 'reasoning', 'description'];
    const result = await resourceStage({ document: tree, resources: new Map(ids.map(id => [id, { bytes: png() }])) }, ctx());
    assert.deepEqual([...result.output.pathMap.keys()].sort(), ids.sort());
    assert.deepEqual(result.output.unresolved, []);
});

test('missing, remote-unprepared and absent resources each carry warning diagnostics', async () => {
    const result = await resourceStage({ document: document([image('missing'), image('remote'), image('ghost')]), resources: new Map([
        ['missing', { failureReason: 'HTTP 404' }], ['remote', {}],
    ]) }, ctx());
    assert.equal(result.output.mounts.length, 0);
    assert.deepEqual(result.output.unresolved.map(entry => entry.assetId), ['missing', 'remote', 'ghost']);
    for (const entry of result.output.unresolved) assert.ok(result.diagnostics.some(d => d.path === `asset:${entry.assetId}` && d.severity === 'warning'));
    assert.match(result.output.unresolved[0].reason, /HTTP 404/);
});

test('file placements never access resource bytes, even if they happen to contain an image', async () => {
    let touched = 0;
    const file: PreparedResource = { get bytes() { touched++; return png(); } };
    const result = await resourceStage({ document: document([{ type: 'file', resourceId: 'file', kind: 'file', label: 'report' }, image('image')]), resources: new Map([['file', file], ['image', { bytes: png() }]]) }, ctx());
    assert.equal(touched, 0);
    assert.deepEqual([...result.output.pathMap.keys()], ['image']);
    assert.deepEqual(result.output.unresolved, []);
    assert.deepEqual(result.diagnostics, []);
});

test('mounts retain validated bytes without a second mutable resource-store read', async () => {
    let reads = 0;
    const bytes = png();
    const resource: PreparedResource = { get bytes() { return ++reads === 1 ? bytes : undefined; } };
    const result = await resourceStage({ document: document([image('image')]), resources: new Map([['image', resource]]) }, ctx());
    assert.equal(reads, 1);
    assert.equal(result.output.mounts[0].bytes, bytes);
    assert.equal(result.output.pathMap.size, 1);
});

test('binary placement validates actual image content despite misleading file metadata', async () => {
    const result = await resourceStage({ document: document([image('misfiled')]), resources: new Map([['misfiled', { bytes: png(), name: 'report.pdf', mediaType: 'application/pdf' }]]) }, ctx());
    assert.equal(result.output.mounts[0].mimeType, 'image/png');
    assert.ok(result.output.pathMap.get('misfiled')?.endsWith('.png'));
    assert.ok(result.diagnostics.some(d => d.code === 'ASSET_MIME_MISMATCH'));
    assert.ok(result.diagnostics.some(d => d.code === 'ASSET_EXTENSION_MISMATCH'));
});

for (const [bytes, code] of [[new Uint8Array(), 'ASSET_ZERO_BYTES'], [new Uint8Array([1, 2]), 'ASSET_CORRUPT'], [new Uint8Array(50 * 1024 * 1024 + 1), 'ASSET_TOO_LARGE']] as const) {
    test(`invalid bytes stay unresolved: ${code}`, async () => {
        const result = await resourceStage({ document: document([image('image')]), resources: new Map([['image', { bytes, mediaType: 'image/png' }]]) }, ctx());
        assert.equal(result.output.mounts.length, 0);
        assert.equal(result.output.pathMap.size, 0);
        assert.equal(result.output.unresolved.length, 1);
        assert.ok(result.diagnostics.some(d => d.code === code));
    });
}

test('aborted resources stage stops before accessing resources', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(resourceStage({ document: document([image('a')]), resources: new Map() }, ctx(controller.signal)), { name: 'AbortError' });
});
