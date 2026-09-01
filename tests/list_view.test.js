const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const ListView = (typeof require !== 'undefined') ? require('../src/ui/views/listView.js') : (typeof globalThis.ListView !== 'undefined' ? globalThis.ListView : null);

test('listView - isRealTitle recognition', () => {
    assert.strictEqual(ListView.isRealTitle('Valid Title', '123'), true);
    assert.strictEqual(ListView.isRealTitle('Untitled', '123'), false);
    assert.strictEqual(ListView.isRealTitle('未命名对话', '123'), false);
    assert.strictEqual(ListView.isRealTitle('c_12345678', '12345678'), false);
    assert.strictEqual(ListView.isRealTitle('', '123'), false);
    assert.strictEqual(ListView.isRealTitle(null, '123'), false);
});

test('listView - export interface exists', () => {
    assert.strictEqual(typeof ListView.render, 'function');
    assert.strictEqual(typeof ListView.updateStat, 'function');
    assert.strictEqual(typeof ListView.getSelected, 'function');
    assert.strictEqual(typeof ListView.selectAll, 'function');
    assert.strictEqual(typeof ListView.deselectAll, 'function');
    assert.strictEqual(typeof ListView.selectUnexported, 'function');
    assert.strictEqual(typeof ListView.selectNeedsUpdate, 'function');
});
