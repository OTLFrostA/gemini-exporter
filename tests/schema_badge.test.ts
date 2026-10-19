import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    markSchemaFrozen, isSchemaFrozen, assertSchemaWritable,
    SchemaFrozenError, __setSchemaFrozenForTest
} from '../src/core/storage/schemaState.js';

test('rejected badge promises are handled without weakening the frozen write guard', async () => {
    const previousChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    let badgeTextAttempted = false;
    let badgeColorAttempted = false;

    console.warn = (...args: unknown[]) => { warnings.push(args); };
    Object.defineProperty(globalThis, 'chrome', {
        configurable: true, writable: true, value: {
            action: {
                setBadgeText: () => {
                    badgeTextAttempted = true;
                    return Promise.reject(new Error('Badge unavailable'));
                },
                setBadgeBackgroundColor: () => {
                    badgeColorAttempted = true;
                    return Promise.reject(new Error('Color unavailable'));
                }
            }
        }
    });

    try {
        markSchemaFrozen();
        await assert.rejects(assertSchemaWritable(), SchemaFrozenError);
        // Let the Promise rejection handlers report both badge failures.
        await new Promise<void>(resolve => setImmediate(resolve));

        assert.equal(isSchemaFrozen(), true, 'badge failures must not unfreeze storage');
        assert.ok(badgeTextAttempted, 'frozen state should attempt the warning badge');
        assert.ok(badgeColorAttempted, 'frozen state should attempt the warning badge color');
        assert.ok(warnings.some(args => args[0] === 'Unable to display frozen storage badge'));
        assert.ok(warnings.some(args => args[0] === 'Unable to color frozen storage badge'));
    } finally {
        __setSchemaFrozenForTest(false);
        console.warn = originalWarn;
        if (previousChrome) Object.defineProperty(globalThis, 'chrome', previousChrome);
        else Reflect.deleteProperty(globalThis, 'chrome');
    }
});
