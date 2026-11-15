import {
    deriveVaultKeyring,
    formatRecoveryKey,
    generateMasterKeyBytes,
    parseRecoveryKey,
    type VaultKeyring,
} from '../shared/crypto/index.js';
import { OperationError } from '../shared/errors/operationError.js';
import { getLocalKeyMirror, putLocalKeyMirror } from './cloudSyncStore.js';

const SYNC_KEY_PREFIX = 'ge_cloud_key_v1:';
const PORTABLE_LOCAL_KEY_SLOT = 'ge_cloud_key_v1:local:vault';

function syncStorageKey(ownerSubject: string): string {
    if (!ownerSubject.trim()) {
        throw new OperationError('CLOUD_KEY_INVALID', 'Keyring custody requires a non-empty ownerSubject');
    }
    return `${SYNC_KEY_PREFIX}${ownerSubject.trim()}`;
}

async function readChromeSyncKey(storageKey: string): Promise<string | null> {
    if (typeof chrome === 'undefined' || !chrome.storage?.sync) return null;
    try {
        const data = await chrome.storage.sync.get<Record<string, unknown>>(storageKey);
        const raw = data[storageKey];
        return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    } catch {
        return null;
    }
}

async function writeChromeSyncKey(storageKey: string, recoveryKey: string): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.sync) return;
    try {
        await chrome.storage.sync.set({ [storageKey]: recoveryKey });
    } catch {
        // Best-effort sync write: local IDB mirror still keeps this device operational offline.
    }
}

async function tryParseValidKey(candidate: string | null): Promise<{ canonical: string; keyring: VaultKeyring } | null> {
    if (!candidate) return null;
    try {
        const bytes = await parseRecoveryKey(candidate);
        try {
            const canonical = await formatRecoveryKey(bytes);
            const keyring = await deriveVaultKeyring(bytes);
            return { canonical, keyring };
        } finally {
            bytes.fill(0);
        }
    } catch {
        return null;
    }
}

/**
 * Resolve or provision the user's zero-knowledge Vault Master Key.
 * Priority:
 *  1. `chrome.storage.sync` (automatically synced across Chrome devices signed into Google — $0, zero OAuth review)
 *  2. Local IndexedDB mirror (`gemini_exporter_cloud_v1.localKeys`) for offline / Chromium browsers without Chrome Sync
 *  3. Generate a fresh 256-bit random Master Key and persist to both `chrome.storage.sync` and local mirror.
 */
export async function loadOrProvisionVaultKeyring(ownerSubject: string): Promise<{
    readonly keyring: VaultKeyring;
    readonly recoveryKey: string;
    readonly createdNew: boolean;
}> {
    const keyName = syncStorageKey(ownerSubject);

    const fromSync = await tryParseValidKey(await readChromeSyncKey(keyName));
    if (fromSync) {
        await putLocalKeyMirror(ownerSubject, fromSync.canonical);
        return { keyring: fromSync.keyring, recoveryKey: fromSync.canonical, createdNew: false };
    }

    const fromLocal = await tryParseValidKey(await getLocalKeyMirror(ownerSubject));
    if (fromLocal) {
        await writeChromeSyncKey(keyName, fromLocal.canonical);
        return { keyring: fromLocal.keyring, recoveryKey: fromLocal.canonical, createdNew: false };
    }

    // Seamless Local-to-Cloud promotion: if the user already initialized a Local Encrypted Folder key on this browser
    // and is connecting a cloud account for the very first time, inherit the same Master Key so existing .gee1 files stay 100% compatible!
    if (ownerSubject !== 'local:vault') {
        const promoted = await tryParseValidKey(
            await readChromeSyncKey(PORTABLE_LOCAL_KEY_SLOT) ?? await getLocalKeyMirror('local:vault'),
        );
        if (promoted) {
            await putLocalKeyMirror(ownerSubject, promoted.canonical);
            await writeChromeSyncKey(keyName, promoted.canonical);
            return { keyring: promoted.keyring, recoveryKey: promoted.canonical, createdNew: false };
        }
    }

    const freshBytes = generateMasterKeyBytes();
    try {
        const canonical = await formatRecoveryKey(freshBytes);
        const keyring = await deriveVaultKeyring(freshBytes);
        await putLocalKeyMirror(ownerSubject, canonical);
        await writeChromeSyncKey(keyName, canonical);
        return { keyring, recoveryKey: canonical, createdNew: true };
    } finally {
        freshBytes.fill(0);
    }
}

/**
 * Explicitly import a user-supplied `GEK1-...` recovery key (e.g., on Edge/Brave or after Chrome Sync reset),
 * overwriting local and `chrome.storage.sync` custody slots only after checksum verification succeeds.
 */
export async function importVaultRecoveryKey(
    ownerSubject: string,
    recoveryKeyInput: string,
): Promise<{ keyring: VaultKeyring; recoveryKey: string }> {
    const keyName = syncStorageKey(ownerSubject);
    const bytes = await parseRecoveryKey(recoveryKeyInput);
    try {
        const canonical = await formatRecoveryKey(bytes);
        const keyring = await deriveVaultKeyring(bytes);
        await putLocalKeyMirror(ownerSubject, canonical);
        await writeChromeSyncKey(keyName, canonical);
        return { keyring, recoveryKey: canonical };
    } finally {
        bytes.fill(0);
    }
}

/** Read the canonical `GEK1-...` recovery key currently protecting `ownerSubject`, if initialized. */
export async function exportVaultRecoveryKey(ownerSubject: string): Promise<string | null> {
    const keyName = syncStorageKey(ownerSubject);
    const fromSync = await tryParseValidKey(await readChromeSyncKey(keyName));
    if (fromSync) return fromSync.canonical;
    const fromLocal = await tryParseValidKey(await getLocalKeyMirror(ownerSubject));
    return fromLocal?.canonical ?? null;
}
