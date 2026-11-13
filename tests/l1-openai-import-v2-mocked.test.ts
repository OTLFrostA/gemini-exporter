import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ports, CHATGPT_ACCOUNT } from './helpers/l1V2UnitMocks.js';
import { parseOpenAIExportArchive } from '../src/l1/imports/openai/parseArchive.js';
import { readOpenAIArchive } from '../src/l1/imports/openai/readArchive.js';
import { OperationError } from '../src/shared/errors/operationError.js';

const JSZip: { new(): { file(path: string, bytes: string | Uint8Array): void;
    generateAsync(options: { type: 'uint8array' }): Promise<Uint8Array> } } = require('../lib/jszip.min.js');
beforeEach(() => { ports.reset(); Reflect.set(globalThis, 'JSZip', JSZip); });

function conversation(id = 'conversation-1') {
    return { id, title: '离线导入 / Offline', create_time: 1700000000, update_time: 1700000002,
        current_node: 'a', mapping: {
            root: { id: 'root', parent: null, children: ['u'] },
            u: { id: 'u', parent: 'root', children: ['a'], message: { id: 'u', author: { role: 'user' }, recipient: 'all',
                create_time: 1700000000, content: { content_type: 'multimodal_text', parts: ['Question', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file-image' }] },
                metadata: { attachments: [{ id: 'file-note', name: 'note.md', mime_type: 'text/markdown' }] } } },
            a: { id: 'a', parent: 'u', children: [], message: { id: 'a', author: { role: 'assistant' }, recipient: 'all',
                create_time: 1700000002, status: 'finished_successfully', end_turn: true,
                content: { content_type: 'text', parts: ['Answer\n\n```python\nprint(1)\n```'] }, metadata: { model_slug: 'gpt-test' } } },
        } };
}

async function zip(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
    const archive = new JSZip();
    for (const [name, bytes] of Object.entries(files)) archive.file(name, bytes);
    return archive.generateAsync({ type: 'uint8array' });
}

async function fixture(rows: unknown = [conversation()], additional: Record<string, string | Uint8Array> = {}) {
    return zip({ 'conversations.json': JSON.stringify(rows), 'user.json': JSON.stringify({ id: 'user-1' }),
        'library_files.json': JSON.stringify([{ file_id: 'file-image', file_name: 'photo.png', mime_type: 'image/png' }]),
        'file-image.dat': Uint8Array.of(137, 80, 78, 71), 'file-note.dat': '# note', ...additional });
}

test('OpenAI ZIP parser preserves current branch, source metadata and lazy original attachment bytes without L2 writes', async () => {
    let decodedCallback = 0;
    const archive = await parseOpenAIExportArchive(await fixture(), CHATGPT_ACCOUNT.providerAccountId, () => { decodedCallback++; });
    assert.equal(decodedCallback, 1);
    assert.equal(archive.conversationCount, 1);
    assert.equal(archive.skippedEmpty, 0);
    assert.equal(archive.missingAssets, 0);
    const item = archive.conversations[0];
    assert.equal(item.conversationId, 'conversation-1');
    assert.equal(item.parsed.conversation.index.title, '离线导入 / Offline');
    assert.equal(item.parsed.conversation.index.updatedAt, 1700000002000);
    assert.deepEqual(item.parsed.conversation.detail.messages.map(m => [m.role, m.timestamp]), [['user', 1700000000000], ['assistant', 1700000002000]]);
    assert.equal(item.parsed.conversation.detail.messages[1].model, 'gpt-test');
    assert.equal(item.parsed.conversation.detail.assets[0].name, 'photo.png');
    assert.deepEqual(await item.boundEntries.get(item.parsed.conversation.detail.assets[0].id)?.bytes(), Uint8Array.of(137, 80, 78, 71));
    assert.equal(new TextDecoder().decode(await item.boundEntries.get(item.parsed.conversation.detail.assets[1].id)?.bytes()), '# note');
    assert.deepEqual(ports.details, [], 'pure L1 OpenAI parser never calls L2 ingestDetail');
    assert.deepEqual(ports.indexes, [], 'pure L1 OpenAI parser never fabricates online list coverage');
});

test('empty official export and missing conversation body are distinct; library never fabricates chats', async () => {
    const empty = await parseOpenAIExportArchive(await fixture([]), CHATGPT_ACCOUNT.providerAccountId);
    assert.equal(empty.conversationCount, 0);
    assert.equal(empty.conversations.length, 0);
    await assert.rejects(
        parseOpenAIExportArchive(await zip({ 'library_files.json': '[]' }), CHATGPT_ACCOUNT.providerAccountId),
        (err: unknown) => err instanceof OperationError && err.code === 'ARCHIVE_CONVERSATIONS_MISSING',
    );
});

test('manifest shards are read in order and malformed later shards fail cleanly', async () => {
    const manifest = JSON.stringify({ version: 1, logical_files: { 'conversations.json': { files: ['part-0.json', 'part-1.json'], sharded: true } } });
    const data = { 'export_manifest.json': manifest, 'part-0.json': JSON.stringify([conversation('first')]), 'part-1.json': JSON.stringify([conversation('second')]) };
    const result = await parseOpenAIExportArchive(await zip(data), CHATGPT_ACCOUNT.providerAccountId);
    assert.deepEqual(result.conversations.map(d => d.conversationId), ['first', 'second']);
    await assert.rejects(parseOpenAIExportArchive(await zip({ ...data, 'part-1.json': '[{"id":"broken"}]' }), CHATGPT_ACCOUNT.providerAccountId));
    await assert.rejects(
        readOpenAIArchive(await zip({ 'export_manifest.json': manifest })),
        (err: unknown) => err instanceof OperationError && err.code === 'ARCHIVE_MANIFEST_MISSING_FILES',
    );
});

test('user mismatch rejects with structured ARCHIVE_USER_MISMATCH; missing local assets count without losing body', async () => {
    await assert.rejects(
        parseOpenAIExportArchive(await fixture(undefined, { 'user.json': '{"id":"foreign"}' }), CHATGPT_ACCOUNT.providerAccountId),
        (err: unknown) => err instanceof OperationError && err.code === 'ARCHIVE_USER_MISMATCH',
    );
    const result = await parseOpenAIExportArchive(await zip({ 'conversations.json': JSON.stringify([conversation()]) }), CHATGPT_ACCOUNT.providerAccountId);
    assert.equal(result.missingAssets, 2);
    assert.equal(result.conversations[0].parsed.conversation.detail.messages.length, 2);
});

test('OpenAI archive rejects corrupt ZIP, traversal and oversized JSON before reading content', async () => {
    await assert.rejects(readOpenAIArchive(Uint8Array.of(1, 2, 3)));
    await assert.rejects(readOpenAIArchive(await zip({ '../conversations.json': '[]' })), /Invalid OpenAI ZIP path/);
    Reflect.set(globalThis, 'JSZip', { loadAsync: async () => ({ files: { 'conversations.json': {
        _data: { uncompressedSize: 251 * 1024 * 1024 }, async: async () => { throw new Error('must not inflate'); },
    } } }) });
    const archive = await readOpenAIArchive(Uint8Array.of(1));
    await assert.rejects(archive.json('conversations.json'), /exceeds the supported/);
});

test('Markdown-local images and sandbox downloads bind to original archive files with closed asset references', async () => {
    const row = conversation();
    row.mapping.a.message.content.parts = ['![diagram](file-diagram.png)\n\n[Report](sandbox:/mnt/data/report.pdf)\n\n```text\n[sample](sandbox:/mnt/data/not-a-file)\n```'];
    const result = await parseOpenAIExportArchive(await fixture([row], {
        'file-diagram.png': Uint8Array.of(1, 2, 3),
        'file-report.dat': '%PDF-report',
        'library_files.json': JSON.stringify([
            { file_id: 'file-image', file_name: 'photo.png', mime_type: 'image/png' },
            { file_id: 'file-report', file_name: 'report.pdf', mime_type: 'application/pdf', origination_thread_id: row.id },
        ]),
    }), CHATGPT_ACCOUNT.providerAccountId);
    assert.equal(result.missingAssets, 0);
    const detail = result.conversations[0].parsed.conversation.detail;
    assert.equal(detail.assets.length, 4);
    assert.equal(detail.messages[1].content.at(-1)?.type, 'file');
    assert.ok(detail.assets.some(asset => asset.name === 'report.pdf'));
    assert.equal(detail.assets.some(asset => asset.sourceUri?.includes('not-a-file')), false, 'fenced code remains literal');
});

test('different archive image paths never collapse after resource-ID sanitization', async () => {
    const row = conversation();
    row.mapping.a.message.content.parts = ['![one](a+b.png) ![two](a_b.png)'];
    const result = await parseOpenAIExportArchive(await fixture([row], { 'a+b.png': 'one', 'a_b.png': 'two' }), CHATGPT_ACCOUNT.providerAccountId);
    const assets = result.conversations[0].parsed.conversation.detail.assets;
    assert.equal(new Set(assets.map(asset => asset.id)).size, assets.length);
    assert.ok(assets.some(asset => asset.sourceUri === 'a+b.png'));
    assert.ok(assets.some(asset => asset.sourceUri === 'a_b.png'));
});

test('URL decoding applies once to source references, while ambiguous filenames stay unavailable', async () => {
    const row = conversation();
    row.mapping.a.message.content.parts = ['![one](space%20name.png) ![two](literal%2520name.png) ![ambiguous](file-ambiguous)'];
    const result = await parseOpenAIExportArchive(await fixture([row], {
        'space name.png': 'one', 'literal%20name.png': 'two',
        'one/file-ambiguous-image.png': 'a', 'two/file-ambiguous-image.png': 'b',
    }), CHATGPT_ACCOUNT.providerAccountId);
    assert.equal(result.missingAssets, 1);
    const assets = result.conversations[0].parsed.conversation.detail.assets;
    assert.ok(assets.some(asset => asset.name === 'space name.png'));
    assert.ok(assets.some(asset => asset.name === 'literal%20name.png'));
});
