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

test('listView - selectAll & deselectAll DOM simulation', () => {
    const mockCheckboxes = [{ checked: false, dataset: { idx: '0' } }, { checked: false, dataset: { idx: '1' } }];
    const fakeDoc = {
        querySelectorAll: (selector) => {
            if (selector.includes('input[type=checkbox]:checked')) return mockCheckboxes.filter(c => c.checked);
            if (selector.includes('input[type=checkbox]')) return mockCheckboxes;
            return [];
        },
        getElementById: () => null
    };

    const origDoc = globalThis.document;
    try {
        globalThis.document = fakeDoc;
        const convs = [{ id: '1', title: 'A' }, { id: '2', title: 'B' }];
        
        ListView.selectAll(convs);
        assert.strictEqual(mockCheckboxes[0].checked, true);
        assert.strictEqual(mockCheckboxes[1].checked, true);
        assert.strictEqual(ListView.getSelected(convs).length, 2);

        ListView.deselectAll(convs);
        assert.strictEqual(mockCheckboxes[0].checked, false);
        assert.strictEqual(mockCheckboxes[1].checked, false);
        assert.strictEqual(ListView.getSelected(convs).length, 0);
    } finally {
        globalThis.document = origDoc;
    }
});
