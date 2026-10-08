import { historicalFixture } from './helpers/nativeFixture.js';
import test from 'node:test';
import assert from 'node:assert';

import mediaIndex, {
    getStore,
    normId,
    extractC2PATimestamp,
    getTakeoutOfflineChat,
    getTakeoutMediaForChat,
    getTakeoutFallbackMedia,
    commitTakeoutData,
    clearTakeoutData,
    readTakeoutBytes,
    __slotTakeouts
} from '../src/core/compatibility/takeout/mediaIndex.js';

// ==========================================
// 1. Storage Isolation and Lifecycle
// ==========================================
test('mediaIndex - slot isolation and store lifecycle', () => {
    clearTakeoutData();

    // getStore with missing or blank slots returns fresh store and does NOT auto-commit
    const freshU0 = getStore();
    assert.deepStrictEqual(freshU0, { mediaMap: {}, globalMedia: {}, convCache: {} });
    assert.strictEqual(__slotTakeouts.has('u0'), false, 'getStore must not auto-commit');

    const freshBlank = getStore('   ');
    assert.deepStrictEqual(freshBlank, { mediaMap: {}, globalMedia: {}, convCache: {} });
    assert.strictEqual(__slotTakeouts.has('u0'), false);

    // Commit to slot u0 and u1 independently
    commitTakeoutData('u0', {
        mediaMap: {
            'c_100': [{ filename: 'photo_u0.png', fileObj: { async: async () => new Uint8Array([10, 20]) } }]
        },
        globalMedia: {
            'photo_u0.png': { name: 'photo_u0.png', async: async () => new Uint8Array([10, 20]) }
        },
        convCache: {
            '100': historicalFixture({ id: '100', title: 'Conversation U0' })
        }
    });

    commitTakeoutData('u1', {
        mediaMap: {
            'c_200': [{ filename: 'photo_u1.png', fileObj: { async: async () => new Uint8Array([30, 40]) } }]
        },
        globalMedia: {
            'photo_u1.png': { name: 'photo_u1.png', async: async () => new Uint8Array([30, 40]) }
        },
        convCache: {
            '200': historicalFixture({ id: '200', title: 'Conversation U1' })
        }
    });

    assert.strictEqual(__slotTakeouts.has('u0'), true);
    assert.strictEqual(__slotTakeouts.has('u1'), true);

    // Inspect stores
    const store0 = getStore('u0');
    const store1 = getStore('u1');
    assert.strictEqual(store0.convCache['100']?.conversation.title, 'Conversation U0');
    assert.strictEqual(store0.convCache['200'], undefined);
    assert.strictEqual(store1.convCache['200']?.conversation.title, 'Conversation U1');
    assert.strictEqual(store1.convCache['100'], undefined);

    // getTakeoutOfflineChat isolation
    assert.strictEqual(getTakeoutOfflineChat('c_100', 'u0')?.conversation.title, 'Conversation U0');
    assert.strictEqual(getTakeoutOfflineChat('c_100', 'u1'), null);
    assert.strictEqual(getTakeoutOfflineChat('c_200', 'u1')?.conversation.title, 'Conversation U1');
    assert.strictEqual(getTakeoutOfflineChat('c_200', 'u0'), null);

    // Clearing u0 leaves u1 completely intact
    clearTakeoutData('u0');
    assert.strictEqual(__slotTakeouts.has('u0'), false);
    assert.strictEqual(__slotTakeouts.has('u1'), true);
    assert.strictEqual(getTakeoutOfflineChat('c_200', 'u1')?.conversation.title, 'Conversation U1');

    // Global clear clears all
    clearTakeoutData();
    assert.strictEqual(__slotTakeouts.size, 0);
});

