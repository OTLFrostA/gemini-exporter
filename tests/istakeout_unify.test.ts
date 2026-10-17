import { indexFixture } from './helpers/indexFixture.js';
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
    return indexFixture({
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
    const previousSlot = ConversationsStore.getCurrentAccountId();
    const previousList = ConversationsStore.getConversations();
    try {
        const originals = cases();
        await StorageService.setConversations('10000000-0000-4000-8000-000000000001', originals);
        ConversationsStore.setCurrentAccountId('10000000-0000-4000-8000-000000000001');
        ConversationsStore.setConversations(originals);

        const result = await ConversationsStore.reconcileWithCloud([{ id: 'active' }], { keepTakeout: true });
        assert.deepEqual(new Set(ConversationsStore.getConversations().map(c => c.key.conversationId)),
            new Set(['mixed', 'takeout', 'active', 'stale']));
        assert.deepEqual(new Set((await StorageService.getConversations('10000000-0000-4000-8000-000000000001')).map(c => c.key.conversationId)),
            new Set(['mixed', 'takeout', 'active', 'stale']), 'UI and persisted reconciliation must agree');
        assert.deepEqual(result.removedIds, []);
        assert.equal(result.kept, 4);
    } finally {
        ConversationsStore.setConversations(previousList);
        ConversationsStore.setCurrentAccountId(previousSlot);
        env.restore();
    }
});

test('persistent cloud reconciliation preserves local archives regardless of list absence', async () => {
    const env = indexStorage();
    try {
        await StorageService.setConversations('10000000-0000-4000-8000-000000000001', cases());
        const result = await StorageService.reconcileConversations('10000000-0000-4000-8000-000000000001', [{ id: 'active' }], { keepTakeout: false });
        assert.deepEqual(new Set(result.removedIds), new Set([]));
        assert.equal(result.kept, 4);
        assert.deepEqual((await StorageService.getConversations('10000000-0000-4000-8000-000000000001')).map(c => c.key.conversationId), ['mixed', 'takeout', 'active', 'stale']);
    } finally { env.restore(); }
});

test('Domain Index does not expose transient Takeout import state', () => {
    assert.equal(isTakeoutConversation(index('mixed', true, 'rpc')), false);
    assert.equal(isTakeoutConversation(index('takeout', true, 'takeout')), false);
    assert.equal(isTakeoutConversation(index('active', false, 'rpc')), false);
    assert.equal(isTakeoutConversation(null), false);
});
