const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const LogView = (typeof require !== 'undefined') ? require('../src/ui/views/logView.js') : (typeof globalThis.LogView !== 'undefined' ? globalThis.LogView : null);

test('logView - buffer recording and deduplication', () => {
    LogView.clear();
    assert.strictEqual(LogView.getBuffer().length, 0);

    LogView.log('Message 1', 'info');
    assert.strictEqual(LogView.getBuffer().length, 1);
    assert.strictEqual(LogView.getBuffer()[0].msg, 'Message 1');

    // Identical message in rapid succession should be deduplicated
    LogView.log('Message 1', 'info');
    assert.strictEqual(LogView.getBuffer().length, 1);

    // Different message should be added
    LogView.log('Message 2', 'warn');
    assert.strictEqual(LogView.getBuffer().length, 2);
    assert.strictEqual(LogView.getBuffer()[1].level, 'warn');

    LogView.clear();
    assert.strictEqual(LogView.getBuffer().length, 0);
});
