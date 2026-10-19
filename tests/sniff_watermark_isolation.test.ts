/** Trusted passive pages can advance Coverage; uncorrelated facts cannot. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { accountRuntime, ACCOUNT_UUID, ACCOUNT_OBSERVATION } from './helpers/accountRuntime.js';
import { init, handleWindowMessage } from '../src/content/messageBridge.js';
import { listIndexes, getCoverage } from '../src/core/storage/storageService.js';
const wire = (seconds: number) => JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, null,
    [['c_abcdef123', 'A', null, null, null, [seconds, 0]]]])]]);
function capture(seconds: number, correlated: boolean): MessageEvent {
    return { origin: location.origin, source: window, data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
        text: wire(seconds), slot: 'u0', requestAccountObservation: ACCOUNT_OBSERVATION, requestedAt: Date.now(),
        truncated: false, url: 'https://gemini.google.com/_/BardChatUi/data/batchexecute',
        ...(correlated ? { listRequest: { streamId: 'recent', requestCursor: null } } : {}),
    } } } as unknown as MessageEvent;
}
test('repeated uncorrelated captures preserve authoritative timestamps without establishing Coverage', async () => {
    const storage = indexStorage(), runtime = accountRuntime();
    try {
        init();
        for (const seconds of [1700000000, 1699999999, 1700000000]) await handleWindowMessage(capture(seconds, false));
        const indexes = await listIndexes(ACCOUNT_UUID);
        assert.equal(indexes.length, 1); assert.equal(indexes[0].updatedAt, 1700000000000);
        assert.equal(await getCoverage(ACCOUNT_UUID, 'recent'), null);
        assert.equal(Object.hasOwn(indexes[0], 'cloudAvailability'), false);
        await handleWindowMessage(capture(1700000000, true));
        assert.deepEqual((await getCoverage(ACCOUNT_UUID, 'recent'))?.range, {
            head: { id: 'abcdef123', time: 1700000000000 }, tail: { id: 'abcdef123', time: 1700000000000 }
        });
    } finally { runtime.restore(); storage.restore(); }
});
