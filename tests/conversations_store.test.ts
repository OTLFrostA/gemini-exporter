import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert');

const ConversationsStore = require('../src/ui/state/conversationsStore.js');

// This module owns singleton UI state; one case must not seed another.
let previousConversations: any[];
let previousExportedIds: Record<string, any>;
let previousSlot: string;
test.beforeEach(() => {
    previousConversations = ConversationsStore.getConversations();
    previousExportedIds = ConversationsStore.getExportedIds();
    previousSlot = ConversationsStore.getCurrentSlot();
});
test.afterEach(() => {
    ConversationsStore.setConversations(previousConversations);
    ConversationsStore.setExportedIds(previousExportedIds);
    ConversationsStore.setCurrentSlot(previousSlot);
});

test('conversationsStore - normId', () => {
    assert.strictEqual(ConversationsStore.normId('c_12345678'), '12345678');
    assert.strictEqual(ConversationsStore.normId('12345678'), '12345678');
    assert.strictEqual(ConversationsStore.normId(''), '');
    assert.strictEqual(ConversationsStore.normId(null), '');
});

test('conversationsStore - in-memory get and set', () => {
    const list: any[] = [{ id: '1', title: 'Chat 1' }, { id: '2', title: 'Chat 2' }];
    const canonicalList = list.map(indexFixture);
    ConversationsStore.setConversations(canonicalList);
    assert.strictEqual(ConversationsStore.getConversations(), canonicalList, 'the UI store must keep the supplied canonical list');

    const expMap = { '1': { exportedAt: 1000 } };
    ConversationsStore.setExportedIds(expMap);
    assert.deepStrictEqual(ConversationsStore.getExportedIds(), expMap);

    ConversationsStore.setCurrentSlot('u1');
    assert.strictEqual(ConversationsStore.getCurrentSlot(), 'u1');
});

test('conversationsStore - getExportedRecord normalization', () => {
    ConversationsStore.setExportedIds({
        'c_123': { exportedAt: 5000 },
        '456': { exportedAt: 6000 }
    });

    assert.ok(ConversationsStore.getExportedRecord('123'));
    assert.strictEqual(ConversationsStore.getExportedRecord('123').exportedAt, 5000);
    assert.ok(ConversationsStore.getExportedRecord('c_123'));

    assert.ok(ConversationsStore.getExportedRecord('456'));
    assert.strictEqual(ConversationsStore.getExportedRecord('456').exportedAt, 6000);
    assert.ok(ConversationsStore.getExportedRecord('c_456'));

    assert.strictEqual(ConversationsStore.getExportedRecord('non_existent'), null);
    assert.strictEqual(ConversationsStore.getExportedRecord(null), null);
});

test('conversationsStore - getSignature', () => {
    const sigEmpty = ConversationsStore.getSignature([]);
    assert.strictEqual(sigEmpty, 'empty');

    const sigA = ConversationsStore.getSignature([{ id: 'a', title: 'Title 1' }, { id: 'b', title: 'Title 2' }]);
    const sigB = ConversationsStore.getSignature([{ id: 'a', title: 'Title 1' }, { id: 'b', title: 'Title 2' }]);
    assert.strictEqual(sigA, sigB);

    const sigC = ConversationsStore.getSignature([{ id: 'a', title: 'Title 1' }, { id: 'c', title: 'Title 2' }]);
    assert.ok(sigA !== sigC);

    const sigD = ConversationsStore.getSignature([{ id: 'a', title: 'Real Title' }, { id: 'b', title: 'Title 2' }]);
    assert.ok(sigA !== sigD);
});

test('conversationsStore detects historical import fact, not title provenance', () => {
    const canonical = (id: string, titleSource: 'rpc' | 'takeout', hasTakeoutImport: boolean) =>
        indexFixture({ providerId: 'gemini', id, title: 'Valid title', titleSource,
            cloudAvailability: 'unknown', hasTakeoutImport });

    const online = canonical('online', 'rpc', false);
    const titleOnly = canonical('title-only', 'takeout', false);
    const importedRenamed = canonical('imported', 'rpc', true);

    ConversationsStore.setConversations([online, titleOnly]);
    assert.strictEqual(ConversationsStore.hasTakeoutData(), false,
        'a Takeout-looking title does not prove a prior import');
    ConversationsStore.setConversations([online, importedRenamed]);
    assert.strictEqual(ConversationsStore.hasTakeoutData(), true,
        'a conversation renamed online still carries its import history');
    ConversationsStore.setConversations([online]);
    assert.strictEqual(ConversationsStore.hasTakeoutData(), false);
});

test('conversationsStore consumes canonical indexes without rewriting them', () => {
    const list = [indexFixture({ id: 'abc123', title: 'Research', titleSource: 'rpc', updatedAt: 42 })];
    ConversationsStore.setConversations(list);
    assert.strictEqual(ConversationsStore.getConversations(), list);
});


test('conversationsStore signature observes activity changes without a title or order change', () => {
    const original = Array.from({ length: 8 }, (_, i) => indexFixture({ id: `signature-${i}`, title: 'Same title', updatedAt: 10 }));
    const changed = original.map((row, i) => i === 4 ? { ...row, updatedAt: 20 } : row);
    assert.notStrictEqual(ConversationsStore.getSignature(original), ConversationsStore.getSignature(changed));
});
