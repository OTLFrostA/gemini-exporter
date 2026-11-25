import { OperationError } from '../../shared/errors/operationError.js';
import { bytesToHex, toOwnedBytes, type VaultKeyring } from '../../shared/crypto/index.js';
import type {
    CloudAuthKeyMode,
    CloudChangesResponse,
    CloudVaultBackendType,
} from '../../shared/types/cloudSync.js';
import type { DirectoryHandle } from '../../shared/types/directoryHandle.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import type { PortableConversationSource } from '../../l2/cloudPayload.js';
import { readConversation } from '../../l2/readConversation.js';
import { getIndex } from '../../l3a/storageService.js';
import type {
    CloudSyncSessionState,
    CloudSyncedRecordState,
    VaultKeyProvisionOrigin,
} from '../../l3a/vaultStorageService.js';

export const CLOUD_CHANGE_PAGE_SIZE = 50;
export const CLOUD_SYNC_CROSS_CONTEXT_LOCK = 'gemini_exporter_cloud_sync_op_lock';

export type { CloudVaultBackendType } from '../../shared/types/cloudSync.js';

/** Runtime-only decrypted view of a connected Vault session (never persisted to IndexedDB). */
export interface ActiveCloudSession extends CloudSyncSessionState {
    readonly sessionToken: string;
    readonly accessCode?: string;
}

/** Strip in-memory credentials before writing a session record back to IndexedDB. */
export function toStoredCloudSession(session: CloudSyncSessionState | ActiveCloudSession): CloudSyncSessionState {
    const stored: CloudSyncSessionState = {
        id: session.id,
        backend: session.backend,
        serverUrl: session.serverUrl,
        ownerSubject: session.ownerSubject,
        expiresAt: session.expiresAt,
        pulledSeq: session.pulledSeq,
        ...(session.generation !== undefined ? { generation: session.generation } : {}),
        ...(session.folderName ? { folderName: session.folderName } : {}),
        ...(session.sealedCredentials ? { sealedCredentials: session.sealedCredentials } : {}),
        ...(session.keyMismatch ? { keyMismatch: true } : {}),
        ...(session.enabledSinceAt !== undefined ? { enabledSinceAt: session.enabledSinceAt } : {}),
    };
    return stored;
}

export interface CloudSyncStatusSnapshot {
    readonly enabled: boolean;
    readonly includeDetail: boolean;
    readonly connected: boolean;
    readonly backend?: CloudVaultBackendType;
    readonly serverUrl?: string;
    readonly ownerSubject?: string;
    readonly folderName?: string;
    readonly folderPermissionRequired?: boolean;
    readonly keyMismatch?: boolean;
    readonly keyFingerprint?: string;
    readonly keyOrigin?: VaultKeyProvisionOrigin;
    readonly pulledSeq: number;
    readonly pendingOutbox: number;
    readonly failedOutbox: number;
    readonly oversizedSkipped: number;
    readonly hasRecoveryKey: boolean;
}

export interface CloudFlushResult {
    readonly uploaded: number;
    readonly skippedUnchanged: number;
    readonly oversizedSkipped: number;
    readonly retriedLater: number;
}

export interface CloudPullResult {
    readonly downloaded: number;
    readonly accepted: number;
    readonly changed: number;
    readonly pulledSeq: number;
}

export interface CloudSyncEngine {
    connectLocalFolderVault(handle: DirectoryHandle): Promise<{
        session: CloudSyncSessionState;
        keyFingerprint: string;
    }>;
    connectCloudVault(
        serverUrl: string,
        accessCode?: string,
        explicitMode?: CloudAuthKeyMode,
    ): Promise<{
        session: CloudSyncSessionState;
        keyFingerprint: string;
    }>;
    disconnect(): Promise<void>;
    setAutoSyncEnabled(enabled: boolean): Promise<void>;
    setIncludeDetail(includeDetail: boolean): Promise<void>;
    enqueueAllExistingHistory(): Promise<number>;
    flushOutbox(signal?: AbortSignal): Promise<CloudFlushResult>;
    pullChanges(signal?: AbortSignal): Promise<CloudPullResult>;
    syncNow(signal?: AbortSignal): Promise<{ pull: CloudPullResult; push: CloudFlushResult }>;
    getStatusSnapshot(): Promise<CloudSyncStatusSnapshot>;
    resetVaultWithCurrentKey(): Promise<void>;
    reconcilePostToggleAccount(accountId: string): Promise<void>;
    installAutoEnqueueListener(): () => void;
    waitForIdle(): Promise<void>;
}

export type ActivateKeyring = (
    keyring: VaultKeyring,
    origin: VaultKeyProvisionOrigin,
    expectedFingerprint: string | null,
) => Promise<{
    readonly keyFingerprint: string;
    readonly resolution: 'initialized' | 'unlocked' | 'rekeyed';
    readonly cloudBackup?: { readonly saved: number; readonly restoredChanges: boolean };
}>;

export interface AutoEnqueueSuppression {
    isSuppressed(): boolean;
    withSuppressed<T>(work: () => Promise<T>): Promise<T>;
}

let localVaultOperations: Promise<unknown> = Promise.resolve();

export function withVaultOperation<T>(work: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
        return navigator.locks.request(CLOUD_SYNC_CROSS_CONTEXT_LOCK, work);
    }
    const result = localVaultOperations.then(work);
    localVaultOperations = result.catch(() => {});
    return result;
}

export async function sha256Utf8Hex(text: string): Promise<string> {
    const bytes = toOwnedBytes(new TextEncoder().encode(text));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return bytesToHex(digest);
}

export function matchesSyncedPayload(
    synced: CloudSyncedRecordState | null,
    hash: string,
    indexOnly: boolean,
): boolean {
    return synced !== null && (synced.payloadSha256 === hash || (indexOnly && synced.indexPayloadSha256 === hash));
}

export async function sha256BytesHex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return bytesToHex(digest);
}

export async function rotationRequest<T>(request: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await request();
        } catch (error) {
            if (!(error instanceof OperationError) || error.code !== 'CLOUD_RATE_LIMITED'
                || error.retryAt === undefined || attempt >= 2) throw error;
            const delay = error.retryAt - Date.now();
            if (delay > 60_000) throw error;
            await new Promise(resolve => setTimeout(resolve, Math.max(0, delay)));
        }
    }
}

export function unverifiedBackup(): OperationError {
    return new OperationError('CLOUD_ROTATION_VERIFY_FAILED', 'Could not verify a complete backup for Cloud Vault rotation');
}

export function isValidChangeFeedCursor(feed: CloudChangesResponse, cursor: number): boolean {
    return Number.isSafeInteger(feed.nextSince) && feed.nextSince >= cursor
        && (!feed.hasMore || (feed.nextSince > cursor && feed.items.length > 0));
}

export async function readLocalSyncSource(
    key: ConversationKey,
    includeDetail: boolean,
): Promise<PortableConversationSource | null> {
    if (includeDetail) {
        const full = await readConversation(key);
        if (full) return full;
    }
    const index = await getIndex(key);
    if (!index) return null;
    return { index };
}
