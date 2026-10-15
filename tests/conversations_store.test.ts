import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { restoreConversationIndex, type DomainConversationIndex } from '../src/core/domain/conversationIndex.js';
import ConversationsStore from '../src/ui/state/conversationsStore.js';

function conversation(id: string, title: string, options: {
    titleSource?: 'rpc' | 'takeout';
    hasTakeoutImport?: boolean;
    updatedAt?: number;
} = {}): DomainConversationIndex {
    return restoreConversationIndex({
        providerId: 'gemini', id, title, titleSource: options.titleSource ?? 'rpc',
        cloudAvailability: 'available', hasTakeoutImport: options.hasTakeoutImport ?? false,
        ...(options.updatedAt !== undefined ? { updatedAt: options.updatedAt } : {}),
    });
}

// The UI store is a module singleton. Keep each test independent of prior cases.
let before: {
    conversations: DomainConversationIndex[];
    exportedIds: ReturnType<typeof ConversationsStore.getExportedIds>;
    slot: string;
};
beforeEach(() => {
    before = {
        conversations: ConversationsStore.getConversations(),
        exportedIds: ConversationsStore.getExportedIds(),
        slot: ConversationsStore.getCurrentSlot(),
    };
});
afterEach(() => {
    ConversationsStore.setConversations(before.conversations);
    ConversationsStore.setExportedIds(before.exportedIds);
    ConversationsStore.setCurrentSlot(before.slot);
});

test('conversationsStore normalizes only the known Gemini conversation id prefix', () => {
    assert.equal(ConversationsStore.normId('c_12345678'), '12345678');
    assert.equal(ConversationsStore.normId('12345678'), '12345678');
    assert.equal(ConversationsStore.normId(''), '');
    assert.equal(ConversationsStore.normId(null), '');
});

test('conversationsStore retains exact canonical index metadata in memory and tracks slot', () => {
    const list = [
        conversation('1', 'Research', { updatedAt: 42 }),
        conversation('2', 'Second chat', { hasTakeoutImport: true, titleSource: 'takeout' }),
    ];
    ConversationsStore.setConversations(list);
    ConversationsStore.setCurrentSlot('u1');
    assert.deepEqual(ConversationsStore.getConversations(), list);
    assert.equal(ConversationsStore.getConversations()[0].updatedAt, 42);
    assert.equal(ConversationsStore.getConversations()[1].hasTakeoutImport, true);
    assert.equal(ConversationsStore.getCurrentSlot(), 'u1');
});

test('conversationsStore folds exported aliases into one record without losing its values', () => {
    ConversationsStore.setExportedIds({ c_123: { exportedAt: 5000 }, '456': { exportedAt: 6000 } });
    const byId = ConversationsStore.getExportedIds();
    assert.deepEqual(Object.keys(byId).sort(), ['123', '456'],
        'each conversation must have a single canonical export record');
    assert.deepEqual(byId['123'], { exportedAt: 5000 });
    assert.deepEqual(byId['456'], { exportedAt: 6000 });
    for (const id of ['123', 'c_123']) assert.equal(ConversationsStore.getExportedRecord(id)?.exportedAt, 5000);
    for (const id of ['456', 'c_456']) assert.equal(ConversationsStore.getExportedRecord(id)?.exportedAt, 6000);
    assert.equal(ConversationsStore.getExportedRecord('non_existent'), null);
    assert.equal(ConversationsStore.getExportedRecord(null), null);
});

test('conversationsStore refresh signature detects identity, title and activity changes', () => {
    const baseline = [
        conversation('a', 'Title 1', { updatedAt: 10 }),
        conversation('b', 'Title 2', { updatedAt: 10 }),
    ];
    assert.equal(ConversationsStore.getSignature([]), 'empty');
    assert.equal(ConversationsStore.getSignature(baseline),
        ConversationsStore.getSignature(structuredClone(baseline)), 'unchanged observations are stable');
    for (const changed of [
        [baseline[0], { ...baseline[1], id: 'c' }],
        [baseline[0], { ...baseline[1], title: 'Updated Title' }],
        [baseline[0], { ...baseline[1], updatedAt: 20 }],
    ]) {
        assert.notEqual(ConversationsStore.getSignature(baseline), ConversationsStore.getSignature(changed),
            'a visible metadata change must invalidate the signature');
    }
    ConversationsStore.setConversations(baseline);
    assert.equal(ConversationsStore.getSignature(), ConversationsStore.getSignature(baseline));
});

test('conversationsStore detects import history independently of title provenance', () => {
    const ordinary = conversation('a', 'Ordinary');
    const takeoutTitleWithoutHistory = conversation('b', 'Old title', { titleSource: 'takeout' });
    const importedWithRpcTitle = conversation('c', 'Updated online', { hasTakeoutImport: true });
    ConversationsStore.setConversations([ordinary, takeoutTitleWithoutHistory]);
    assert.equal(ConversationsStore.hasTakeoutData(), false, 'a title alone does not establish import history');
    ConversationsStore.setConversations([ordinary, importedWithRpcTitle]);
    assert.equal(ConversationsStore.hasTakeoutData(), true, 'an RPC title must not erase Takeout history');
    ConversationsStore.setConversations([]);
    assert.equal(ConversationsStore.hasTakeoutData(), false);
});