// ==========================================
// 2. Generated Media Matching Path
// ==========================================
test('mediaIndex - generated media matching path rules', async () => {
    clearTakeoutData();
    const fakeBytesA = new Uint8Array([1, 1, 1]);
    const fakeBytesB = new Uint8Array([2, 2, 2]);

    commitTakeoutData('u0', {
        mediaMap: {
            '10': [
                {
                    filename: 'gen_0.png',
                    fileObj: { async: async () => fakeBytesA },
                    imageOrdinal: 0,
                    generation: {
                        chatId: '10',
                        generationOrdinal: 1,
                        imageOrdinal: 0,
                        providerRequestId: 'req_12345678'
                    }
                },
                {
                    filename: 'gen_1.png',
                    fileObj: { async: async () => fakeBytesB },
                    imageOrdinal: 1,
                    generation: {
                        chatId: '10',
                        generationOrdinal: 1,
                        imageOrdinal: 1,
                        providerRequestId: 'req_12345678'
                    }
                }
            ]
        },
        globalMedia: {},
        convCache: {}
    });

    // 1. Exact generation match: ordinal 0
    const res0 = await getTakeoutFallbackMedia('c_10', { assetId: '', sourceUri: 'any_fallback_name.png', generation: {
        chatId: '10',
        generationOrdinal: 1,
        imageOrdinal: 0,
        providerRequestId: 'req_12345678'
    } }, 'u0');
    assert.deepStrictEqual(res0, fakeBytesA, 'ordinal 0 must match fakeBytesA');

    // 2. Exact generation match: ordinal 1
    const res1 = await getTakeoutFallbackMedia('c_10', { assetId: '', sourceUri: 'any_fallback_name.png', generation: {
        chatId: '10',
        generationOrdinal: 1,
        imageOrdinal: 1,
        providerRequestId: 'req_12345678'
    } }, 'u0');
    assert.deepStrictEqual(res1, fakeBytesB, 'ordinal 1 must match fakeBytesB');

    // 3. Wrong chatId in generation identity
    const wrongChat = await getTakeoutFallbackMedia('c_10', { assetId: '', sourceUri: 'any_fallback_name.png', generation: {
        chatId: 'wrong_chat_id',
        generationOrdinal: 1,
        imageOrdinal: 0,
        providerRequestId: 'req_12345678'
    } }, 'u0');
    assert.strictEqual(wrongChat, null, 'wrong chatId must return null');

    // 4. Mismatched generation event
    const wrongEvent = await getTakeoutFallbackMedia('c_10', { assetId: '', sourceUri: 'any_fallback_name.png', generation: {
        chatId: '10',
        generationOrdinal: 99,
        imageOrdinal: 0,
        providerRequestId: 'different_req_888'
    } }, 'u0');
    assert.strictEqual(wrongEvent, null, 'mismatched generation event must return null');

    // 5. Ambiguous match: more than 1 match must return null (not best-effort first match)
    commitTakeoutData('u0', {
        mediaMap: {
            '10': [
                {
                    filename: 'duplicate_1.png',
                    fileObj: { async: async () => fakeBytesA },
                    imageOrdinal: 0,
                    generation: {
                        chatId: '10',
                        generationOrdinal: 5,
                        imageOrdinal: 0,
                        providerRequestId: 'dup_req_12345'
                    }
                },
                {
                    filename: 'duplicate_2.png',
                    fileObj: { async: async () => fakeBytesB },
                    imageOrdinal: 0,
                    generation: {
                        chatId: '10',
                        generationOrdinal: 5,
                        imageOrdinal: 0,
                        providerRequestId: 'dup_req_12345'
                    }
                }
            ]
        },
        globalMedia: {},
        convCache: {}
    });

    const ambiguous = await getTakeoutFallbackMedia('c_10', { assetId: '', sourceUri: 'target.png', generation: {
        chatId: '10',
        generationOrdinal: 5,
        imageOrdinal: 0,
        providerRequestId: 'dup_req_12345'
    } }, 'u0');
    assert.strictEqual(ambiguous, null, 'ambiguous match must strictly return null');

    clearTakeoutData();
});

