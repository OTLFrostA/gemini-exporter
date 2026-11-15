import { OperationError, operationIssue } from '../../shared/errors/operationError.js';
import { bytesToHex, deriveBlindRecordId, toOwnedBytes, type VaultKeyring } from '../../shared/crypto/index.js';
import { calculateBackoff } from '../../shared/utils/retryUtils.js';
import { mapWithConcurrency } from '../../shared/utils/concurrency.js';
import { DEFAULT_ACCOUNT_KEY } from '../../l2/accountRegistry.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import { encodePortableCloudConversation, type PortableCloudConversation } from '../../l2/cloudPayload.js';
import { subscribeCommittedKeys } from '../../l2/ingestion.js';
import { readConversation } from '../../l2/readConversation.js';
import { getAccount, listAccounts, getDetail, getIndex, listIndexes } from '../../l3a/storageService.js';
import {
    clearCloudSyncSession,
    countCloudOutbox,
    countOversizedCloudRecords,
    enqueueCloudOutboxKeys,
    getCloudSyncSession,
    getStoredLocalVaultHandle,
    getSyncedCloudRecord,
    getSyncedCloudRecordByBlindId,
    listDueCloudOutbox,
    putCloudSyncSession,
    putSyncedCloudRecord,
    recordCloudOutboxFailure,
    removeCloudOutboxKey,
    setStoredLocalVaultHandle,
    type CloudSyncSessionState,
    type CloudVaultBackendType,
} from '../../l3a/cloudSyncStore.js';
import type { DirectoryHandle } from '../../shared/types/directoryHandle.js';
import {
    exportVaultRecoveryKey,
    importVaultRecoveryKey,
    loadOrProvisionVaultKeyring,
} from '../../l3a/cloudKeyringStore.js';
import {
    createCloudVaultClient,
    normalizeCloudServerUrl,
    type CloudVaultClient,
} from '../../l1/cloud/vaultClient.js';
import {
    LOCAL_VAULT_OWNER_SUBJECT,
    LOCAL_VAULT_SERVER_URL,
    createLocalFolderVaultClient,
} from '../../l1/cloud/localFolderVaultClient.js';
import { getSettings, updateSettings } from '../settings/index.js';
import {
    openCloudConversation,
    portableVaultSubject,
    restoreCloudConversationsToLocal,
    sealCloudConversation,
} from './cloudArchiveCodec.js';
import type { PortableConversationSource } from '../../l2/cloudPayload.js';

async function sha256Utf8Hex(text: string): Promise<string> {
    const bytes = toOwnedBytes(new TextEncoder().encode(text));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return bytesToHex(digest);
}

async function sha256BytesHex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return bytesToHex(digest);
}

export type { CloudVaultBackendType } from '../../shared/types/cloudSync.js';

export interface CloudSyncStatusSnapshot {
    readonly enabled: boolean;
    readonly includeDetail: boolean;
    readonly connected: boolean;
    readonly backend?: CloudVaultBackendType;
    readonly serverUrl?: string;
    readonly ownerSubject?: string;
    readonly email?: string;
    readonly folderName?: string;
    readonly folderPermissionRequired?: boolean;
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
        recoveryKey: string;
        createdNewKey: boolean;
    }>;
    connectWithGoogleIdToken(serverUrl: string, idToken: string): Promise<{
        session: CloudSyncSessionState;
        recoveryKey: string;
        createdNewKey: boolean;
    }>;
    disconnect(options?: { revokeRemoteTokens?: boolean }): Promise<void>;
    setAutoSyncEnabled(enabled: boolean): Promise<void>;
    setIncludeDetail(includeDetail: boolean): Promise<void>;
    enqueueAllExistingHistory(): Promise<number>;
    flushOutbox(signal?: AbortSignal): Promise<CloudFlushResult>;
    pullChanges(signal?: AbortSignal): Promise<CloudPullResult>;
    syncNow(signal?: AbortSignal): Promise<{ pull: CloudPullResult; push: CloudFlushResult }>;
    getStatusSnapshot(): Promise<CloudSyncStatusSnapshot>;
    exportRecoveryKey(): Promise<string | null>;
    importRecoveryKey(recoveryKeyInput: string): Promise<{ keyFingerprint: string }>;
    reconcilePostToggleAccount(accountId: string): Promise<void>;
    installAutoEnqueueListener(): () => void;
    waitForIdle(): Promise<void>;
}

