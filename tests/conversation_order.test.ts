import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import { compareConversationIndexes, indexActivityTime, mergeConversationIndex } from '../src/core/domain/conversationIndex.js';
import { indexFixture } from './helpers/indexFixture.js';

test('index ordering prioritizes authored activity over creation and leaves unknown times after known times', () => {
    const records = [indexFixture({ id: 'recent', title: 'Recent', createdAt: 5000 }), indexFixture({ id: 'unknown-time', title: 'Unknown', lastSeen: 99999 }),
        indexFixture({ id: 'revived', title: 'Revived', createdAt: 1000, updatedAt: 6000 })];
    assert.deepEqual(records.sort(compareConversationIndexes).map(item => item.id), ['revived', 'recent', 'unknown-time']);
    assert.equal(indexActivityTime(records[2]), undefined);
});
test('index ordering preserves established array order on ties including missing activity', () => {
    const records = ['third', 'first', 'second'].map(id => indexFixture({ id, title: id }));
    assert.deepEqual(records.sort(compareConversationIndexes).map(item => item.id), ['third', 'first', 'second']);
    assert.equal(compareConversationIndexes({ ...records[0], updatedAt: 0 }, records[1]), -1);
});
test('reviving an old conversation monotonically advances activity without changing creation', () => {
    const old = indexFixture({ id: 'revived', title: 'Revived', createdAt: 1000, updatedAt: 2000 });
    const newer = mergeConversationIndex(old, indexFixture({ ...old, updatedAt: 5000 }));
    assert.equal(newer.createdAt, 1000);
    assert.equal(newer.updatedAt, 5000);
    assert.equal(mergeConversationIndex(newer, old).updatedAt, 5000);
});
test('list parsing provides strict indexes and independent source times, with no invented counts or aliases', () => {
    const wire = JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, [['c_server123', 'Server title', null, null, 12, [1700000000, 0]]]])]]);
    const index = parseList(wire).conversations[0];
    assert.equal(index.updatedAt, 1700000000000);
    assert.equal(index.createdAt, undefined);
    assert.equal(index.messageCount, undefined, 'RPC turn count is not a message count');
    assert.equal(index.cloudAvailability, 'available');
    for (const key of ['timestamp', 'chatTime', 'titles', 'messages', 'lastSeen']) assert.equal(Object.hasOwn(index, key), false);
});