// ==========================================
// 3. Exact Source Identity and Ambiguity Guards
// ==========================================
test('mediaIndex - exact source identity rejects filename heuristics', async () => {
    clearTakeoutData();
    const bytesReport = new Uint8Array([5, 6, 7]);
    const bytesSingle = new Uint8Array([8, 9, 10]);

    commitTakeoutData('u0', {
        mediaMap: {
            'chat_doc': [
                { filename: 'f1a2b3c4_financial_quarterly_report.pdf', fileObj: { async: async () => bytesReport } }
            ],
            'chat_single': [
                { filename: 'random_photo_xyz.jpg', fileObj: { async: async () => bytesSingle } }
            ]
        },
        globalMedia: {
            'global_distinct_stem': { name: 'global_distinct_stem.png', async: async () => new Uint8Array([11]) },
            'image': { name: 'image.png', async: async () => new Uint8Array([99]) }
        },
        convCache: {}
    });

    // Exact original names work; prefix stripping must not.
    const hitClean = await getTakeoutFallbackMedia('chat_doc', { assetId: '', sourceUri: 'financial_quarterly_report.pdf' }, 'u0');
    assert.strictEqual(hitClean, null, 'stripped prefixes are not source identity');
    assert.deepStrictEqual(await getTakeoutFallbackMedia('chat_doc', { assetId: '', sourceUri: 'f1a2b3c4_financial_quarterly_report.pdf' }, 'u0'), bytesReport);

    // Similar stems are insufficient.
    const hitDistinctive = await getTakeoutFallbackMedia('chat_doc', { assetId: '', sourceUri: 'financial_quarterly_report-a1b2c3d4.pdf' }, 'u0');
    assert.strictEqual(hitDistinctive, null, 'stripped suffixes are not source identity');

    // A single unrelated media item is still not evidence.
    const hitGenericSingle = await getTakeoutFallbackMedia('chat_single', { assetId: '', sourceUri: 'image.png' }, 'u0');
    assert.strictEqual(hitGenericSingle, null, 'one unrelated file does not establish source identity');

    // Generic name in multi-media conversation must NOT match arbitrarily
    commitTakeoutData('u0', {
        mediaMap: {
            'chat_multi': [
                { filename: 'photo_a.jpg', fileObj: { async: async () => bytesReport } },
                { filename: 'photo_b.jpg', fileObj: { async: async () => bytesSingle } }
            ]
        },
        globalMedia: {},
        convCache: {}
    });
    const missMultiGeneric = await getTakeoutFallbackMedia('chat_multi', { assetId: '', sourceUri: 'image.png' }, 'u0');
    assert.strictEqual(missMultiGeneric, null, 'generic name with multiple media must not match');

    // Generic names must NOT trigger unsafe global stem fallback
    const missGlobalGeneric = await getTakeoutFallbackMedia('nonexistent_chat', { assetId: '', sourceUri: 'image.png' }, 'u0');
    assert.strictEqual(missGlobalGeneric, null, 'generic name must never match global generic media');

    clearTakeoutData();
});

// ==========================================
// 4. Safe Byte-Reader Boundaries
// ==========================================
test('mediaIndex - readTakeoutBytes boundaries and validation', async () => {
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
    assert.strictEqual(await readTakeoutBytes(null), null);
    assert.strictEqual(await readTakeoutBytes(undefined), null);

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
test('mediaIndex - extractC2PATimestamp accepted inputs and edge cases', () => {
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

test('mediaIndex - unknown multi-image ordinals never recover another image by request identity', async () => {
    const slot = 'unknown-multi-ordinal';
    const base = { chatId: 'abc', providerRequestId: 'abcd1234abcd1234', generationOrdinal: 0, imageCount: 2 };
    try {
        for (const storedOrdinal of [undefined, 0]) {
            commitTakeoutData(slot, { mediaMap: { abc: [{ filename: 'offline.png', generation: { ...base, imageOrdinal: storedOrdinal },
                fileObj: { async: async () => new Uint8Array([1, 2, 3]) } }] }, globalMedia: {}, convCache: {} });
            assert.equal(await getTakeoutFallbackMedia('abc', { assetId: '', sourceUri: 'online.jpg', generation: base }, slot), null);
        }
        commitTakeoutData(slot, { mediaMap: { abc: [{ filename: 'offline.png', generation: base,
            fileObj: { async: async () => new Uint8Array([1, 2, 3]) } }] }, globalMedia: {}, convCache: {} });
        assert.equal(await getTakeoutFallbackMedia('abc', { assetId: '', sourceUri: 'online.jpg', generation: { ...base, imageOrdinal: 0 } }, slot), null);
    } finally { clearTakeoutData(slot); }
});