export function createCloudSyncEngine(deps: {
    readonly client?: CloudVaultClient;
    readonly localFolderClient?: CloudVaultClient;
    readonly now?: () => number;
} = {}): CloudSyncEngine {
    const remoteClient = deps.client ?? createCloudVaultClient();
    const now = deps.now ?? Date.now;
    let inMemoryVaultHandle: DirectoryHandle | null = null;
    const resolveLocalHandle = async (): Promise<DirectoryHandle> => {
        if (inMemoryVaultHandle) return inMemoryVaultHandle;
        const stored = await getStoredLocalVaultHandle();
        if (!stored) {
            throw new OperationError('DIRECTORY_PERMISSION_REQUIRED', 'No local encrypted vault folder configured');
        }
        inMemoryVaultHandle = stored;
        return stored;
    };
    const localClient = deps.localFolderClient ?? createLocalFolderVaultClient(resolveLocalHandle, now);
    const clientForSession = (session: CloudSyncSessionState): CloudVaultClient =>
        session.backend === 'local-folder' ? localClient : remoteClient;
    let activeFlush: Promise<CloudFlushResult> | null = null;
    let activePull: Promise<CloudPullResult> | null = null;
    const backgroundTasks = new Set<Promise<void>>();
    let suppressAutoEnqueueDepth = 0;

    const trackBackground = (task: Promise<void>): void => {
        backgroundTasks.add(task);
        void task.finally(() => { backgroundTasks.delete(task); });
    };

    const waitForIdle = async (): Promise<void> => {
        while (backgroundTasks.size > 0 || activeFlush !== null || activePull !== null) {
            const pending: Promise<unknown>[] = [...backgroundTasks];
            if (activeFlush) pending.push(activeFlush.catch(() => {}));
            if (activePull) pending.push(activePull.catch(() => {}));
            if (pending.length === 0) break;
            await Promise.allSettled(pending);
        }
    };

    const requireActiveSession = async (): Promise<CloudSyncSessionState> => {
        const session = await getCloudSyncSession();
        if (!session) {
            throw new OperationError('CLOUD_AUTH_REQUIRED', 'Sign in with Google to use Cloud Sync');
        }
        if (session.expiresAt <= now()) {
            throw new OperationError('CLOUD_AUTH_REQUIRED', 'Cloud Sync session has expired; please sign in again');
        }
        return session;
    };

    const resolveKeyring = async (ownerSubject: string): Promise<VaultKeyring> => {
        const loaded = await loadOrProvisionVaultKeyring(ownerSubject);
        return loaded.keyring;
    };

    const readLocalSyncSource = async (
        key: ConversationKey,
        includeDetail: boolean,
    ): Promise<PortableConversationSource | null> => {
        if (includeDetail) {
            const full = await readConversation(key);
            if (full) return full;
        }
        const index = await getIndex(key);
        if (!index) return null;
        return { index };
    };

    const openWithPortableFallback = async (
        keyring: VaultKeyring,
        session: CloudSyncSessionState,
        blindRecordId: string,
        revision: number,
        envelope: Uint8Array,
    ): Promise<PortableCloudConversation> => {
        try {
            return await openCloudConversation({
                keyring,
                ownerSubject: portableVaultSubject(keyring),
                blindRecordId,
                revision,
                envelope,
            });
        } catch (primaryError) {
            if (primaryError instanceof OperationError && primaryError.code === 'CLOUD_DECRYPT_AUTH_FAILED') {
                return openCloudConversation({
                    keyring,
                    ownerSubject: session.ownerSubject,
                    blindRecordId,
                    revision,
                    envelope,
                });
            }
            throw primaryError;
        }
    };

    const pushSingleConversation = async (
        session: CloudSyncSessionState,
        keyring: VaultKeyring,
        includeDetail: boolean,
        key: ConversationKey,
        attemptNumber: number,
        signal?: AbortSignal,
    ): Promise<'uploaded' | 'skipped' | 'oversized' | 'retry'> => {
        const [account, initialSource] = await Promise.all([
            getAccount(key.accountId),
            readLocalSyncSource(key, includeDetail),
        ]);
        if (!account || account.providerAccountId === DEFAULT_ACCOUNT_KEY || !initialSource) {
            await removeCloudOutboxKey(key);
            return 'skipped';
        }

        let currentSource: PortableConversationSource = initialSource;
        const aadSubject = portableVaultSubject(keyring);
        for (let conflictAttempt = 0; conflictAttempt < 3; conflictAttempt++) {
            signal?.throwIfAborted();
            const portableJson = encodePortableCloudConversation(account, currentSource);
            const payloadSha256 = await sha256Utf8Hex(portableJson);
            const synced = await getSyncedCloudRecord(session.ownerSubject, key);
            if (synced && synced.payloadSha256 === payloadSha256 && synced.oversizedBytes === undefined) {
                await removeCloudOutboxKey(key);
                return 'skipped';
            }

            const expectedRevision = synced?.remoteRevision ?? 0;
            const nextRevision = expectedRevision + 1;
            let sealed: { blindRecordId: string; envelope: Uint8Array<ArrayBuffer> };
            try {
                sealed = await sealCloudConversation({
                    keyring,
                    ownerSubject: aadSubject,
                    revision: nextRevision,
                    account,
                    conversation: currentSource,
                });
            } catch (error) {
                if (error instanceof OperationError && error.code === 'CLOUD_RECORD_TOO_LARGE') {
                    const blindId = await deriveBlindRecordId(
                        keyring,
                        account.providerId,
                        account.providerAccountId,
                        key.conversationId,
                    );
                    await putSyncedCloudRecord({
                        ownerSubject: session.ownerSubject,
                        accountId: key.accountId,
                        conversationId: key.conversationId,
                        blindRecordId: blindId,
                        remoteRevision: expectedRevision,
                        payloadSha256,
                        syncedAt: now(),
                        oversizedBytes: portableJson.length,
                    }, true);
                    return 'oversized';
                }
                throw error;
            }

            const envelopeSha256 = await sha256BytesHex(sealed.envelope);
            const activeClient = clientForSession(session);
            try {
                const putOutcome = await activeClient.putEncryptedRecord({
                    serverUrl: session.serverUrl,
                    sessionToken: session.sessionToken,
                    blindRecordId: sealed.blindRecordId,
                    expectedRevision,
                    envelope: sealed.envelope,
                    sha256: envelopeSha256,
                    signal,
                });

                if (putOutcome.status === 'committed') {
                    await putSyncedCloudRecord({
                        ownerSubject: session.ownerSubject,
                        accountId: key.accountId,
                        conversationId: key.conversationId,
                        blindRecordId: sealed.blindRecordId,
                        remoteRevision: putOutcome.meta.revision,
                        payloadSha256,
                        syncedAt: now(),
                    }, true);
                    return 'uploaded';
                }

                // 409 Optimistic Conflict Auto-Heal: pull remote revision, L2-merge locally, and retry!
                const remote = await activeClient.getEncryptedRecord({
                    serverUrl: session.serverUrl,
                    sessionToken: session.sessionToken,
                    blindRecordId: sealed.blindRecordId,
                    signal,
                });
                if (!remote) {
                    throw new OperationError('CLOUD_SERVER_ERROR', 'Conflicting remote record disappeared during reconciliation');
                }
                const remotePortable = await openWithPortableFallback(
                    keyring,
                    session,
                    sealed.blindRecordId,
                    remote.revision,
                    remote.envelope,
                );
                suppressAutoEnqueueDepth++;
                try {
                    await restoreCloudConversationsToLocal([remotePortable]);
                } finally {
                    suppressAutoEnqueueDepth--;
                }
                const remoteJson = encodePortableCloudConversation(account, {
                    index: { ...remotePortable.index, key },
                    ...(remotePortable.detail !== undefined ? { detail: { ...remotePortable.detail, key } } : {}),
                });
                const remoteSha256 = await sha256Utf8Hex(remoteJson);
                await putSyncedCloudRecord({
                    ownerSubject: session.ownerSubject,
                    accountId: key.accountId,
                    conversationId: key.conversationId,
                    blindRecordId: sealed.blindRecordId,
                    remoteRevision: remote.revision,
                    payloadSha256: remoteSha256,
                    syncedAt: now(),
                }, false);

                const mergedLocal = await readLocalSyncSource(key, includeDetail);
                if (!mergedLocal) {
                    await removeCloudOutboxKey(key);
                    return 'skipped';
                }
                currentSource = mergedLocal;
            } catch (error) {
                if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
                // Auth, folder permission, or quota errors bubble up to halt the batch cleanly while keeping items queued
                if (error instanceof OperationError
                    && (error.code === 'CLOUD_AUTH_REQUIRED'
                        || error.code === 'CLOUD_QUOTA_EXCEEDED'
                        || error.code === 'DIRECTORY_PERMISSION_REQUIRED')) {
                    throw error;
                }
                const issue = operationIssue(error, 'CLOUD_SERVER_ERROR');
                const delayMs = calculateBackoff(attemptNumber, {
                    initialDelayMs: 2_000,
                    maxDelayMs: 5 * 60_000,
                    jitterMs: 500,
                    retryAfterMs: issue.retryAt ? Math.max(0, issue.retryAt - now()) : undefined,
                });
                await recordCloudOutboxFailure(key, now() + delayMs, issue.code, issue.message, now());
                return 'retry';
            }
        }

        await recordCloudOutboxFailure(key, now() + 10_000, 'REVISION_CONFLICT', 'Repeated concurrent revision conflict', now());
        return 'retry';
    };

    const flushOutbox = (signal?: AbortSignal): Promise<CloudFlushResult> => {
        if (activeFlush) return activeFlush;
        activeFlush = (async (): Promise<CloudFlushResult> => {
            try {
                const settings = await getSettings();
                if (!settings.cloudSyncEnabled) {
                    return { uploaded: 0, skippedUnchanged: 0, oversizedSkipped: 0, retriedLater: 0 };
                }
                const includeDetail = settings.cloudSyncIncludeDetail === true;
                const session = await requireActiveSession();
                const keyring = await resolveKeyring(session.ownerSubject);
                let uploaded = 0;
                let skippedUnchanged = 0;
                let oversizedSkipped = 0;
                let retriedLater = 0;

                for (;;) {
                    signal?.throwIfAborted();
                    const due = await listDueCloudOutbox(now(), 25);
                    if (due.length === 0) break;

                    for (const entry of due) {
                        signal?.throwIfAborted();
                        const key = { accountId: entry.accountId, conversationId: entry.conversationId };
                        const status = await pushSingleConversation(session, keyring, includeDetail, key, entry.attempts, signal);
                        if (status === 'uploaded') uploaded++;
                        else if (status === 'skipped') skippedUnchanged++;
                        else if (status === 'oversized') oversizedSkipped++;
                        else retriedLater++;
                    }
                    // Avoid tight loop if remaining items were rescheduled into the future
                    if (retriedLater > 0) break;
                }
                return { uploaded, skippedUnchanged, oversizedSkipped, retriedLater };
            } finally {
                activeFlush = null;
            }
        })();
        return activeFlush;
    };

    const pullChanges = (signal?: AbortSignal): Promise<CloudPullResult> => {
        if (activePull) return activePull;
        activePull = (async (): Promise<CloudPullResult> => {
            try {
                let session = await requireActiveSession();
                const keyring = await resolveKeyring(session.ownerSubject);
                let downloaded = 0;
                let accepted = 0;
                let changed = 0;
                let hasAnyLocalConversation = false;
                for (const acc of await listAccounts()) {
                    if (acc.providerAccountId === DEFAULT_ACCOUNT_KEY) continue;
                    if ((await listIndexes(acc.id)).length > 0) {
                        hasAnyLocalConversation = true;
                        break;
                    }
                }
                let cursor = hasAnyLocalConversation ? session.pulledSeq : 0;

                const activeClient = clientForSession(session);
                for (let page = 0; page < 200; page++) {
                    signal?.throwIfAborted();
                    const feed = await activeClient.listChanges({
                        serverUrl: session.serverUrl,
                        sessionToken: session.sessionToken,
                        sinceSeq: cursor,
                        limit: 50,
                        signal,
                    });
                    if (feed.items.length === 0) break;

                    const toDownload = [];
                    for (const meta of feed.items) {
                        const existing = await getSyncedCloudRecordByBlindId(session.ownerSubject, meta.blindRecordId);
                        if (existing && existing.remoteRevision >= meta.revision) {
                            const localIndex = await getIndex({
                                accountId: existing.accountId,
                                conversationId: existing.conversationId,
                            });
                            if (localIndex) continue;
                        }
                        toDownload.push(meta);
                    }

                    const openedBatch = await mapWithConcurrency(toDownload, 4, async (meta): Promise<{
                        meta: typeof meta;
                        portable: PortableCloudConversation;
                        payloadSha256: string;
                    } | null> => {
                        const blob = await activeClient.getEncryptedRecord({
                            serverUrl: session.serverUrl,
                            sessionToken: session.sessionToken,
                            blindRecordId: meta.blindRecordId,
                            signal,
                        });
                        if (!blob) return null;
                        const portable = await openWithPortableFallback(
                            keyring,
                            session,
                            meta.blindRecordId,
                            blob.revision,
                            blob.envelope,
                        );
                        downloaded++;
                        // Compute canonical JSON hash so auto-enqueue recognizes this exact state as already synced
                        const tempAccountId = '00000000-0000-4000-8000-000000000000';
                        const tempKey = { accountId: tempAccountId, conversationId: portable.conversationId };
                        const canonicalJson = encodePortableCloudConversation(
                            { id: tempAccountId, ...portable.account },
                            {
                                index: { ...portable.index, key: tempKey },
                                ...(portable.detail !== undefined ? { detail: { ...portable.detail, key: tempKey } } : {}),
                            },
                        );
                        const payloadSha256 = await sha256Utf8Hex(canonicalJson);
                        return {
                            meta: { ...meta, revision: blob.revision },
                            portable,
                            payloadSha256,
                        };
                    }, signal);

                    const validOpened = openedBatch.filter((x): x is NonNullable<typeof x> => x !== null);
                    if (validOpened.length > 0) {
                        suppressAutoEnqueueDepth++;
                        let summary;
                        try {
                            summary = await restoreCloudConversationsToLocal(validOpened.map(x => x.portable));
                        } finally {
                            suppressAutoEnqueueDepth--;
                        }
                        accepted += summary.accepted;
                        changed += summary.changed;

                        const allAccounts = await listAccounts();
                        for (const item of validOpened) {
                            const localAcc = allAccounts.find(
                                a => a.providerId === item.portable.account.providerId
                                    && a.providerAccountId === item.portable.account.providerAccountId,
                            );
                            if (!localAcc) continue;
                            await putSyncedCloudRecord({
                                ownerSubject: session.ownerSubject,
                                accountId: localAcc.id,
                                conversationId: item.portable.conversationId,
                                blindRecordId: item.meta.blindRecordId,
                                remoteRevision: item.meta.revision,
                                payloadSha256: item.payloadSha256,
                                syncedAt: now(),
                            }, false);
                        }
                    }

                    cursor = feed.nextSince;
                    session = { ...session, pulledSeq: cursor };
                    await putCloudSyncSession(session);
                    if (!feed.hasMore) break;
                }

                return { downloaded, accepted, changed, pulledSeq: cursor };
            } finally {
                activePull = null;
            }
        })();
        return activePull;
    };

    const enqueueUnsyncedLocalConversations = async (): Promise<number> => {
        const [settings, session] = await Promise.all([
            getSettings(),
            getCloudSyncSession(),
        ]);
        if (!session || session.expiresAt <= now()) return 0;
        const includeDetail = settings.cloudSyncIncludeDetail === true;
        const accounts = await listAccounts();
        const unsynced: ConversationKey[] = [];
        for (const acc of accounts) {
            if (acc.providerAccountId === DEFAULT_ACCOUNT_KEY) continue;
            const indexes = await listIndexes(acc.id);
            for (const idx of indexes) {
                const synced = await getSyncedCloudRecord(session.ownerSubject, idx.key);
                if (synced?.oversizedBytes !== undefined) continue;
                const detail = includeDetail ? await getDetail(idx.key) : null;
                const source: PortableConversationSource = detail ? { index: idx, detail } : { index: idx };
                const json = encodePortableCloudConversation(acc, source);
                const sha = await sha256Utf8Hex(json);
                if (synced && synced.payloadSha256 === sha) continue;
                unsynced.push(idx.key);
            }
        }
        if (unsynced.length > 0) {
            await enqueueCloudOutboxKeys(unsynced, now());
        }
        return unsynced.length;
    };

    const syncNow = async (signal?: AbortSignal): Promise<{ pull: CloudPullResult; push: CloudFlushResult }> => {
        const pull = await pullChanges(signal);
        const settings = await getSettings();
        if (settings.cloudSyncEnabled) {
            await enqueueUnsyncedLocalConversations();
        }
        const push = await flushOutbox(signal);
        return { pull, push };
    };

    return {
        async connectLocalFolderVault(handle) {
            const perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                throw new OperationError('DIRECTORY_PERMISSION_REQUIRED', 'Local vault directory requires readwrite permission');
            }
            inMemoryVaultHandle = handle;
            await setStoredLocalVaultHandle(handle);
            const existingSession = await getCloudSyncSession();
            const pulledSeq = existingSession?.backend === 'local-folder'
                && existingSession.folderName === handle.name
                ? existingSession.pulledSeq
                : 0;
            const provisioned = await loadOrProvisionVaultKeyring(LOCAL_VAULT_OWNER_SUBJECT);
            const session: CloudSyncSessionState = {
                id: 'active',
                backend: 'local-folder',
                serverUrl: LOCAL_VAULT_SERVER_URL,
                ownerSubject: LOCAL_VAULT_OWNER_SUBJECT,
                sessionToken: 'local-folder-session',
                expiresAt: Number.MAX_SAFE_INTEGER,
                folderName: handle.name,
                pulledSeq,
                enabledSinceAt: existingSession?.enabledSinceAt ?? now(),
            };
            await putCloudSyncSession(session);
            return {
                session,
                recoveryKey: provisioned.recoveryKey,
                createdNewKey: provisioned.createdNew,
            };
        },

        async connectWithGoogleIdToken(serverUrl, idToken) {
            const normalizedUrl = normalizeCloudServerUrl(serverUrl);
            const auth = await remoteClient.authenticateGoogle(normalizedUrl, idToken);
            const existingSession = await getCloudSyncSession();
            const pulledSeq = existingSession?.ownerSubject === auth.ownerSubject
                && existingSession.serverUrl === normalizedUrl
                ? existingSession.pulledSeq
                : 0;
            const provisioned = await loadOrProvisionVaultKeyring(auth.ownerSubject);
            const session: CloudSyncSessionState = {
                id: 'active',
                backend: 'cloud-server',
                serverUrl: normalizedUrl,
                ownerSubject: auth.ownerSubject,
                sessionToken: auth.sessionToken,
                expiresAt: auth.expiresAt,
                pulledSeq,
                enabledSinceAt: existingSession?.enabledSinceAt ?? now(),
                ...(auth.email ? { email: auth.email } : {}),
            };
            await putCloudSyncSession(session);
            await updateSettings({ cloudSyncServerUrl: normalizedUrl });
            return {
                session,
                recoveryKey: provisioned.recoveryKey,
                createdNewKey: provisioned.createdNew,
            };
        },

        async disconnect(options = {}) {
            const session = await getCloudSyncSession();
            if (session && session.backend !== 'local-folder' && options.revokeRemoteTokens) {
                await remoteClient.logoutAll(session.serverUrl, session.sessionToken).catch(() => {});
            }
            if (session?.backend === 'local-folder') {
                inMemoryVaultHandle = null;
                await setStoredLocalVaultHandle(null);
            }
            await updateSettings({ cloudSyncEnabled: false });
            await clearCloudSyncSession(true);
        },

        async setAutoSyncEnabled(enabled) {
            const session = await getCloudSyncSession();
            if (enabled && (!session || session.expiresAt <= now())) {
                throw new OperationError('CLOUD_AUTH_REQUIRED', 'Sign in with Google before enabling automatic Cloud Sync');
            }
            if (enabled && session && session.enabledSinceAt === undefined) {
                await putCloudSyncSession({ ...session, enabledSinceAt: now() });
            }
            await updateSettings({ cloudSyncEnabled: enabled });
            if (enabled) {
                trackBackground(syncNow().then(() => undefined).catch(err => {
                    console.warn('[CloudSync] Automatic bidirectional sync failed:', err);
                }));
            }
        },

        async setIncludeDetail(includeDetail) {
            await updateSettings({ cloudSyncIncludeDetail: includeDetail });
            if (includeDetail) {
                const settings = await getSettings();
                if (settings.cloudSyncEnabled) {
                    trackBackground(
                        enqueueUnsyncedLocalConversations()
                            .then(() => flushOutbox())
                            .then(() => undefined)
                            .catch(err => console.warn('[CloudSync] Detail upgrade sync failed:', err)),
                    );
                }
            }
        },

        enqueueAllExistingHistory: enqueueUnsyncedLocalConversations,

        flushOutbox,
        pullChanges,
        syncNow,

        async getStatusSnapshot() {
            const [settings, session, outboxCounts] = await Promise.all([
                getSettings(),
                getCloudSyncSession(),
                countCloudOutbox(),
            ]);
            const connected = Boolean(session && session.expiresAt > now());
            let folderPermissionRequired = false;
            if (connected && session?.backend === 'local-folder') {
                const storedHandle = inMemoryVaultHandle ?? await getStoredLocalVaultHandle();
                if (!storedHandle) {
                    folderPermissionRequired = true;
                } else {
                    inMemoryVaultHandle = storedHandle;
                    try {
                        folderPermissionRequired = (await storedHandle.queryPermission({ mode: 'readwrite' })) !== 'granted';
                    } catch {
                        folderPermissionRequired = true;
                    }
                }
            }
            const [oversizedSkipped, recoveryKey] = session
                ? await Promise.all([
                    countOversizedCloudRecords(session.ownerSubject),
                    exportVaultRecoveryKey(session.ownerSubject),
                ])
                : [0, null];
            return {
                enabled: settings.cloudSyncEnabled === true,
                includeDetail: settings.cloudSyncIncludeDetail === true,
                connected,
                ...(session?.backend ? { backend: session.backend } : {}),
                ...(session?.serverUrl ?? settings.cloudSyncServerUrl
                    ? { serverUrl: session?.serverUrl ?? settings.cloudSyncServerUrl }
                    : {}),
                ...(session?.ownerSubject ? { ownerSubject: session.ownerSubject } : {}),
                ...(session?.email ? { email: session.email } : {}),
                ...(session?.folderName ? { folderName: session.folderName } : {}),
                ...(folderPermissionRequired ? { folderPermissionRequired: true } : {}),
                pulledSeq: session?.pulledSeq ?? 0,
                pendingOutbox: outboxCounts.total,
                failedOutbox: outboxCounts.failed,
                oversizedSkipped,
                hasRecoveryKey: recoveryKey !== null,
            };
        },

        async exportRecoveryKey() {
            const session = await getCloudSyncSession();
            if (!session) return null;
            return exportVaultRecoveryKey(session.ownerSubject);
        },

        async importRecoveryKey(recoveryKeyInput) {
            const session = await requireActiveSession();
            const imported = await importVaultRecoveryKey(session.ownerSubject, recoveryKeyInput);
            await putCloudSyncSession({ ...session, pulledSeq: 0 });
            return { keyFingerprint: imported.keyring.keyFingerprint };
        },

        async reconcilePostToggleAccount(accountId) {
            if (suppressAutoEnqueueDepth > 0 || !accountId) return;
            const [settings, session, acc] = await Promise.all([
                getSettings(),
                getCloudSyncSession(),
                getAccount(accountId),
            ]);
            if (!settings.cloudSyncEnabled || !session || session.expiresAt <= now()) return;
            if (!acc || acc.providerAccountId === DEFAULT_ACCOUNT_KEY) return;
            const includeDetail = settings.cloudSyncIncludeDetail === true;
            const cutoff = session.enabledSinceAt ?? 0;
            const indexes = await listIndexes(accountId);
            const candidates: ConversationKey[] = [];
            for (const idx of indexes) {
                const synced = await getSyncedCloudRecord(session.ownerSubject, idx.key);
                const activity = idx.updatedAt ?? idx.activityAt ?? idx.createdAt ?? 0;
                if (!synced && activity > 0 && activity < cutoff) continue;
                const detail = includeDetail ? await getDetail(idx.key) : null;
                const source: PortableConversationSource = detail ? { index: idx, detail } : { index: idx };
                const json = encodePortableCloudConversation(acc, source);
                const sha = await sha256Utf8Hex(json);
                if (synced && synced.payloadSha256 === sha) continue;
                candidates.push(idx.key);
            }
            if (candidates.length > 0) {
                await enqueueCloudOutboxKeys(candidates, now());
            }
            await flushOutbox();
        },

        installAutoEnqueueListener() {
            return subscribeCommittedKeys(keys => {
                if (suppressAutoEnqueueDepth > 0 || keys.length === 0) return;
                const task = (async () => {
                    const [settings, session] = await Promise.all([
                        getSettings(),
                        getCloudSyncSession(),
                    ]);
                    if (!settings.cloudSyncEnabled || !session || session.expiresAt <= now()) return;
                    const eligible: ConversationKey[] = [];
                    for (const key of keys) {
                        const [acc, index] = await Promise.all([
                            getAccount(key.accountId),
                            getIndex(key),
                        ]);
                        if (acc && acc.providerAccountId !== DEFAULT_ACCOUNT_KEY && index) {
                            eligible.push(key);
                        }
                    }
                    if (eligible.length === 0) return;
                    await enqueueCloudOutboxKeys(eligible, now());
                    await flushOutbox();
                })().catch(error => {
                    console.warn('[CloudSync] Auto-enqueue or background flush failed:', error);
                });
                trackBackground(task);
            });
        },

        waitForIdle,
    };
}

export const defaultCloudSyncEngine = createCloudSyncEngine();
