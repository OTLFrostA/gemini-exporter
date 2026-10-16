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
    previousSlot = ConversationsStore.getCurrentAccountId();
});
test.afterEach(() => {
    ConversationsStore.setConversations(previousConversations);
    ConversationsStore.setExportedIds(previousExportedIds);
    ConversationsStore.setCurrentAccountId(previousSlot);
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

    ConversationsStore.setCurrentAccountId('10000000-0000-4000-8000-000000000002');
    assert.strictEqual(ConversationsStore.getCurrentAccountId(), '10000000-0000-4000-8000-000000000002');
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

for (const switchAccount of [false, true]) test(`a delayed account load cannot replace a newer ${switchAccount ? 'account selection' : 'snapshot'}`, async () => {
    const { __setModuleOverride, __clearModuleOverrides } = require('../src/core/utils/moduleOverrides.js');
    const firstId = '10000000-0000-4000-8000-000000000001';
    const nextId = switchAccount ? '10000000-0000-4000-8000-000000000002' : firstId;
    let release!: (rows: ReturnType<typeof indexFixture>[]) => void;
    const held = new Promise<ReturnType<typeof indexFixture>[]>(resolve => { release = resolve; });
    let arrived!: () => void;
    const pendingRead = new Promise<void>(resolve => { arrived = resolve; });
    let reads = 0;
    __setModuleOverride('StorageService', {
        listAccounts: async () => [firstId, '10000000-0000-4000-8000-000000000002'].map((id, i) => ({ id, providerId: 'gemini', providerAccountId: 'gaia-' + i })),
        getConversations: async () => { if (reads++ === 0) { arrived(); return held; } return [indexFixture({ id: 'newer', title: 'Newer snapshot' })]; },
        getExportedIds: async () => ({}),
    });
    try {
        ConversationsStore.setCurrentAccountId(firstId);
        const older = ConversationsStore.loadStore(firstId);
        await pendingRead;
        ConversationsStore.setCurrentAccountId(nextId);
        await ConversationsStore.loadStore(nextId);
        release([indexFixture({ id: 'older', title: 'Older snapshot' })]);
        await older;
        assert.strictEqual(ConversationsStore.getCurrentAccountId(), nextId);
        assert.deepStrictEqual(ConversationsStore.getConversations().map((row: { id: string }) => row.id), ['newer']);
    } finally { release([]); __clearModuleOverrides(); }
});

for (const operation of ['remove', 'reconcile']) test(`completion of ${operation} in A cannot remove the same conversation from the visible B account`, async () => {
    const { __setModuleOverride, __clearModuleOverrides } = require('../src/core/utils/moduleOverrides.js');
    const firstId = '10000000-0000-4000-8000-000000000001';
    const nextId = '10000000-0000-4000-8000-000000000002';
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let arrived!: () => void;
    const pendingWrite = new Promise<void>(resolve => { arrived = resolve; });
    __setModuleOverride('StorageService', {
        removeConversation: async (id: string) => { assert.strictEqual(id, firstId); arrived(); await held; return true; },
        reconcileConversations: async (id: string) => { assert.strictEqual(id, firstId); arrived(); await held; return { kept: 0, removed: 1, removedIds: ['shared'] }; },
    });
    try {
        ConversationsStore.setCurrentAccountId(firstId);
        const pending = operation === 'remove' ? ConversationsStore.removeConversation('shared') : ConversationsStore.reconcileWithCloud([]);
        await pendingWrite;
        ConversationsStore.setCurrentAccountId(nextId);
        ConversationsStore.setConversations([indexFixture({ id: 'shared', title: 'B keeps this conversation' })]);
        release(); await pending;
        assert.strictEqual(ConversationsStore.getCurrentAccountId(), nextId);
        assert.deepStrictEqual(ConversationsStore.getConversations().map((row: { id: string }) => row.id), ['shared']);
    } finally { release(); __clearModuleOverrides(); }
});
