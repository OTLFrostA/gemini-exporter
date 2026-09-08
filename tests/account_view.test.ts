export {};
const test = require('node:test');
const assert = require('node:assert');

const AccountView = require('../src/ui/views/accountView.js');

test('accountView - exports', () => {
    assert.ok(AccountView);
    assert.strictEqual(typeof AccountView.render, 'function');
    assert.strictEqual(typeof AccountView.bindChange, 'function');
});

test('accountView - render without DOM element does not crash', () => {
    AccountView.render({ 'u0': { name: 'Main' } }, 'u0');
});
