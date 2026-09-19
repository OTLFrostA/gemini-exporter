export {};
const test = require('node:test');
const assert = require('node:assert');
const {
    getConversationDetail,
    saveConversationDetail,
    saveConversationDetailsBatch,
    removeConversationDetails,
    hasConversationDetail,
    clearAllDetails,
    ConversationDetailStore,
    __clearMemoryStore
} = require('../src/core/storage/conversationDetailStore.js');

test.beforeEach(() => {
    __clearMemoryStore();
});

test('conversation_detail_store - save and get single conversation detail', async () => {
    const detail = {
        messages: [
            { id: 'm1', role: 'user', content: 'Hello' },
            { id: 'm2', role: 'model', content: 'World' }
        ],
        turns: [
            { user: 'Hello', model: 'World' }
        ],
        updatedAt: 1700000000000
    };

    const saved = await saveConversationDetail('chat_1', detail);
    assert.strictEqual(saved, true);

    const retrieved = await getConversationDetail('chat_1');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.id, 'chat_1');
    assert.strictEqual(retrieved.messages.length, 2);
    assert.strictEqual(retrieved.messages[0].content, 'Hello');
    assert.strictEqual(retrieved.turns.length, 1);
    assert.strictEqual(retrieved.updatedAt, 1700000000000);
    assert.ok(typeof retrieved.savedAt === 'number');

    // canonical normId probe ('c_chat_1' -> 'chat_1')
    const byAlias = await getConversationDetail('c_chat_1');
    assert.ok(byAlias);
    assert.strictEqual(byAlias.id, 'chat_1');
});

test('conversation_detail_store - batch save details from array and record map', async () => {
    // Array format
    await saveConversationDetailsBatch([
        { id: 'chat_a', messages: [{ id: 'm1', role: 'user', content: 'Alpha' }] },
        { id: 'chat_b', messages: [{ id: 'm2', role: 'user', content: 'Beta' }] }
    ]);

    assert.strictEqual(await hasConversationDetail('chat_a'), true);
    assert.strictEqual(await hasConversationDetail('chat_b'), true);
    assert.strictEqual(await hasConversationDetail('chat_nonexistent'), false);

    // Record map format
    await saveConversationDetailsBatch({
        'chat_c': { messages: [{ id: 'm3', role: 'user', content: 'Gamma' }] }
    });

    const c = await getConversationDetail('chat_c');
    assert.ok(c);
    assert.strictEqual(c.messages[0].content, 'Gamma');
});

test('conversation_detail_store - remove details and clear', async () => {
    await saveConversationDetailsBatch([
        { id: 'chat_x', messages: [] },
        { id: 'chat_y', messages: [] },
        { id: 'chat_z', messages: [] }
    ]);

    const removedCount = await removeConversationDetails(['chat_x', 'c_chat_y']);
    assert.strictEqual(removedCount, 2);
    assert.strictEqual(await hasConversationDetail('chat_x'), false);
    assert.strictEqual(await hasConversationDetail('chat_y'), false);
    assert.strictEqual(await hasConversationDetail('chat_z'), true);

    await clearAllDetails();
    assert.strictEqual(await hasConversationDetail('chat_z'), false);
});
