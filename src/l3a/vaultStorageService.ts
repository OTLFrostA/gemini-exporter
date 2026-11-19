/** Passive persistence for the separate vault IndexedDB. */
export {
    clearCloudSyncSession,
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
    type CloudVaultBackendType,
} from './cloudSyncStore.js';
export { activateVaultKeyring, getInitializedVaultKeyring, type VaultKeyProvisionOrigin } from './cloudKeyringStore.js';
