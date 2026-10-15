import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { restoreConversationIndex, type DomainConversationIndex } from '../src/core/domain/conversationIndex.js';
import { isTakeoutConversation } from '../src/core/utils/titleUtils.js';
import ConversationsStore from '../src/ui/state/conversationsStore.js';
import { StorageService } from '../src/core/storage/storageService.js';

// The current Domain contract records import history independently of title provenance.
// A later RPC title must not erase a prior Takeout import.
function index(id: string, hasTakeoutImport: boolean, titleSource: 'rpc' | 'takeout' = 'rpc'): DomainConversationIndex {
    return restoreConversationIndex({
        providerId: 'gemini', id, title: `Conversation ${id}`, titleSource,
        cloudAvailability: 'available', hasTakeoutImport,
    });
}

const cases = () => [
    index('mixed', true, 'rpc'),       // Takeout history, title superseded by RPC.
    index('takeout', true, 'takeout'), // Takeout title and import history.
    index('active', false, 'rpc'),
    index('stale', false, 'rpc'),
];

test('UI/cloud reconciliation retains imported conversations after an RPC title update', async () => {
    const env = indexStorage();
    const previousSlot = ConversationsStore.getCurrentSlot();
    const previousList = ConversationsStore.getConversations();
    try {
        const originals = cases();
        await StorageService.setConversations('u45', originals);
        ConversationsStore.setCurrentSlot('u45');
        ConversationsStore.setConversations(originals);

        const result = await ConversationsStore.reconcileWithCloud([{ id: 'active' }], { keepTakeout: true });
        assert.deepEqual(new Set(ConversationsStore.getConversations().map(c => c.id)),
            new Set(['mixed', 'takeout', 'active']));
        assert.deepEqual(new Set((await StorageService.getConversations('u45')).map(c => c.id)),
            new Set(['mixed', 'takeout', 'active']), 'UI and persisted reconciliation must agree');
        assert.deepEqual(result.removedIds, ['stale']);
        assert.equal(result.kept, 3);
        assert.equal(ConversationsStore.hasTakeoutData(), true);
    } finally {
        ConversationsStore.setConversations(previousList);
        ConversationsStore.setCurrentSlot(previousSlot);
        env.restore();
    }
});

test('persistent reconciliation with keepTakeout=false may explicitly drop absent imported chats', async () => {
    const env = indexStorage();
    try {
        await StorageService.setConversations('u45', cases());
        const result = await StorageService.reconcileConversations('u45', [{ id: 'active' }], { keepTakeout: false });
        assert.deepEqual(new Set(result.removedIds), new Set(['mixed', 'takeout', 'stale']));
        assert.equal(result.kept, 1);
        assert.deepEqual((await StorageService.getConversations('u45')).map(c => c.id), ['active']);
    } finally { env.restore(); }
});

test('Takeout status depends on import history, not title provenance', () => {
    assert.equal(isTakeoutConversation(index('mixed', true, 'rpc')), true);
    assert.equal(isTakeoutConversation(index('takeout', true, 'takeout')), true);
    assert.equal(isTakeoutConversation(index('active', false, 'rpc')), false);
    assert.equal(isTakeoutConversation(null), false);
});
