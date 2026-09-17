export {};
const test = require('node:test');
const assert = require('node:assert');

// PR-6 hygiene sweep regressions (core-vocab audit, low-priority batch).
//
// 1. bestTimestamp must never keep a legacy garbage string verbatim: the raw
//    `.timestamp` fallbacks are now routed through toTimestampMs, mirroring
//    the cUpdated/oldUpdated normalization directly above. (Old code kept
//    e.g. 'not-a-date' as the authoritative timestamp.)
// 2. lastActiveAt is a typed Conversation field (no more `as any`); merge
//    keeps it max-monotonic so a stale reordered touch cannot un-bump a chat.
// 3. The two previously scattered storage keys live in STORAGE_KEYS.

const { mergeConversation } = require('../src/core/utils/mergeUtils.js');
const { STORAGE_KEYS } = require('../src/core/utils/constants.js');

function conv(over: any = {}) {
    return { id: 'c_hygiene_4242', title: 'hygiene probe', titles: {}, ...over };
}

test('STORAGE_KEYS covers the two previously scattered keys', () => {
    assert.strictEqual(STORAGE_KEYS.LANG, 'gemini_exporter_lang');
    assert.strictEqual(STORAGE_KEYS.PENDING_TAKEOUT_PROMPT, 'gemini_pending_takeout_prompt');
});

test('bestTimestamp drops a garbage string instead of keeping it verbatim', () => {
    const res = mergeConversation(
        conv({ timestamp: 'not-a-date', updatedAt: null }),
        conv({ timestamp: null, updatedAt: null }),
        {}
    );
    assert.strictEqual(res.merged.timestamp, null);
});

test('bestTimestamp keeps a numeric string as a real number', () => {
    const res = mergeConversation(
        conv({ timestamp: '1726358400000', updatedAt: null }),
        conv({ timestamp: null, updatedAt: null }),
        {}
    );
    assert.strictEqual(res.merged.timestamp, 1726358400000);
    assert.strictEqual(typeof res.merged.timestamp, 'number');
});

test('bestTimestamp prefers the newest real value across old and incoming', () => {
    const res = mergeConversation(
        conv({ timestamp: 1000, updatedAt: null }),
        conv({ timestamp: 9000, updatedAt: null }),
        {}
    );
    assert.strictEqual(res.merged.timestamp, 9000);
});

test('lastActiveAt is max-monotonic: a stale touch must not un-bump', () => {
    const res = mergeConversation(
        conv({ lastActiveAt: 5000 }),
        conv({ lastActiveAt: 3000 }),
        {}
    );
    assert.strictEqual(res.merged.lastActiveAt, 5000);
});

test('lastActiveAt advances when the incoming touch is newer', () => {
    const res = mergeConversation(
        conv({ lastActiveAt: 3000 }),
        conv({ lastActiveAt: 7000 }),
        {}
    );
    assert.strictEqual(res.merged.lastActiveAt, 7000);
});
