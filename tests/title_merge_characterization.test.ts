import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConversation } from '../src/core/utils/mergeUtils.js';
import { parseGeminiIndexObservation } from '../src/core/parsers/gemini/parseIndexObservation.js';
import { indexFromDetail } from '../src/core/storage/conversationIndexFromParsed.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { parseLegacyConversationIndex } from '../src/core/parsers/legacyStorage/parseIndex.js';
import { indexFixture } from './helpers/indexFixture.js';

test('index title authority survives weaker observations and adopts same-tier renames', () => {
    for (const [strong, weak] of [['rpc', 'dom'], ['api-detail', 'takeout'], ['dom', 'sniff'], ['takeout', 'legacy']]) {
        const a = indexFixture({ id: 'title-order', title: 'Authority', titleSource: strong });
        const b = indexFixture({ id: a.id, title: 'Fallback', titleSource: weak });
        for (const [old, incoming] of [[a, b], [b, a]]) assert.equal(mergeConversation(old, incoming).merged.title, 'Authority');
        assert.equal(mergeConversation(a, { ...a, title: 'Renamed authority' }).merged.title, 'Renamed authority');
    }
});
test('placeholder and malformed provenance are handled before index merging', () => {
    const old = indexFixture({ id: 'empty-title', title: 'Stored RPC title', titleSource: 'rpc' });
    for (const title of ['', '   ', '\t\n', 'Google Gemini']) {
        const incoming = parseGeminiIndexObservation({ id: old.id, title, titleSource: 'rpc' }, 'detail');
        assert.equal(incoming.title, '');
        assert.equal(incoming.titleSource, 'default');
        assert.equal(mergeConversation(old, incoming).merged.title, old.title);
    }
    const dirty = parseLegacyConversationIndex({ id: old.id, title: 'Candidate', titleSource: 'export', titles: { made_up: 'Injected title' } });
    assert.equal(dirty.titleSource, 'legacy');
    assert.equal(Object.hasOwn(dirty, 'titles'), false);
});
test('index merging preserves independent times, sampled counts, and import history without extension fields', () => {
    const old = indexFixture({ id: 'merge-fields', title: 'RPC title', titleSource: 'rpc', updatedAt: 5000, createdAt: 2000, messageCount: 8 });
    const incoming = indexFromDetail(historicalFixture({ id: old.id, title: 'Offline title', titleSource: 'takeout',
        messages: [{ role: 'user', content: 'Question' }, { role: 'model', content: 'Answer' }] }).conversation, 'takeout');
    const result = mergeConversation(old, incoming);
    assert.equal(result.merged.updatedAt, 5000);
    assert.equal(result.merged.createdAt, 2000, 'Takeout message times cannot replace metadata creation');
    assert.equal(result.merged.messageCount, 8);
    assert.equal(result.merged.hasTakeoutImport, true);
    assert.equal(result.isChanged, true, 'import history is a meaningful metadata change');
    for (const field of ['messages', 'turns', 'lastSeen', 'extensionData', 'timestamp', 'titles']) assert.equal(Object.hasOwn(result.merged, field), false);
});
test('legacy aliases are normalized once; missing source facts remain missing', () => {
    const index = parseLegacyConversationIndex({ id: 'c_legacy123', title: 'Historical title', updatedAt: 'invalid', timestamp: '1700000000', createdAt: 0, lastSeen: 9999999999999 });
    assert.equal(index.id, 'legacy123');
    assert.equal(index.updatedAt, 1700000000000);
    assert.equal(index.createdAt, 0);
    const unknown = parseLegacyConversationIndex({ id: 'unknown-time', title: 'Untimed title', lastSeen: 9999999999999, messageCount: 100, turns: [1, 2] });
    assert.equal(unknown.updatedAt, undefined);
    assert.equal(unknown.createdAt, undefined);
    assert.equal(unknown.messageCount, undefined, 'mixed historical counts are not promoted to message facts');
});


test('historical import source survives authoritative title replacement without a candidate map', () => {
    const index = parseLegacyConversationIndex({ id: 'import-history', title: 'Online rename', titleSource: 'rpc', source: 'takeout-import' });
    assert.equal(index.hasTakeoutImport, true);
    assert.equal(index.titleSource, 'rpc');
    assert.equal(index.title, 'Online rename');
    assert.equal(Object.hasOwn(index, 'source'), false);
});
