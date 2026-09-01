const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const ConversationsStore = (typeof require !== 'undefined') ? require('../src/ui/state/conversationsStore.js') : (typeof globalThis.ConversationsStore !== 'undefined' ? globalThis.ConversationsStore : null);

test('conversationsStore - normId', () => {
    assert.strictEqual(ConversationsStore.normId('c_12345678'), '12345678');
    assert.strictEqual(ConversationsStore.normId('12345678'), '12345678');
    assert.strictEqual(ConversationsStore.normId(''), '');
    assert.strictEqual(ConversationsStore.normId(null), '');
});

test('conversationsStore - in-memory get and set', () => {
    const list = [{ id: '1', title: 'Chat 1' }, { id: '2', title: 'Chat 2' }];
    ConversationsStore.setConversations(list);
    assert.deepStrictEqual(ConversationsStore.getConversations(), list);

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

    const sigA = ConversationsStore.getSignature([{ id: 'a' }, { id: 'b' }]);
    const sigB = ConversationsStore.getSignature([{ id: 'a' }, { id: 'b' }]);
    assert.strictEqual(sigA, sigB);

    const sigC = ConversationsStore.getSignature([{ id: 'a' }, { id: 'c' }]);
    assert.ok(sigA !== sigC);
});
