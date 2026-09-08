import test from 'node:test';
import assert from 'node:assert';

import * as TabService from '../src/core/utils/tabService.js';

test('tabService - exports', () => {
    assert.ok(TabService);
    assert.strictEqual(typeof TabService.getGeminiTab, 'function');
    assert.strictEqual(typeof TabService.sendToGeminiTab, 'function');
});

test('tabService - getGeminiTab with slot matching', async () => {
    (global as any).chrome = {
        tabs: {
            query: async () => [
                { id: 1, url: 'https://gemini.google.com/app/1', active: false },
                { id: 2, url: 'https://gemini.google.com/u/1/app/2', active: false },
                { id: 3, url: 'https://gemini.google.com/u/2/app/3', active: true }
            ]
        }
    };


    const tabU1 = await TabService.getGeminiTab('u1');
    assert.strictEqual(tabU1!.id, 2);

    const tabU2 = await TabService.getGeminiTab('u2');
    assert.strictEqual(tabU2!.id, 3);

    const tabDefault = await TabService.getGeminiTab('u0');
    assert.strictEqual(tabDefault!.id, 1);
});

