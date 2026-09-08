export {};
const test = require('node:test');
const assert = require('node:assert');

const ListView = require('../src/ui/views/listView.js');

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
        querySelectorAll: (selector: string) => {
            if (selector.includes('input[type=checkbox]:checked')) return mockCheckboxes.filter((c: any) => c.checked);
            if (selector.includes('input[type=checkbox]')) return mockCheckboxes;
            return [];
        },
        getElementById: () => null
    };

    const origDoc = (globalThis as any).document;
    try {
        (globalThis as any).document = fakeDoc;
        const convs: any[] = [{ id: '1', title: 'A' }, { id: '2', title: 'B' }];
        
        ListView.selectAll(convs);
        assert.strictEqual(mockCheckboxes[0].checked, true);
        assert.strictEqual(mockCheckboxes[1].checked, true);
        assert.strictEqual(ListView.getSelected(convs).length, 2);

        ListView.deselectAll(convs);
        assert.strictEqual(mockCheckboxes[0].checked, false);
        assert.strictEqual(mockCheckboxes[1].checked, false);
        assert.strictEqual(ListView.getSelected(convs).length, 0);
    } finally {
        (globalThis as any).document = origDoc;
    }
});

test('listView - updateItemExportStatus in-place DOM update', () => {
    let queriedSelector: any = null;
    const fakeBadge = { textContent: 'New', style: {} };
    const fakeItem = {
        querySelector: (sel: string) => {
            if (sel === '.badge') return fakeBadge;
            return null;
        }
    };
    const fakeDoc = {
        querySelector: (sel: string) => {
            queriedSelector = sel;
            if (sel.includes('test_chat_123')) return fakeItem;
            return null;
        },
        querySelectorAll: () => [],
        getElementById: () => null
    };

    const origDoc = (globalThis as any).document;
    try {
        (globalThis as any).document = fakeDoc;
        assert.strictEqual(typeof ListView.updateItemExportStatus, 'function');
        ListView.updateItemExportStatus('c_test_chat_123', { exportedAt: '2026-09-07' });
        assert.ok(queriedSelector && queriedSelector.includes('test_chat_123'));
        assert.ok(fakeBadge.textContent === '已导出' || fakeBadge.textContent === 'Exported');
    } finally {
        (globalThis as any).document = origDoc;
    }
});

