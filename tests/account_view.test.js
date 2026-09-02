const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const AccountView = (typeof require !== 'undefined') ? require('../src/ui/views/accountView.js') : (typeof globalThis.AccountView !== 'undefined' ? globalThis.AccountView : null);

test('accountView - exports', () => {
    assert.ok(AccountView);
    assert.strictEqual(typeof AccountView.render, 'function');
    assert.strictEqual(typeof AccountView.bindChange, 'function');
});

test('accountView - render without DOM element does not crash', () => {
    AccountView.render({ 'u0': { name: 'Main' } }, 'u0');
});
