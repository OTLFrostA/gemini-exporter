import test from 'node:test';
import assert from 'node:assert/strict';
import { readTakeoutBytes } from '../src/l1/imports/takeout/readArchive.js';
import { extractC2PATimestamp } from '../src/l1/parsers/shared/resources/c2paTimestamp.js';
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

// ==========================================
// 5. C2PA Timestamp Extraction
// ==========================================
test('source resource - extractC2PATimestamp accepted inputs and edge cases', () => {
    // 1. String input with valid trust marker
    const validStr = 'c2pa:claim_generator="Google" date="20260902183651Z"';
    const tsStr = extractC2PATimestamp(validStr);
    assert.ok(tsStr !== null);
    assert.strictEqual(new Date(tsStr).toISOString(), '2026-09-02T18:36:51.000Z');

    // 2. Uint8Array input with valid trust marker
    const rawBytes = new TextEncoder().encode('prefix_header_jumb_c2pa_metadata_20281231235959Z_tail');
    const tsBytes = extractC2PATimestamp(rawBytes);
    assert.ok(tsBytes !== null);
    assert.strictEqual(new Date(tsBytes).toISOString(), '2028-12-31T23:59:59.000Z');

    // 3. Other ArrayBufferView (DataView) input
    const dv = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const tsDv = extractC2PATimestamp(dv);
    assert.strictEqual(tsDv, tsBytes, 'ArrayBufferView must decode correctly');

    // 4. Missing / distant trust marker -> null
    const noMarker = 'dummy_header_without_marker_20260902183651Z_tail';
    assert.strictEqual(extractC2PATimestamp(noMarker), null, 'timestamp without marker must return null');

    const padding = 'x'.repeat(600);
    const distantMarker = `c2pa${padding}20260902183651Z`;
    assert.strictEqual(extractC2PATimestamp(distantMarker), null, 'marker beyond 512-byte window must return null');

    // 5. Calendar validation: leap years, invalid days/months
    // Invalid month 13
    assert.strictEqual(extractC2PATimestamp('c2pa date="20261301120000Z"'), null);
    // Invalid day (Feb 30)
    assert.strictEqual(extractC2PATimestamp('c2pa date="20260230120000Z"'), null);
    // Valid leap day: 2028 is leap year, Feb 29 is valid
    const leapDay = extractC2PATimestamp('c2pa date="20280229120000Z"');
    assert.ok(leapDay !== null);
    assert.strictEqual(new Date(leapDay).toISOString(), '2028-02-29T12:00:00.000Z');
    // Non-leap day: 2026 is not leap year, Feb 29 is invalid
    assert.strictEqual(extractC2PATimestamp('c2pa date="20260229120000Z"'), null);

    // 6. Seconds handling (regex [0-5]\d matches up to 59 seconds)
    const sec59 = extractC2PATimestamp('c2pa date="20260615120059Z"');
    assert.ok(sec59 !== null, 'sec 59 should be accepted');
    assert.strictEqual(new Date(sec59).toISOString(), '2026-06-15T12:00:59.000Z');

    // Seconds 60 does not match [0-5]\d regex and must return null
    assert.strictEqual(extractC2PATimestamp('c2pa date="20260615120060Z"'), null, 'sec 60 must return null');

    // 7. Unsupported types must strictly return null
    assert.strictEqual(extractC2PATimestamp(null), null);
    assert.strictEqual(extractC2PATimestamp(undefined), null);
    assert.strictEqual(extractC2PATimestamp(12345), null);
    assert.strictEqual(extractC2PATimestamp(true), null);
    assert.strictEqual(extractC2PATimestamp({}), null);
    // Raw ArrayBuffer (not a view) must return null
    const rawBuffer = new ArrayBuffer(50);
    assert.strictEqual(extractC2PATimestamp(rawBuffer), null, 'raw ArrayBuffer without View must return null');
});
