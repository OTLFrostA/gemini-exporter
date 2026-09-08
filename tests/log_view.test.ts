export {};
const test = require('node:test');
const assert = require('node:assert');

const LogView = require('../src/ui/views/logView.js');

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
