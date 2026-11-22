import { applicationHost } from '../host.js';
import { OperationError, operationIssue } from '../../shared/errors/operationError.js';
import { deriveBlindRecordId, type VaultKeyring } from '../../shared/crypto/index.js';
import { calculateBackoff } from '../../shared/utils/retryUtils.js';
import { DEFAULT_ACCOUNT_KEY } from '../../l2/accountRegistry.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import { encodePortableCloudConversation, type PortableConversationSource } from '../../l2/cloudPayload.js';
import { getAccount, getDetail, getIndex, listAccounts, listIndexes } from '../../l3a/storageService.js';
import {
    enqueueCloudOutboxKeys,
    getCloudSyncSession,
    getSyncedCloudRecord,
    listDueCloudOutbox,
    putSyncedCloudRecord,
    recordCloudOutboxFailure,
    removeCloudOutboxEntry,
    type CloudOutboxEntry,
    type CloudSyncSessionState,
} from '../../l3a/vaultStorageService.js';
import { getSettings } from '../settings/index.js';
import {
    openCloudConversation,
    restoreCloudConversationsToLocal,
    sealCloudConversation,
} from './cloudArchiveCodec.js';
import type { VaultConnection } from './vaultConnection.js';
import {
    CLOUD_SYNC_CROSS_CONTEXT_LOCK,
    matchesSyncedPayload,
    readLocalSyncSource,
    sha256BytesHex,
    sha256Utf8Hex,
    withVaultOperation,
    type AutoEnqueueSuppression,
    type CloudFlushResult,
} from './vaultShared.js';

