const assert = require('assert');
const MessageBridge = require('../src/content/messageBridge.js');

async function runTests() {
    console.log('Testing MessageBridge...');

    // Test 1: init returns API
    const api = MessageBridge.init();
    assert.strictEqual(typeof api.handleWindowMessage, 'function', 'init should return handleWindowMessage');

    // Test 2: ignores falsy or non-object events
    let upsertCalled = false;
    MessageBridge.init({
        upsertConversations: async () => { upsertCalled = true; }
    });
    await api.handleWindowMessage(null);
    await api.handleWindowMessage({});
    assert.strictEqual(upsertCalled, false, 'should ignore invalid event data');

    // Test 3: handles GEMINI_CONVERSATION_DELETED
    let removedId = null;
    let badgeUpdated = false;
    MessageBridge.init({
        Storage: {
            removeConversation: async (slot, id) => {
                removedId = id;
                return true;
            },
            getConversations: async () => [{ id: 'c_remaining' }]
        },
        updateBadge: () => { badgeUpdated = true; },
        getAccountSlot: () => 'u0'
    });

    await api.handleWindowMessage({
        origin: typeof location !== 'undefined' ? location.origin : undefined,
        data: {
            type: 'GEMINI_CONVERSATION_DELETED',
            payload: { id: 'c_test_del', slot: 'u0' }
        }
    });

    assert.strictEqual(removedId, 'c_test_del', 'should remove conversation from storage');
    assert.strictEqual(badgeUpdated, true, 'should update badge after deletion');

    // Test 4: handles __gemExporterNetworkIds
    let networkItems = null;
    MessageBridge.init({
        upsertConversations: async (items, source) => {
            networkItems = items;
            return items.length;
        }
    });

    await api.handleWindowMessage({
        origin: typeof location !== 'undefined' ? location.origin : undefined,
        data: {
            type: '__gemExporterNetworkIds',
            ids: ['c_net1', 'c_net2'],
            source: 'test'
        }
    });

    assert.strictEqual(networkItems.length, 2, 'should upsert 2 network items');
    assert.strictEqual(networkItems[0].id, 'c_net1');

    // Test 5: rejects forged postMessage from foreign source (e.g. iframe)
    let forgedRemovedId = null;
    const fakeWindow = { name: 'top-window' };
    const oldWindow = global.window;
    try {
        global.window = fakeWindow;
        MessageBridge.init({
            Storage: {
                removeConversation: async (slot, id) => {
                    forgedRemovedId = id;
                    return true;
                }
            },
            getAccountSlot: () => 'u0'
        });

        // 5a. foreign source (simulating iframe) -> must be rejected
        await api.handleWindowMessage({
            source: { name: 'iframe-window' },
            data: {
                type: 'GEMINI_CONVERSATION_DELETED',
                payload: { id: 'c_forged_del', slot: 'u0' }
            }
        });
        assert.strictEqual(forgedRemovedId, null, 'should reject postMessage from foreign source / iframe');

        // 5b. source === window -> must be accepted
        await api.handleWindowMessage({
            source: fakeWindow,
            data: {
                type: 'GEMINI_CONVERSATION_DELETED',
                payload: { id: 'c_valid_del', slot: 'u0' }
            }
        });
        assert.strictEqual(forgedRemovedId, 'c_valid_del', 'should accept postMessage when source is window');
    } finally {
        global.window = oldWindow;
    }

    console.log('  ✓ MessageBridge tests passed successfully');
}

runTests().catch(err => {
    console.error('MessageBridge tests failed:', err);
    process.exit(1);
});
