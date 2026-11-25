/** Passive persistence for the separate vault IndexedDB. */
export {
    clearCloudSyncSession,
    commitCloudVaultReset,
    clearSyncedCloudRecordsForOwner,
    countCloudOutbox,
    countOversizedCloudRecords,
    enqueueCloudOutboxKeys,
    getCloudSyncSession,
    getStoredLocalVaultHandle,
    getSyncedCloudRecord,
    getSyncedCloudRecordByBlindId,
    listDueCloudOutbox,
    putCloudSyncSession,
    putLocalVaultConnection,
    putSyncedCloudRecord,
    recordCloudOutboxFailure,
    removeCloudOutboxEntry,
    setStoredLocalVaultHandle,
    type CloudOutboxEntry,
    type CloudSyncSessionState,
    type CloudSyncedRecordState,
} from './cloudSyncStore.js';
export {
    activateVaultKeyring,
    getInitializedVaultKeyMetadata,
    getInitializedVaultKeyring,
    type VaultKeyProvisionOrigin,
} from './cloudKeyringStore.js';
