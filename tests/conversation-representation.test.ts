import { buildExportCompletion } from '../src/core/engine/export/exportCompletion.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDomainSnapshotV2 } from '../src/core/parsers/legacyStorage/parseDomainSnapshotV2.js';
import { restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { formatContent } from '../src/core/engine/chatFormatter.js';

const old = () => ({ providerId: 'gemini', id: 'c_upgraded', title: 'Snapshot title', titleSource: 'rpc',
    createdAt: 5, url: 'https://gemini.google.com/app/upgraded', completeness: 'complete',
    assets: [{ id: 'image', kind: 'image', sourceUri: 'opaque:source' }],
    messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'image' }], attachmentIds: ['image'] }] });

test('retired snapshots enter only through their versioned parser and yield the shared aggregate', () => {
    const raw = old(), before = structuredClone(raw);
    assert.throws(() => restoreDomainSnapshot(raw), TypeError);
    const conversation = parseDomainSnapshotV2(raw, 100);
    assert.deepEqual(Object.keys(conversation).sort(), ['detail', 'index']);
    assert.deepEqual(Object.keys(conversation.detail).sort(), ['assets', 'completeness', 'messages']);
    assert.equal(conversation.index.id, 'upgraded');
    assert.equal(conversation.index.updatedAt, 100);
    assert.equal(conversation.index.messageCount, 1);
    assert.deepEqual(conversation.detail.messages, raw.messages);
    assert.deepEqual(raw, before);
    const restored = restoreDomainSnapshot(conversation);
    restored.detail.assets[0].sourceUri = 'changed';
    assert.equal(raw.assets[0].sourceUri, 'opaque:source');
    for (const invalid of [{ ...old(), extra: true }, { ...old(), assets: [] },
        { ...old(), messages: [{ role: 'assistant', content: 'unparsed text' }] }]) {
        assert.throws(() => parseDomainSnapshotV2(invalid), TypeError);
    }
});

test('Index owns exported metadata while the body version remains capture evidence', () => {
    const parsed = { conversation: parseDomainSnapshotV2(old(), 100), sourceVersion: 100,
        diagnostics: [], acquisitionHints: {}, resourceHints: {} };
    parsed.conversation.index.title = 'Current rename';
    parsed.conversation.index.updatedAt = 200;
    const document = composeDomainDocument(parsed.conversation).document;
    assert.equal(document.header.title, 'Current rename');
    assert.equal(document.metadata?.updatedAt, new Date(200).toISOString());
    const json = JSON.parse(formatContent(parsed, 'json').content);
    assert.equal(json.savedAt, 100);
    assert.equal(json.conversation.index.updatedAt, 200);
    assert.deepEqual(Object.keys(json.conversation.detail).sort(), ['assets', 'completeness', 'messages']);
    assert.throws(() => restoreDomainSnapshot({ ...parsed.conversation, detail: { ...parsed.conversation.detail, title: 'Second authority' } }), TypeError);
});

test('newer Index metadata cannot manufacture an exported body version', () => {
    const conversation = parseDomainSnapshotV2(old(), 200);
    const unknown = buildExportCompletion({ conversation }).exportRecord;
    assert.equal(unknown.chatTime, undefined);
    const older = buildExportCompletion({ conversation, chatTime: 100 }).exportRecord;
    assert.equal(older.chatTime, 100);
});
