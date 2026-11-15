import { OperationError, operationIssue } from '../../shared/errors/operationError.js';
import { bytesToHex, deriveBlindRecordId, toOwnedBytes, type VaultKeyring } from '../../shared/crypto/index.js';
import { calculateBackoff } from '../../shared/utils/retryUtils.js';
import { mapWithConcurrency } from '../../shared/utils/concurrency.js';
import { DEFAULT_ACCOUNT_KEY } from '../../l2/accountRegistry.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import { encodePortableCloudConversation, type PortableCloudConversation } from '../../l2/cloudPayload.js';
import { subscribeCommittedKeys } from '../../l2/ingestion.js';
import { readConversation } from '../../l2/readConversation.js';
import { getAccount, listAccounts, getDetail, listIndexes } from '../../l3a/storageService.js';
import {
    clearCloudSyncSession,
    countCloudOutbox,
    countOversizedCloudRecords,
    enqueueCloudOutboxKeys,
    getCloudSyncSession,
    getSyncedCloudRecord,
    getSyncedCloudRecordByBlindId,
    listDueCloudOutbox,
    putCloudSyncSession,
    putSyncedCloudRecord,
    recordCloudOutboxFailure,
    removeCloudOutboxKey,
    type CloudSyncSessionState,
} from '../../l3a/cloudSyncStore.js';
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
import { getSettings, updateSettings } from '../settings/index.js';
import {
    openCloudConversation,
    restoreCloudConversationsToLocal,
    sealCloudConversation,
} from './cloudArchiveCodec.js';

async function sha256Utf8Hex(text: string): Promise<string> {
    const bytes = toOwnedBytes(new TextEncoder().encode(text));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return bytesToHex(digest);
}

async function sha256BytesHex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return bytesToHex(digest);
}

export interface CloudSyncStatusSnapshot {
    readonly enabled: boolean;
    readonly connected: boolean;
    readonly serverUrl?: string;
    readonly ownerSubject?: string;
    readonly email?: string;
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
    connectWithGoogleIdToken(serverUrl: string, idToken: string): Promise<{
        session: CloudSyncSessionState;
        recoveryKey: string;
        createdNewKey: boolean;
    }>;
    disconnect(options?: { revokeRemoteTokens?: boolean }): Promise<void>;
    setAutoSyncEnabled(enabled: boolean): Promise<void>;
    enqueueAllExistingHistory(): Promise<number>;
    flushOutbox(signal?: AbortSignal): Promise<CloudFlushResult>;
    pullChanges(signal?: AbortSignal): Promise<CloudPullResult>;
    syncNow(signal?: AbortSignal): Promise<{ pull: CloudPullResult; push: CloudFlushResult }>;
    getStatusSnapshot(): Promise<CloudSyncStatusSnapshot>;
    exportRecoveryKey(): Promise<string | null>;
    importRecoveryKey(recoveryKeyInput: string): Promise<{ keyFingerprint: string }>;
    installAutoEnqueueListener(): () => void;
    waitForIdle(): Promise<void>;
}