export function createVaultPushSync(ctx: {
    readonly connection: VaultConnection;
    readonly suppression: AutoEnqueueSuppression;
    readonly now: () => number;
    readonly trackBackground: (task: Promise<void>) => void;
    readonly isSyncNowActive: () => boolean;
}) {
    const { connection, suppression, now, trackBackground, isSyncNowActive } = ctx;
    let activeFlush: Promise<CloudFlushResult> | null = null;

    const pushSingleConversation = async (
        session: CloudSyncSessionState,
        keyring: VaultKeyring,
        includeDetail: boolean,
        entry: CloudOutboxEntry,
        signal?: AbortSignal,
    ): Promise<'uploaded' | 'skipped' | 'oversized' | 'retry'> => {
        const key = { accountId: entry.accountId, conversationId: entry.conversationId };
        const [account, initialSource] = await Promise.all([
            getAccount(key.accountId),
            readLocalSyncSource(key, includeDetail),
        ]);
        if (!account || account.providerAccountId === DEFAULT_ACCOUNT_KEY || !initialSource) {
            await removeCloudOutboxEntry(entry);
            return 'skipped';
        }

        let currentSource: PortableConversationSource = initialSource;
        for (let conflictAttempt = 0; conflictAttempt < 3; conflictAttempt++) {
            signal?.throwIfAborted();
            const localPayloadSha256 = await sha256Utf8Hex(encodePortableCloudConversation(account, currentSource));
            const synced = await getSyncedCloudRecord(session.ownerSubject, key);
            const localFolder = session.backend === 'local-folder';
            if (synced?.oversizedBytes === undefined
                && matchesSyncedPayload(synced, localPayloadSha256, localFolder && !currentSource.detail)) {
                await removeCloudOutboxEntry(entry);
                return 'skipped';
            }

            const expectedRevision = synced?.remoteRevision ?? 0;
            const nextRevision = expectedRevision + 1;
            const activeClient = connection.clientForSession(session);
            try {
                let sourceForWrite = currentSource;
                let backupRevision = expectedRevision;
                if (localFolder && synced && expectedRevision > 0 && !currentSource.detail) {
                    const backedUp = await activeClient.getEncryptedRecord({
                        serverUrl: session.serverUrl,
                        sessionToken: session.sessionToken,
                        blindRecordId: synced.blindRecordId,
                        signal,
                    });
                    if (!backedUp) throw new OperationError('CLOUD_SERVER_ERROR', 'Acknowledged local vault record could not be read');
                    backupRevision = backedUp.revision;
                    const { detail } = await openCloudConversation({ keyring, blindRecordId: synced.blindRecordId, ...backedUp });
                    if (detail) sourceForWrite = { ...currentSource, detail: { ...detail, key } };
                }
                const portableJson = encodePortableCloudConversation(account, sourceForWrite);
                const payloadSha256 = sourceForWrite === currentSource ? localPayloadSha256 : await sha256Utf8Hex(portableJson);
                const indexPayloadSha256 = localFolder && sourceForWrite.detail
                    ? await sha256Utf8Hex(encodePortableCloudConversation(account, { index: sourceForWrite.index })) : undefined;
                if (synced && synced.oversizedBytes === undefined && backupRevision === expectedRevision
                    && matchesSyncedPayload(synced, payloadSha256, false)) {
                    await putSyncedCloudRecord({ ...synced, indexPayloadSha256 }, entry);
                    return 'skipped';
                }

                let sealed: Awaited<ReturnType<typeof sealCloudConversation>>;
                try {
                    sealed = await sealCloudConversation({
                        keyring, revision: nextRevision, account, conversation: sourceForWrite,
                    });
                } catch (error) {
                    if (!(error instanceof OperationError) || error.code !== 'CLOUD_RECORD_TOO_LARGE') throw error;
                    const blindId = await deriveBlindRecordId(
                        keyring, account.providerId, account.providerAccountId, key.conversationId,
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
                    }, entry);
                    return 'oversized';
                }

                const putOutcome = await activeClient.putEncryptedRecord({
                    serverUrl: session.serverUrl,
                    sessionToken: session.sessionToken,
                    blindRecordId: sealed.blindRecordId,
                    expectedRevision,
                    envelope: sealed.envelope,
                    sha256: await sha256BytesHex(sealed.envelope),
                    keyFingerprint: keyring.keyFingerprint,
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
                        indexPayloadSha256,
                        syncedAt: now(),
                    }, entry);
                    return 'uploaded';
                }

                const remote = await activeClient.getEncryptedRecord({
                    serverUrl: session.serverUrl,
                    sessionToken: session.sessionToken,
                    blindRecordId: sealed.blindRecordId,
                    signal,
                });
                if (!remote) {
                    throw new OperationError('CLOUD_SERVER_ERROR', 'Conflicting remote record disappeared during reconciliation');
                }
                const remotePortable = await openCloudConversation({
                    keyring, blindRecordId: sealed.blindRecordId, revision: remote.revision, envelope: remote.envelope,
                });
                await suppression.withSuppressed(() => restoreCloudConversationsToLocal([remotePortable]));
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
                    indexPayloadSha256: localFolder && remotePortable.detail
                        ? await sha256Utf8Hex(encodePortableCloudConversation(account, { index: { ...remotePortable.index, key } }))
                        : undefined,
                    syncedAt: now(),
                });

                const mergedLocal = await readLocalSyncSource(key, includeDetail);
                if (!mergedLocal) {
                    await removeCloudOutboxEntry(entry);
                    return 'skipped';
                }
                currentSource = mergedLocal;
            } catch (error) {
                if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
                if (error instanceof OperationError && error.code === 'CLOUD_KEY_MISMATCH') {
                    await connection.markSessionKeyMismatch(session, true);
                    throw error;
                }
                if (error instanceof OperationError
                    && (error.code === 'CLOUD_AUTH_REQUIRED'
                        || error.code === 'CLOUD_QUOTA_EXCEEDED'
                        || error.code === 'DIRECTORY_PERMISSION_REQUIRED')) {
                    throw error;
                }
                const issue = operationIssue(error, 'CLOUD_SERVER_ERROR');
                const delayMs = calculateBackoff(entry.attempts, {
                    initialDelayMs: 2_000,
                    maxDelayMs: 5 * 60_000,
                    jitterMs: 500,
                    retryAfterMs: issue.retryAt ? Math.max(0, issue.retryAt - now()) : undefined,
                });
                await recordCloudOutboxFailure(entry, now() + delayMs, issue.code, issue.message);
                return 'retry';
            }
        }

        await recordCloudOutboxFailure(entry, now() + 10_000, 'REVISION_CONFLICT', 'Repeated concurrent revision conflict');
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
                const session = await connection.requireActiveSession();
                const keyring = await connection.resolveKeyring(session);
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
                        const status = await pushSingleConversation(session, keyring, includeDetail, entry, signal);
                        if (status === 'uploaded') uploaded++;
                        else if (status === 'skipped') skippedUnchanged++;
                        else if (status === 'oversized') oversizedSkipped++;
                        else retriedLater++;
                    }
                    if (retriedLater > 0) break;
                }
                return { uploaded, skippedUnchanged, oversizedSkipped, retriedLater };
            } finally {
                activeFlush = null;
            }
        })();
        return activeFlush;
    };

    const enqueueUnsyncedLocalConversations = async (): Promise<number> => {
        const [settings, session] = await Promise.all([getSettings(), getCloudSyncSession()]);
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
                const sha = await sha256Utf8Hex(encodePortableCloudConversation(acc, source));
                if (matchesSyncedPayload(synced, sha, session.backend === 'local-folder' && !detail)) continue;
                unsynced.push(idx.key);
            }
        }
        if (unsynced.length > 0) await enqueueCloudOutboxKeys(unsynced, now());
        return unsynced.length;
    };

    const reconcilePostToggleAccount = async (accountId: string): Promise<void> => {
        if (suppression.isSuppressed() || isSyncNowActive() || !accountId) return;
        const runReconcile = async () => {
            const [settings, session, acc] = await Promise.all([
                getSettings(),
                getCloudSyncSession(),
                getAccount(accountId),
            ]);
            if (!settings.cloudSyncEnabled || !session || session.keyMismatch) return;
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
                const sha = await sha256Utf8Hex(encodePortableCloudConversation(acc, source));
                if (matchesSyncedPayload(synced, sha, session.backend === 'local-folder' && !detail)) continue;
                candidates.push(idx.key);
            }
            if (candidates.length > 0) await enqueueCloudOutboxKeys(candidates, now());
            await flushOutbox();
        };
        if (typeof navigator !== 'undefined' && navigator.locks?.request) {
            await navigator.locks.request(CLOUD_SYNC_CROSS_CONTEXT_LOCK, { ifAvailable: true }, async lock => {
                if (!lock) return;
                await runReconcile();
            });
            return;
        }
        await withVaultOperation(runReconcile);
    };

    const installAutoEnqueueListener = (): (() => void) => {
        const subscribe = applicationHost().subscribeCommittedKeys;
        if (!subscribe) return () => {};
        return subscribe(keys => {
            if (suppression.isSuppressed() || keys.length === 0) return;
            const task = (async () => {
                const [settings, session] = await Promise.all([getSettings(), getCloudSyncSession()]);
                if (!settings.cloudSyncEnabled || !session) return;
                const eligible: ConversationKey[] = [];
                for (const key of keys) {
                    const [acc, index] = await Promise.all([getAccount(key.accountId), getIndex(key)]);
                    if (acc && acc.providerAccountId !== DEFAULT_ACCOUNT_KEY && index) eligible.push(key);
                }
                if (eligible.length === 0) return;
                await enqueueCloudOutboxKeys(eligible, now());
                await withVaultOperation(() => flushOutbox());
            })().catch(error => {
                console.warn('[CloudSync] Auto-enqueue or background flush failed:', error);
            });
            trackBackground(task);
        });
    };

    return {
        flushOutbox,
        enqueueUnsyncedLocalConversations,
        reconcilePostToggleAccount,
        installAutoEnqueueListener,
        getActiveFlush: () => activeFlush,
    };
}
