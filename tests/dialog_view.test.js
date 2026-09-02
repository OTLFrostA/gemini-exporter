const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const DialogView = (typeof require !== 'undefined') ? require('../src/ui/views/dialogView.js') : (typeof globalThis.DialogView !== 'undefined' ? globalThis.DialogView : null);

test('dialogView - exports', () => {
    assert.ok(DialogView);
    assert.strictEqual(typeof DialogView.renderExportBanner, 'function');
    assert.strictEqual(typeof DialogView.dismissExportBanner, 'function');
});

test('dialogView - render without DOM element does not crash', () => {
    DialogView.renderExportBanner(null, 'u0', false);
});
