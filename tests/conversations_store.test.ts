import { indexStorage } from './helpers/indexStorage.js';
import { putIndexes, getIndex } from '../src/core/storage/storageService.js';
import { withRegistry } from './helpers/registryMock.js';
import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert');

const ConversationsStore = require('../src/ui/state/conversationsStore.js');

// This module owns singleton UI state; one case must not seed another.
let previousConversations: any[];
let previousExportedIds: Record<string, any>;
let previousSlot: string;
let previousChrome: typeof chrome;
test.beforeEach(() => {
    previousChrome = globalThis.chrome; globalThis.chrome = withRegistry({}) as typeof chrome;
    previousConversations = ConversationsStore.getConversations();
    previousExportedIds = ConversationsStore.getExportedIds();
    previousSlot = ConversationsStore.getCurrentAccountId();
});
test.afterEach(() => {
    globalThis.chrome = previousChrome;
    ConversationsStore.setConversations(previousConversations);
    ConversationsStore.setExportedIds(previousExportedIds);
    ConversationsStore.setCurrentAccountId(previousSlot);
});

test('conversationsStore - normId', () => {
    assert.strictEqual(ConversationsStore.normId('c_12345678'), 'c_12345678');
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

test('conversationsStore - export record IDs are opaque and never alias another conversation', () => {
    ConversationsStore.setExportedIds({ c_123: { exportedAt: 5000 }, '123': { exportedAt: 6000 } });
    assert.equal(ConversationsStore.getExportedRecord('c_123').exportedAt, 5000);
    assert.equal(ConversationsStore.getExportedRecord('123').exportedAt, 6000);
    assert.equal(ConversationsStore.getExportedRecord('c_456'), null);
    assert.equal(ConversationsStore.getExportedRecord(null), null);
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

test('conversationsStore retains only canonical Index facts', () => {
    const list = [indexFixture({ id: 'imported', title: 'Renamed online', titleSource: 'rpc', hasTakeoutImport: true })];
    ConversationsStore.setConversations(list);
    assert.equal(Object.hasOwn(ConversationsStore.getConversations()[0], 'hasTakeoutImport'), false);
    assert.equal(ConversationsStore.getConversations()[0].titleSource, 'provider');
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
        listIndexes: async () => { if (reads++ === 0) { arrived(); return held; } return [indexFixture({ id: 'newer', title: 'Newer snapshot' })]; },
        listExportRecords: async () => ({}),
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
        assert.deepStrictEqual(ConversationsStore.getConversations().map((row: { key: { conversationId: string } }) => row.key.conversationId), ['newer']);
    } finally { release([]); __clearModuleOverrides(); }
});

test('completion of local cleanup in A cannot remove the same ID from visible B', async () => {
    const environment = indexStorage();
    const firstId = '10000000-0000-4000-8000-000000000001';
    const nextId = '10000000-0000-4000-8000-000000000002';
    const keyA = { accountId: firstId, conversationId: 'shared' };
    const keyB = { accountId: nextId, conversationId: 'shared' };
    try {
        await putIndexes([{ key: keyA }, { key: keyB }]);
        ConversationsStore.setCurrentAccountId(firstId);
        const pending = ConversationsStore.removeConversation('shared');
        ConversationsStore.setCurrentAccountId(nextId);
        ConversationsStore.setConversations([{ key: keyB }]);
        await pending;
        assert.equal(ConversationsStore.getCurrentAccountId(), nextId);
        assert.deepEqual(ConversationsStore.getConversations(), [{ key: keyB }]);
        assert.equal(await getIndex(keyA), null);
        assert.deepEqual(await getIndex(keyB), { key: keyB });
    } finally { environment.restore(); }
});
