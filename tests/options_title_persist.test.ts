import test from 'node:test';
import assert from 'node:assert/strict';
import { indexFixture } from './helpers/indexFixture.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
import { refreshConversationIndex } from '../src/ui/options/modules/optionsExport.js';

test.afterEach(() => __clearModuleOverrides());

test('export callback refreshes the visible index from accepted storage without publishing metadata', async () => {
    const item = indexFixture({ id: 'chat', title: 'Old', titleSource: 'dom' });
    const accepted = indexFixture({ id: 'chat', title: 'Accepted', titleSource: 'rpc', createdAt: 10, updatedAt: 20, messageCount: 4 });
    __setModuleOverride('ConversationsStore', { getConversations: () => [item], getCurrentSlot: () => 'u0' });
    __setModuleOverride('StorageService', { conversationRepository: (scope: { accountSlot: string }) => {
        assert.equal(scope.accountSlot, 'u0');
        return { getConversationIndex: async (id: string) => { assert.equal(id, 'chat'); return accepted; } };
    }, updateConversation: () => assert.fail('render callback must not write metadata') });
    await refreshConversationIndex('c_chat', 'u0');
    assert.deepEqual(item, accepted);
});

test('late export refresh cannot overwrite the newly selected account', async () => {
    const item = indexFixture({ id: 'chat', title: 'Other account' });
    let visibleSlot = 'u0';
    __setModuleOverride('ConversationsStore', { getConversations: () => [item], getCurrentSlot: () => visibleSlot });
    __setModuleOverride('StorageService', { conversationRepository: () => ({ getConversationIndex: async () => {
        visibleSlot = 'u1';
        return indexFixture({ id: 'chat', title: 'Original account' });
    } }) });
    await refreshConversationIndex('chat', 'u0');
    assert.equal(item.title, 'Other account');
});
