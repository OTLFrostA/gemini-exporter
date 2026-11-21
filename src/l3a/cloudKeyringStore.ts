import type { VaultKeyring } from '../shared/crypto/index.js';
import {
    activateStoredKeyring,
    getStoredNonExtractableKeyring,
    getStoredVaultKeyMetadata,
    type CloudSyncSessionState,
    type StoredNonExtractableKeyring,
    type VaultKeyProvisionOrigin,
    type VaultKeyMetadata,
} from './cloudSyncStore.js';

export type { StoredNonExtractableKeyring, VaultKeyProvisionOrigin } from './cloudSyncStore.js';

const PRIMARY_KEYRING_SLOT = 'primary:vault';

export function getInitializedVaultKeyMetadata(): Promise<VaultKeyMetadata | null> {
    return getStoredVaultKeyMetadata(PRIMARY_KEYRING_SLOT);
}

export function getInitializedVaultKeyring(): Promise<StoredNonExtractableKeyring | null> {
    return getStoredNonExtractableKeyring(PRIMARY_KEYRING_SLOT);
}

export function activateVaultKeyring(
    keyring: VaultKeyring,
    origin: VaultKeyProvisionOrigin,
    session?: CloudSyncSessionState,
    previousOwnerSubject?: string,
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
    );
}
