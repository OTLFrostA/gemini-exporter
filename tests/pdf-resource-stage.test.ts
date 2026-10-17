import { missingResource, type ResourceResult } from '../src/core/resources/resourceResult.js';
import { preparedResources } from './helpers/resources.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resourceStage } from '../src/core/export/pdf/pipeline/resourceStage.js';
import type { StageContext } from '../src/core/export/pdf/pipeline/types.js';
import type { ResourceBytes } from '../src/core/resources/resourceResult.js';
import type { DocumentAst, DisplayBlock } from '../src/core/document/ast/ast.js';

function png(seed = 1): Uint8Array {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
}
const image = (id: string): DisplayBlock => ({ type: 'image', resourceId: id, alt: id });
function document(blocks: DisplayBlock[]): DocumentAst {
    return { schemaVersion: 2, metadata: { id: 'fixture', provider: 'test' }, header: { title: 'T', providerLabel: 'test', messageCount: 1 }, messages: [
        { type: 'message', id: 'm', label: 'assistant', variant: 'flow', blocks },
    ] };
}
const ctx = (signal = new AbortController().signal): StageContext => ({ signal, log() {}, reportProgress() {} });

test('image placements resolve bytes and content-addressed mounts; repeated bytes share a mount', async () => {
    const bytes = png();
    const resources = preparedResources([['a', { bytes }], ['b', { bytes }]]);
    const tree = document([image('a'), { type: 'paragraph', children: [{ type: 'image', resourceId: 'b', alt: '' }] }]);
    const original = structuredClone(tree);
    const result = await resourceStage({ document: tree, resources }, ctx());
    assert.equal(result.output.pathMap.size, 2);
    assert.equal(result.output.mounts.length, 1);
    assert.equal(result.output.pathMap.get('a'), result.output.pathMap.get('b'),
        'equal binary content must share a mount path across distinct resource IDs');
    assert.equal(result.output.mounts[0].bytes, bytes);
    assert.equal(result.output.mounts[0].mimeType, 'image/png');
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(tree, original);
});

test('PDF mounts all AST images, including every rich metadata field', async () => {
    const inline = (id: string) => ({ type: 'image' as const, resourceId: id, alt: '' });
    const tree = document([
        { ...image('main'), caption: [inline('caption')] } as DisplayBlock,
        { type: 'table', columnAlignments: ['left'], caption: [inline('table-caption')], headerRows: [[{ column: 0, colSpan: 1, rowSpan: 1, align: 'left', children: [inline('header')] }]], rows: [[{ column: 0, colSpan: 1, rowSpan: 1, align: 'left', children: [{ type: 'link', href: '/', children: [inline('cell')] }] }]] },
        { type: 'disclosure', kind: 'reasoning', blocks: [image('reasoning')] },
        { type: 'file', resourceId: 'file', kind: 'file', label: 'report', description: [inline('description')] },
    ]);
    tree.messages[0].blocks.push({ type: 'paragraph', children: [inline('body-ending')] });
    tree.messages[0].blocks.push({ type: 'placeholder', kind: 'image', resourceId: 'placeholder', text: 'missing', details: [inline('details')] });
    const original = JSON.stringify(tree);
    const ids = ['main', 'header', 'cell', 'reasoning', 'caption', 'table-caption', 'description', 'body-ending', 'details'];
    const skipped = ['file', 'placeholder'];
    const result = await resourceStage({ document: tree, resources: preparedResources([...ids.map(id => [id, { bytes: png() }] as const), ...skipped.map(id => [id, { get bytes(): Uint8Array { return assert.fail(`Must not read metadata-only resource ${id}`); } }] as const)]) }, ctx());
    assert.deepEqual([...result.output.pathMap.keys()].sort(), ids.sort());
    assert.deepEqual(result.output.unresolved, []);
    assert.equal(JSON.stringify(tree), original);
});

test('missing, remote-unprepared and absent resources each carry warning diagnostics', async () => {
    const result = await resourceStage({ document: document([image('missing'), image('remote'), image('ghost')]), resources: new Map<string, ResourceResult<ResourceBytes>>([
        ['missing', missingResource('missing', 'HTTP 404', 'HTTP_NOT_FOUND')], ['remote', missingResource('remote', 'not acquired')],
    ]) }, ctx());
    assert.equal(result.output.mounts.length, 0);
    assert.deepEqual(result.output.unresolved.map(entry => entry.assetId), ['missing', 'remote', 'ghost']);
    for (const entry of result.output.unresolved) assert.ok(result.diagnostics.some(d => d.path === `asset:${entry.assetId}` && d.severity === 'warning'));
    assert.match(result.output.unresolved[0].reason, /HTTP 404/);
    assert.deepEqual(result.output.resourceResults[0], missingResource('missing', 'HTTP 404', 'HTTP_NOT_FOUND'));
    assert.ok(result.diagnostics.some(d => d.code === 'HTTP_NOT_FOUND'));
});

test('file placements never access resource bytes, even if they happen to contain an image', async () => {
    let touched = 0;
    const file: ResourceBytes = { get bytes() { touched++; return png(); } };
    const result = await resourceStage({ document: document([{ type: 'file', resourceId: 'file', kind: 'file', label: 'report' }, image('image')]), resources: preparedResources([['file', file], ['image', { bytes: png() }]]) }, ctx());
    assert.equal(touched, 0);
    assert.deepEqual([...result.output.pathMap.keys()], ['image']);
    assert.deepEqual(result.output.unresolved, []);
    assert.deepEqual(result.diagnostics, []);
});

test('mounts retain validated bytes without a second mutable resource-store read', async () => {
    let reads = 0;
    const bytes = png();
    const resource: ResourceBytes = { get bytes() { return ++reads === 1 ? bytes : new Uint8Array(); } };
    const result = await resourceStage({ document: document([image('image')]), resources: preparedResources([['image', resource]]) }, ctx());
    assert.equal(reads, 1);
    assert.equal(result.output.mounts[0].bytes, bytes);
    assert.equal(result.output.pathMap.size, 1);
});

test('binary placement validates actual image content despite misleading file metadata', async () => {
    const result = await resourceStage({ document: document([image('misfiled')]), resources: preparedResources([['misfiled', { bytes: png(), name: 'report.pdf', mediaType: 'application/pdf' }]]) }, ctx());
    assert.equal(result.output.mounts[0].mimeType, 'image/png');
    assert.ok(result.output.pathMap.get('misfiled')?.endsWith('.png'));
    assert.ok(result.diagnostics.some(d => d.code === 'ASSET_MIME_MISMATCH'));
    assert.ok(result.diagnostics.some(d => d.code === 'ASSET_EXTENSION_MISMATCH'));
});

for (const [bytes, code] of [[new Uint8Array(), 'ASSET_ZERO_BYTES'], [new Uint8Array([1, 2]), 'ASSET_CORRUPT'], [new Uint8Array(50 * 1024 * 1024 + 1), 'ASSET_TOO_LARGE']] as const) {
    test(`invalid bytes stay unresolved: ${code}`, async () => {
        const result = await resourceStage({ document: document([image('image')]), resources: preparedResources([['image', { bytes, mediaType: 'image/png' }]]) }, ctx());
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
