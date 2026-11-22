import { OperationError } from '../../shared/errors/operationError.js';
import { deriveServerAuthToken, type VaultKeyring } from '../../shared/crypto/index.js';
import type { CloudAuthKeyMode, CloudVaultStatusResponse } from '../../shared/types/cloudSync.js';
import type { DirectoryHandle } from '../../shared/types/directoryHandle.js';
import {
    activateVaultKeyring,
    clearCloudSyncSession,
    clearSyncedCloudRecordsForOwner,
    countCloudOutbox,
    countOversizedCloudRecords,
    getCloudSyncSession,
    getInitializedVaultKeyMetadata,
    getInitializedVaultKeyring,
    getStoredLocalVaultHandle,
    putCloudSyncSession,
    putLocalVaultConnection,
    setStoredLocalVaultHandle,
    type CloudSyncSessionState,
} from '../../l3a/vaultStorageService.js';
import {
    createCloudVaultClient,
    normalizeCloudServerUrl,
    type CloudVaultClient,
    type VaultRecordClient,
} from '../../l1/cloud/vaultClient.js';
import {
    LOCAL_VAULT_OWNER_SUBJECT,
    LOCAL_VAULT_SERVER_URL,
    createLocalFolderVaultClient,
} from '../../l1/cloud/localFolderVaultClient.js';
import { getSettings, updateSettings } from '../settings/index.js';
import { portableVaultSubject } from './cloudArchiveCodec.js';
import { withVaultOperation, type CloudSyncStatusSnapshot } from './vaultShared.js';

