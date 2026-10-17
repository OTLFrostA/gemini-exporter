import { listFixture } from './helpers/listFixture.js';
import { indexFixture } from './helpers/indexFixture.js';
export {};

/**
 * tests/audit_reinforcement.test.ts
 *
 * Verification suite for architectural audit reinforcements:
 * 1. Two-Tier Storage atomic abort: IDB batch failure throws and blocks chrome.storage.local write.
 * 2. Takeout mediaIndex strict slot isolation: no global singleton clobber across account slots.
 * 3. Pagination getAllConversations token loop detection: circular nextPageToken triggers early safe termination.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Index storage rejects content before touching physical storage.
test('storageService rejects fat metadata without changing stored indexes', async () => {
    const { indexStorage } = require('./helpers/indexStorage.js');
    const env = indexStorage();
    try {
        const storage = require('../src/core/storage/storageService.js');
        await assert.rejects(storage.setConversations('10000000-0000-4000-8000-000000000001', [{ ...indexFixture({ id: 'chat', title: 'Research' }), messages: [] }]), /index schema/);
        assert.equal(env.writes(), 0);
    } finally { env.restore(); }
});

// 2. Takeout MediaIndex Strict Slot Isolation Verification
test('mediaIndex: strict slot isolation prevents cross-account data corruption', () => {
    const MediaIndex = require('../src/core/resources/takeout/mediaIndex.js');
    try {

    // Commit takeout data for Slot u0
    MediaIndex.commitTakeoutData('10000000-0000-4000-8000-000000000001', {
        mediaMap: { chat_u0: [{ filename: 'image_u0.png' }] },
        globalMedia: { 'image_u0.png': {} },
        convCache: { chat_u0: { title: 'Slot 0 Chat' } }
    });

    // Commit takeout data for Slot u1
    MediaIndex.commitTakeoutData('10000000-0000-4000-8000-000000000002', {
        mediaMap: { chat_u1: [{ filename: 'image_u1.png' }] },
        globalMedia: { 'image_u1.png': {} },
        convCache: { chat_u1: { title: 'Slot 1 Chat' } }
    });

    // Verify Slot u0 has only Slot u0 data
    const storeU0 = MediaIndex.getStore('10000000-0000-4000-8000-000000000001');
    assert.ok(storeU0.mediaMap['chat_u0'], 'Slot u0 must have chat_u0');
    assert.strictEqual(storeU0.mediaMap['chat_u1'], undefined, 'Slot u0 must NOT contain chat_u1');
    assert.strictEqual(MediaIndex.getTakeoutOfflineChat('chat_u0', '10000000-0000-4000-8000-000000000001')?.title, 'Slot 0 Chat');
    assert.strictEqual(MediaIndex.getTakeoutOfflineChat('chat_u1', '10000000-0000-4000-8000-000000000001'), null);

    // Verify Slot u1 has only Slot u1 data
    const storeU1 = MediaIndex.getStore('10000000-0000-4000-8000-000000000002');
    assert.ok(storeU1.mediaMap['chat_u1'], 'Slot u1 must have chat_u1');
    assert.strictEqual(storeU1.mediaMap['chat_u0'], undefined, 'Slot u1 must NOT contain chat_u0');
    assert.strictEqual(MediaIndex.getTakeoutOfflineChat('chat_u1', '10000000-0000-4000-8000-000000000002')?.title, 'Slot 1 Chat');
    assert.strictEqual(MediaIndex.getTakeoutOfflineChat('chat_u0', '10000000-0000-4000-8000-000000000002'), null);

    // Verify clearing Slot u1 does NOT affect Slot u0
    MediaIndex.clearTakeoutData('10000000-0000-4000-8000-000000000002');
    assert.strictEqual(MediaIndex.getTakeoutOfflineChat('chat_u1', '10000000-0000-4000-8000-000000000002'), null);
    assert.strictEqual(MediaIndex.getTakeoutOfflineChat('chat_u0', '10000000-0000-4000-8000-000000000001')?.title, 'Slot 0 Chat');

    } finally {
        MediaIndex.clearTakeoutData('10000000-0000-4000-8000-000000000002');
        MediaIndex.clearTakeoutData('10000000-0000-4000-8000-000000000001');
    }
});

// 3. Pagination Token Loop Guard Verification
test('pagination: getAllConversations detects token loop and terminates safely', async () => {
    const Pagination = require('../src/core/api/client/pagination.js');

    // Create a mock client that returns a repeating nextPageToken
    let callCount = 0;
    const mockClient = {
        getConversationList: async (token: string | null) => {
            callCount++;
            return listFixture(([
                    { id: `c_${callCount}`, title: `Chat ${callCount}` }
                ]).map(indexFixture), 'repeating_token_xyz');
        }
    };

    const result = await Pagination.getAllConversations(mockClient, 2000);

    // The first call gets 'repeating_token_xyz'.
    // The second call passes 'repeating_token_xyz' and receives 'repeating_token_xyz' again,
    // which hits seenTokens.has('repeating_token_xyz') and breaks!
    assert.strictEqual(callCount, 2, 'Should terminate immediately upon repeating token (call count = 2)');
    assert.strictEqual(result.conversations.length, 2);
    assert.ok(result.diagnostics.stopReason.includes('Token Loop'), 'stopReason must mention Token Loop');
    assert.strictEqual(result.stoppedEarly, true, 'Token loop must set stoppedEarly to true');
    assert.strictEqual(result.exhaustive, false, 'Token loop must set exhaustive to false');
});
