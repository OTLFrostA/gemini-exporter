import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markSchemaFrozen, assertSchemaWritable, SchemaFrozenError, __setSchemaFrozenForTest } from '../src/core/storage/schemaState.js';
test('rejected badge promises are handled and never weaken frozen writes', async () => {
    const previous = Reflect.get(globalThis, 'chrome');
    const warn = console.warn; const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    Reflect.set(globalThis, 'chrome', { action: {
        setBadgeText: () => Promise.reject(new Error('Badge unavailable')),
        setBadgeBackgroundColor: () => Promise.reject(new Error('Color unavailable')),
    } });
    try {
        markSchemaFrozen();
        await assert.rejects(assertSchemaWritable(), SchemaFrozenError);
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(warnings.length, 4);
    } finally {
        __setSchemaFrozenForTest(false); console.warn = warn;
        if (previous === undefined) Reflect.deleteProperty(globalThis, 'chrome'); else Reflect.set(globalThis, 'chrome', previous);
    }
});
