const test = require('node:test');
const assert = require('node:assert');
const TakeoutEngine = require('../takeout_engine.js');

test('takeout_engine - exports and methods', () => {
    assert.strictEqual(typeof TakeoutEngine.parseTakeoutZip, 'function');
    assert.strictEqual(typeof TakeoutEngine.getTakeoutOfflineChat, 'function');
    assert.strictEqual(typeof TakeoutEngine.getTakeoutFallbackMedia, 'function');
    assert.strictEqual(typeof TakeoutEngine.clearTakeoutData, 'function');
});

test('takeout_engine - getTakeoutOfflineChat empty default', () => {
    TakeoutEngine.clearTakeoutData();
    assert.strictEqual(TakeoutEngine.getTakeoutOfflineChat('nonexistent_id'), null);
});