export function createVaultConnection(deps: {
    readonly client?: CloudVaultClient;
    readonly localFolderClient?: VaultRecordClient;
    readonly now: () => number;
}) {
    const remoteClient = deps.client ?? createCloudVaultClient();
    const { now } = deps;
    const resolveLocalHandle = async (): Promise<DirectoryHandle> => {
        const stored = await getStoredLocalVaultHandle();
        if (!stored) {
            throw new OperationError('DIRECTORY_PERMISSION_REQUIRED', 'No local encrypted vault folder configured');
        }
        return stored;
    };
    const localClient = deps.localFolderClient ?? createLocalFolderVaultClient(resolveLocalHandle, now);
    const clientForSession = (session: CloudSyncSessionState): VaultRecordClient =>
        session.backend === 'local-folder' ? localClient : remoteClient;

    const requireCompatibleKey = <T extends Pick<VaultKeyring, 'keyFingerprint'>>(
        session: CloudSyncSessionState,
        initialized: T | null,
    ): T => {
        if (!initialized) {
            throw new OperationError('CLOUD_KEY_NOT_INITIALIZED', 'Initialize your Master Key first');
        }
        if (session.backend === 'cloud-server' && session.ownerSubject !== portableVaultSubject(initialized)) {
            throw new OperationError('CLOUD_KEY_MISMATCH', 'The active key does not match the connected cloud vault');
        }
        return initialized;
    };

    const resolveKeyring = async (session: CloudSyncSessionState): Promise<VaultKeyring> =>
        requireCompatibleKey(session, await getInitializedVaultKeyring());

    const authenticateVaultKey = async (
        serverUrl: string,
        keyring: Pick<VaultKeyring, 'keyFingerprint' | 'authKey'>,
        mode: CloudAuthKeyMode,
        accessCode?: string,
    ) => {
        const auth = await remoteClient.authenticateKey({
            serverUrl,
            keyFingerprint: keyring.keyFingerprint,
            mode,
            authToken: await deriveServerAuthToken(keyring),
            ...(accessCode ? { accessCode } : {}),
        });
        if (auth.ownerSubject !== portableVaultSubject(keyring)) {
            throw new OperationError('CLOUD_SERVER_ERROR', 'Cloud Vault returned a different vault identity');
        }
        return auth;
    };

    const requireActiveSession = async (): Promise<CloudSyncSessionState> => {
        const session = await getCloudSyncSession();
        if (!session) {
            throw new OperationError('CLOUD_AUTH_REQUIRED', 'Connect to Encrypted Vault before syncing');
        }
        if (session.expiresAt <= now()) {
            if (session.backend === 'cloud-server') {
                const keyring = await resolveKeyring(session);
                const renewed = await authenticateVaultKey(session.serverUrl, keyring, 'unlock', session.accessCode);
                const refreshed: CloudSyncSessionState = {
                    ...session,
                    sessionToken: renewed.sessionToken,
                    expiresAt: renewed.expiresAt,
                };
                await putCloudSyncSession(refreshed);
                return refreshed;
            }
            throw new OperationError('CLOUD_AUTH_REQUIRED', 'Cloud Sync session has expired; please reconnect');
        }
        return session;
    };

    const markSessionKeyMismatch = async (
        session: CloudSyncSessionState,
        mismatch: boolean,
    ): Promise<CloudSyncSessionState> => {
        if (Boolean(session.keyMismatch) === mismatch) return session;
        const { keyMismatch: _prev, ...rest } = session;
        const updated: CloudSyncSessionState = mismatch ? { ...rest, keyMismatch: true } : rest;
        await putCloudSyncSession(updated);
        return updated;
    };

    const verifyVaultKeyCompatibility = async (
        session: CloudSyncSessionState,
        keyring: VaultKeyring,
        signal?: AbortSignal,
    ): Promise<{ session: CloudSyncSessionState; status: CloudVaultStatusResponse }> => {
        const activeClient = clientForSession(session);
        const status = await activeClient.getVaultStatus(session.serverUrl, session.sessionToken, signal);
        if ((session.backend === 'cloud-server' || status.recordCount > 0) && status.keyFingerprint !== keyring.keyFingerprint) {
            await markSessionKeyMismatch(session, true);
            throw new OperationError(
                'CLOUD_KEY_MISMATCH',
                'This vault is encrypted with a different Master Key. Import the original Recovery Key to unlock it.',
            );
        }
        return { session: await markSessionKeyMismatch(session, false), status };
    };

    return {
        remoteClient,
        clientForSession,
        requireCompatibleKey,
        resolveKeyring,
        authenticateVaultKey,
        requireActiveSession,
        markSessionKeyMismatch,
        verifyVaultKeyCompatibility,

        connectLocalFolderVault: (handle: DirectoryHandle) => withVaultOperation(async () => {
            const perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                throw new OperationError('DIRECTORY_PERMISSION_REQUIRED', 'Local vault directory requires readwrite permission');
            }
            const initialized = await getInitializedVaultKeyMetadata();
            if (!initialized) {
                throw new OperationError('CLOUD_KEY_NOT_INITIALIZED', 'Initialize your Master Key before connecting a Vault folder');
            }
            const existingSession = await getCloudSyncSession();
            const existingHandle = existingSession?.backend === 'local-folder'
                ? await getStoredLocalVaultHandle() : null;
            const sameFolder = existingHandle !== null && await handle.isSameEntry(existingHandle).catch(() => false);
            const session: CloudSyncSessionState = {
                id: 'active',
                backend: 'local-folder',
                serverUrl: LOCAL_VAULT_SERVER_URL,
                ownerSubject: LOCAL_VAULT_OWNER_SUBJECT,
                sessionToken: 'local-folder-session',
                expiresAt: Number.MAX_SAFE_INTEGER,
                folderName: handle.name,
                pulledSeq: sameFolder ? existingSession?.pulledSeq ?? 0 : 0,
                enabledSinceAt: existingSession?.enabledSinceAt ?? now(),
            };
            await putLocalVaultConnection(session, handle, !sameFolder);
            return { session, keyFingerprint: initialized.keyFingerprint };
        }),

        connectCloudVault: (serverUrl: string, accessCode?: string, explicitMode?: CloudAuthKeyMode) =>
            withVaultOperation(async () => {
                const normalizedUrl = normalizeCloudServerUrl(serverUrl);
                const trimmedCode = accessCode?.trim() || undefined;
                const existingSession = await getCloudSyncSession();
                const initialized = await getInitializedVaultKeyring();
                if (!initialized) {
                    throw new OperationError('CLOUD_KEY_NOT_INITIALIZED', 'Initialize your Master Key before connecting to Cloud Vault');
                }
                const mode: CloudAuthKeyMode = explicitMode ?? (initialized.origin === 'generated' ? 'create' : 'unlock');
                const auth = await authenticateVaultKey(normalizedUrl, initialized, mode, trimmedCode);
                if (initialized.origin === 'generated') {
                    await activateVaultKeyring(initialized, 'imported');
                }
                const pulledSeq = existingSession?.ownerSubject === auth.ownerSubject
                    && existingSession.serverUrl === normalizedUrl
                    ? existingSession.pulledSeq : 0;
                const session: CloudSyncSessionState = {
                    id: 'active',
                    backend: 'cloud-server',
                    serverUrl: normalizedUrl,
                    ownerSubject: auth.ownerSubject,
                    sessionToken: auth.sessionToken,
                    expiresAt: auth.expiresAt,
                    pulledSeq,
                    enabledSinceAt: existingSession?.enabledSinceAt ?? now(),
                    ...(trimmedCode ? { accessCode: trimmedCode } : {}),
                };
                await putCloudSyncSession(session);
                await updateSettings({ cloudSyncServerUrl: normalizedUrl });
                return { session, keyFingerprint: initialized.keyFingerprint };
            }),

        disconnect: () => withVaultOperation(async () => {
            const session = await getCloudSyncSession();
            if (session?.backend === 'local-folder') {
                await setStoredLocalVaultHandle(null);
            }
            await updateSettings({ cloudSyncEnabled: false });
            await clearCloudSyncSession(true);
        }),

        async getStatusSnapshot(): Promise<CloudSyncStatusSnapshot> {
            const [settings, session, outboxCounts] = await Promise.all([
                getSettings(),
                getCloudSyncSession(),
                countCloudOutbox(),
            ]);
            const connected = session !== null;
            let folderPermissionRequired = false;
            if (connected && session?.backend === 'local-folder') {
                const storedHandle = await getStoredLocalVaultHandle();
                if (!storedHandle) {
                    folderPermissionRequired = true;
                } else {
                    try {
                        folderPermissionRequired = (await storedHandle.queryPermission({ mode: 'readwrite' })) !== 'granted';
                    } catch {
                        folderPermissionRequired = true;
                    }
                }
            }
            const [oversizedSkipped, initializedKey] = await Promise.all([
                session ? countOversizedCloudRecords(session.ownerSubject) : Promise.resolve(0),
                getInitializedVaultKeyMetadata(),
            ]);
            return {
                enabled: settings.cloudSyncEnabled === true,
                includeDetail: settings.cloudSyncIncludeDetail === true,
                connected,
                ...(session?.backend ? { backend: session.backend } : {}),
                ...(session?.serverUrl ?? settings.cloudSyncServerUrl
                    ? { serverUrl: session?.serverUrl ?? settings.cloudSyncServerUrl }
                    : {}),
                ...(session?.ownerSubject ? { ownerSubject: session.ownerSubject } : {}),
                ...(session?.folderName ? { folderName: session.folderName } : {}),
                ...(folderPermissionRequired ? { folderPermissionRequired: true } : {}),
                ...(session?.keyMismatch ? { keyMismatch: true } : {}),
                ...(initializedKey ? {
                    keyFingerprint: initializedKey.keyFingerprint,
                    keyOrigin: initializedKey.origin,
                } : {}),
                pulledSeq: session?.pulledSeq ?? 0,
                pendingOutbox: outboxCounts.total,
                failedOutbox: outboxCounts.failed,
                oversizedSkipped,
                hasRecoveryKey: initializedKey !== null,
            };
        },

        resetVaultWithCurrentKey: () => withVaultOperation(async () => {
            const session = await requireActiveSession();
            requireCompatibleKey(session, await getInitializedVaultKeyMetadata());
            const activeClient = clientForSession(session);
            await activeClient.purgeVault(session.serverUrl, session.sessionToken);
            await clearSyncedCloudRecordsForOwner(session.ownerSubject);
            const { keyMismatch: _cleared, ...cleanSession } = session;
            await putCloudSyncSession({ ...cleanSession, pulledSeq: 0 });
        }),
    };
}

export type VaultConnection = ReturnType<typeof createVaultConnection>;
