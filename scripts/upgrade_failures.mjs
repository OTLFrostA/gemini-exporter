import assert from 'node:assert/strict';

/** Only explicit product failure evidence may enter the expected offline branch. */
export class NativeExportFailure extends Error {
  constructor(failedChats) {
    super('Native export failure: ' + JSON.stringify(failedChats));
    this.failedChats = failedChats;
  }
}

// Concrete errors from the body recovery / disconnected fetch paths. Do not
// accept arbitrary messages containing "offline", "missing", or "fetch".
const offlineReasons = new Set([
  'Failed to fetch',
  'fetch failed: Failed to fetch',
  'net::ERR_INTERNET_DISCONNECTED',
]);

export function assertOfflineFailures(failedChats, expectedIds) {
  assert.ok(Array.isArray(failedChats), 'Missing native failedChats evidence');
  assert.ok(expectedIds.length > 0 && new Set(expectedIds).size === expectedIds.length, 'Invalid offline targets');
  assert.equal(failedChats.length, expectedIds.length, 'Unexpected/missing offline failures');
  const actualIds = failedChats.map(row => row?.id);
  assert.deepEqual([...actualIds].sort(), [...expectedIds].sort(), 'Offline failure conversation IDs mismatch');
  for (const row of failedChats) {
    assert.ok(offlineReasons.has(row.error), `Unexpected offline failure reason for ${row.id}: ${row.error}`);
  }
}

export function assertExpectedOfflineFailure(error, expectedIds) {
  if (!(error instanceof NativeExportFailure)) throw error;
  assertOfflineFailures(error.failedChats, expectedIds);
}
