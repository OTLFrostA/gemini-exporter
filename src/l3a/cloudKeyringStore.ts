import type { VaultKeyring } from '../shared/crypto/index.js';
import {
    activateStoredKeyring,
    getStoredNonExtractableKeyring,
    type CloudSyncSessionState,
    type CloudSyncedRecordState,
    type StoredNonExtractableKeyring,
    type VaultKeyProvisionOrigin,
} from './cloudSyncStore.js';

export type { StoredNonExtractableKeyring, VaultKeyProvisionOrigin } from './cloudSyncStore.js';

const PRIMARY_KEYRING_SLOT = 'primary:vault';

export function getInitializedVaultKeyring(): Promise<StoredNonExtractableKeyring | null> {
    return getStoredNonExtractableKeyring(PRIMARY_KEYRING_SLOT);
}

export function activateVaultKeyring(
    keyring: VaultKeyring,
    origin: VaultKeyProvisionOrigin,
    session?: CloudSyncSessionState,
    previousOwnerSubject?: string,
    verifiedBackup?: readonly CloudSyncedRecordState[],
): Promise<void> {
    return activateStoredKeyring(
        {
            ownerSubject: PRIMARY_KEYRING_SLOT,
            keyFingerprint: keyring.keyFingerprint,
            recordIdKey: keyring.recordIdKey,
            payloadKey: keyring.payloadKey,
            authKey: keyring.authKey,
            origin,
        },
        session,
        previousOwnerSubject,
        verifiedBackup,
    );
}
