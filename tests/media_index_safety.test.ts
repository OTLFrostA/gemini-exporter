import test from 'node:test';
import assert from 'node:assert/strict';
import { readTakeoutBytes } from '../src/l1/imports/takeout/readArchive.js';
test('source resource - readTakeoutBytes boundaries and validation', async () => {
    // 1. Valid Uint8Array with length > 0
    const validBytes = new Uint8Array([1, 2, 3]);
    const fileValid = { async: async () => validBytes };
    assert.deepStrictEqual(await readTakeoutBytes(fileValid), validBytes);

    // 2. Empty Uint8Array -> null
    const fileEmpty = { async: async () => new Uint8Array(0) };
    assert.strictEqual(await readTakeoutBytes(fileEmpty), null);

    // 3. Invalid async return types -> null
    const fileString = { async: async () => 'not bytes' };
    assert.strictEqual(await readTakeoutBytes(fileString), null);

    const fileNull = { async: async () => null };
    assert.strictEqual(await readTakeoutBytes(fileNull), null);

    const fileObj = { async: async () => ({ length: 10 }) };
    assert.strictEqual(await readTakeoutBytes(fileObj), null);

    // 4. Missing async or missing file -> null
    assert.strictEqual(await readTakeoutBytes({}), null);



    // 5. Rejection preserves error propagation to caller
    const fileError = {
        async: async () => { throw new Error('ZIP read failure'); }
    };
    await assert.rejects(async () => {
        await readTakeoutBytes(fileError);
    }, /ZIP read failure/);
});
