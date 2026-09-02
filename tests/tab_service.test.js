const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const TabService = (typeof require !== 'undefined') ? require('../src/core/utils/tabService.js') : (typeof globalThis.TabService !== 'undefined' ? globalThis.TabService : null);

test('tabService - exports', () => {
    assert.ok(TabService);
    assert.strictEqual(typeof TabService.getGeminiTab, 'function');
    assert.strictEqual(typeof TabService.sendToGeminiTab, 'function');
});

test('tabService - getGeminiTab with slot matching', async () => {
    global.chrome = {
        tabs: {
            query: async () => [
                { id: 1, url: 'https://gemini.google.com/app/1', active: false },
                { id: 2, url: 'https://gemini.google.com/u/1/app/2', active: false },
                { id: 3, url: 'https://gemini.google.com/u/2/app/3', active: true }
            ]
        }
    };

    const tabU1 = await TabService.getGeminiTab('u1');
    assert.strictEqual(tabU1.id, 2);

    const tabU2 = await TabService.getGeminiTab('u2');
    assert.strictEqual(tabU2.id, 3);

    const tabDefault = await TabService.getGeminiTab('u0');
    assert.strictEqual(tabDefault.id, 1);
});