export function createCloudSyncEngine(deps: {
    readonly client?: CloudVaultClient;
    readonly now?: () => number;
} = {}): CloudSyncEngine {
    const client = deps.client ?? createCloudVaultClient();
    const now = deps.now ?? Date.now;
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

    const pushSingleConversation = async (
        session: CloudSyncSessionState,
        keyring: VaultKeyring,
        key: ConversationKey,
        attemptNumber: number,
        signal?: AbortSignal,
    ): Promise<'uploaded' | 'skipped' | 'oversized' | 'retry'> => {
        const [account, conversation] = await Promise.all([
            getAccount(key.accountId),
            readConversation(key),
        ]);
        if (!account || account.providerAccountId === DEFAULT_ACCOUNT_KEY || !conversation) {
            await removeCloudOutboxKey(key);
            return 'skipped';
        }

        let currentConversation = conversation;
        for (let conflictAttempt = 0; conflictAttempt < 3; conflictAttempt++) {
            signal?.throwIfAborted();
            const portableJson = encodePortableCloudConversation(account, currentConversation);
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
                    ownerSubject: session.ownerSubject,
                    revision: nextRevision,
                    account,
                    conversation: currentConversation,
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
            try {
                const putOutcome = await client.putEncryptedRecord({
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
                const remote = await client.getEncryptedRecord({
                    serverUrl: session.serverUrl,
                    sessionToken: session.sessionToken,
                    blindRecordId: sealed.blindRecordId,
                    signal,
                });
                if (!remote) {
                    throw new OperationError('CLOUD_SERVER_ERROR', 'Conflicting remote record disappeared during reconciliation');
                }
                const remotePortable = await openCloudConversation({
                    keyring,
                    ownerSubject: session.ownerSubject,
                    blindRecordId: sealed.blindRecordId,
                    revision: remote.revision,
                    envelope: remote.envelope,
                });
                suppressAutoEnqueueDepth++;
                try {
                    await restoreCloudConversationsToLocal([remotePortable]);
                } finally {
                    suppressAutoEnqueueDepth--;
                }
                const remoteJson = encodePortableCloudConversation(account, {
                    index: { ...remotePortable.index, key },
                    detail: { ...remotePortable.detail, key },
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

                const mergedLocal = await readConversation(key);
                if (!mergedLocal) {
                    await removeCloudOutboxKey(key);
                    return 'skipped';
                }
                currentConversation = mergedLocal;
            } catch (error) {
                if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
                // Auth or quota errors bubble up to halt the batch cleanly; transient server/network errors retry with backoff.
                if (error instanceof OperationError
                    && (error.code === 'CLOUD_AUTH_REQUIRED' || error.code === 'CLOUD_QUOTA_EXCEEDED')) {
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
                        const status = await pushSingleConversation(session, keyring, key, entry.attempts, signal);
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
                let cursor = session.pulledSeq;

                for (let page = 0; page < 200; page++) {
                    signal?.throwIfAborted();
                    const feed = await client.listChanges({
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
                        if (existing && existing.remoteRevision >= meta.revision) continue;
                        toDownload.push(meta);
                    }

                    const openedBatch = await mapWithConcurrency(toDownload, 4, async (meta): Promise<{
                        meta: typeof meta;
                        portable: PortableCloudConversation;
                        payloadSha256: string;
                    } | null> => {
                        const blob = await client.getEncryptedRecord({
                            serverUrl: session.serverUrl,
                            sessionToken: session.sessionToken,
                            blindRecordId: meta.blindRecordId,
                            signal,
                        });
                        if (!blob) return null;
                        const portable = await openCloudConversation({
                            keyring,
                            ownerSubject: session.ownerSubject,
                            blindRecordId: meta.blindRecordId,
                            revision: blob.revision,
                            envelope: blob.envelope,
                        });
                        downloaded++;
                        // Compute canonical JSON hash so auto-enqueue recognizes this exact state as already synced
                        const tempAccountId = '00000000-0000-4000-8000-000000000000';
                        const tempKey = { accountId: tempAccountId, conversationId: portable.conversationId };
                        const canonicalJson = encodePortableCloudConversation(
                            { id: tempAccountId, ...portable.account },
                            {
                                index: { ...portable.index, key: tempKey },
                                detail: { ...portable.detail, key: tempKey },
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

    return {
        async connectWithGoogleIdToken(serverUrl, idToken) {
            const normalizedUrl = normalizeCloudServerUrl(serverUrl);
            const auth = await client.authenticateGoogle(normalizedUrl, idToken);
            const existingSession = await getCloudSyncSession();
            const pulledSeq = existingSession?.ownerSubject === auth.ownerSubject
                && existingSession.serverUrl === normalizedUrl
                ? existingSession.pulledSeq
                : 0;
            const provisioned = await loadOrProvisionVaultKeyring(auth.ownerSubject);
            const session: CloudSyncSessionState = {
                id: 'active',
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
            if (session && options.revokeRemoteTokens) {
                await client.logoutAll(session.serverUrl, session.sessionToken).catch(() => {});
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
                trackBackground(flushOutbox().then(() => undefined).catch(err => {
                    console.warn('[CloudSync] Initial outbox flush failed:', err);
                }));
            }
        },

        async enqueueAllExistingHistory() {
            const accounts = await listAccounts();
            const keys: ConversationKey[] = [];
            for (const acc of accounts) {
                if (acc.providerAccountId === DEFAULT_ACCOUNT_KEY) continue;
                const indexes = await listIndexes(acc.id);
                for (const idx of indexes) {
                    const detail = await getDetail(idx.key);
                    if (detail) keys.push(idx.key);
                }
            }
            await enqueueCloudOutboxKeys(keys, now());
            return keys.length;
        },

        flushOutbox,
        pullChanges,

        async syncNow(signal) {
            const pull = await pullChanges(signal);
            const push = await flushOutbox(signal);
            return { pull, push };
        },

        async getStatusSnapshot() {
            const [settings, session, outboxCounts] = await Promise.all([
                getSettings(),
                getCloudSyncSession(),
                countCloudOutbox(),
            ]);
            const connected = Boolean(session && session.expiresAt > now());
            const [oversizedSkipped, recoveryKey] = session
                ? await Promise.all([
                    countOversizedCloudRecords(session.ownerSubject),
                    exportVaultRecoveryKey(session.ownerSubject),
                ])
                : [0, null];
            return {
                enabled: settings.cloudSyncEnabled === true,
                connected,
                ...(session?.serverUrl ?? settings.cloudSyncServerUrl
                    ? { serverUrl: session?.serverUrl ?? settings.cloudSyncServerUrl }
                    : {}),
                ...(session?.ownerSubject ? { ownerSubject: session.ownerSubject } : {}),
                ...(session?.email ? { email: session.email } : {}),
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
            return { keyFingerprint: imported.keyring.keyFingerprint };
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
                        const [acc, detail] = await Promise.all([
                            getAccount(key.accountId),
                            getDetail(key),
                        ]);
                        if (acc && acc.providerAccountId !== DEFAULT_ACCOUNT_KEY && detail) {
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
