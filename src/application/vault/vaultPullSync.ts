import { OperationError } from '../../shared/errors/operationError.js';
import type { VaultKeyring } from '../../shared/crypto/index.js';
import type { CloudVaultStatusResponse } from '../../shared/types/cloudSync.js';
import { mapWithConcurrency } from '../../shared/utils/concurrency.js';
import { DEFAULT_ACCOUNT_KEY } from '../../l2/accountRegistry.js';
import { encodePortableCloudConversation, type PortableCloudConversation } from '../../l2/cloudPayload.js';
import { getIndex, listAccounts, listIndexes } from '../../l3a/storageService.js';
import {
    getSyncedCloudRecordByBlindId,
    putCloudSyncSession,
    putSyncedCloudRecord,
} from '../../l3a/vaultStorageService.js';
import { openCloudConversation, restoreCloudConversationsToLocal } from './cloudArchiveCodec.js';
import type { VaultConnection } from './vaultConnection.js';
import {
    CLOUD_CHANGE_PAGE_SIZE,
    isValidChangeFeedCursor,
    rotationRequest,
    sha256Utf8Hex,
    toStoredCloudSession,
    unverifiedBackup,
    type ActiveCloudSession,
    type AutoEnqueueSuppression,
    type CloudPullResult,
} from './vaultShared.js';

export function createVaultPullSync(ctx: {
    readonly connection: VaultConnection;
    readonly suppression: AutoEnqueueSuppression;
    readonly now: () => number;
}) {
    const { connection, suppression, now } = ctx;
    let activePull: Promise<CloudPullResult> | null = null;

    const pullChanges = (
        signal?: AbortSignal,
        rotationSource?: { session: ActiveCloudSession; status: CloudVaultStatusResponse; keyring: VaultKeyring },
    ): Promise<CloudPullResult> => {
        if (activePull) return activePull;
        activePull = (async (): Promise<CloudPullResult> => {
            try {
                let session = rotationSource?.session ?? await connection.requireActiveSession();
                const keyring = rotationSource?.keyring ?? await connection.resolveKeyring(session);
                const request = rotationSource ? rotationRequest : <T>(run: () => Promise<T>) => run();
                if (!rotationSource) session = (await connection.verifyVaultKeyCompatibility(session, keyring, signal)).session;
                let downloaded = 0;
                let accepted = 0;
                let changed = 0;
                let seenRecords = 0;
                let hasAnyLocalConversation = false;
                for (const acc of await listAccounts()) {
                    if (acc.providerAccountId === DEFAULT_ACCOUNT_KEY) continue;
                    if ((await listIndexes(acc.id)).length > 0) {
                        hasAnyLocalConversation = true;
                        break;
                    }
                }
                let cursor = !rotationSource && hasAnyLocalConversation ? session.pulledSeq : 0;

                const activeClient = connection.clientForSession(session);
                for (let page = 0; rotationSource || page < 200; page++) {
                    signal?.throwIfAborted();
                    const feed = await request(() => activeClient.listChanges({
                        serverUrl: session.serverUrl,
                        sessionToken: session.sessionToken,
                        sinceSeq: cursor,
                        limit: CLOUD_CHANGE_PAGE_SIZE,
                        signal,
                    }));
                    if (!isValidChangeFeedCursor(feed, cursor)) {
                        throw new OperationError('CLOUD_SERVER_ERROR', 'Invalid cloud change feed cursor');
                    }
                    if (rotationSource && feed.headSeq !== rotationSource.status.headSeq) throw unverifiedBackup();
                    if (feed.items.length === 0) break;
                    seenRecords += feed.items.length;

                    const toDownload = [];
                    for (const meta of feed.items) {
                        if (rotationSource && hasAnyLocalConversation && meta.changeSeq <= session.pulledSeq) continue;
                        const existing = rotationSource ? null : await getSyncedCloudRecordByBlindId(session.ownerSubject, meta.blindRecordId);
                        if (existing && existing.remoteRevision >= meta.revision) {
                            const localIndex = await getIndex({
                                accountId: existing.accountId,
                                conversationId: existing.conversationId,
                            });
                            if (localIndex) continue;
                        }
                        toDownload.push(meta);
                    }

                    const PULL_COMMIT_SLICE = 10;
                    for (let sliceOffset = 0; sliceOffset < toDownload.length; sliceOffset += PULL_COMMIT_SLICE) {
                        const downloadSlice = toDownload.slice(sliceOffset, sliceOffset + PULL_COMMIT_SLICE);
                        const openedBatch = await mapWithConcurrency(downloadSlice, 4, async (meta): Promise<{
                            meta: typeof meta;
                            portable: PortableCloudConversation;
                            payloadSha256: string;
                            indexPayloadSha256?: string;
                        } | null> => {
                            const blob = await request(() => activeClient.getEncryptedRecord({
                                serverUrl: session.serverUrl,
                                sessionToken: session.sessionToken,
                                blindRecordId: meta.blindRecordId,
                                signal,
                            }));
                            if (rotationSource && (!blob || blob.revision !== meta.revision)) throw unverifiedBackup();
                            if (!blob) {
                                throw new OperationError('CLOUD_SERVER_ERROR', 'Listed remote record disappeared during download');
                            }
                            if (blob.revision < meta.revision) {
                                throw new OperationError('CLOUD_SERVER_ERROR', 'Downloaded remote record revision regressed');
                            }
                            const portable = await openCloudConversation({
                                keyring, blindRecordId: meta.blindRecordId, revision: blob.revision, envelope: blob.envelope,
                            });
                            downloaded++;
                            const tempAccountId = '00000000-0000-4000-8000-000000000000';
                            const tempKey = { accountId: tempAccountId, conversationId: portable.conversationId };
                            const portableAccount = { id: tempAccountId, ...portable.account };
                            const index = { ...portable.index, key: tempKey };
                            const canonicalJson = encodePortableCloudConversation(
                                portableAccount,
                                {
                                    index,
                                    ...(portable.detail !== undefined ? { detail: { ...portable.detail, key: tempKey } } : {}),
                                },
                            );
                            const payloadSha256 = await sha256Utf8Hex(canonicalJson);
                            return {
                                meta: { ...meta, revision: blob.revision },
                                portable,
                                payloadSha256,
                                indexPayloadSha256: session.backend === 'local-folder' && portable.detail
                                    ? await sha256Utf8Hex(encodePortableCloudConversation(portableAccount, { index })) : undefined,
                            };
                        }, signal);

                        const validOpened = openedBatch.filter((x): x is NonNullable<typeof x> => x !== null);
                        if (validOpened.length > 0) {
                            const summary = await suppression.withSuppressed(() =>
                                restoreCloudConversationsToLocal(validOpened.map(x => x.portable)));
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
                                    indexPayloadSha256: item.indexPayloadSha256,
                                    syncedAt: now(),
                                });
                            }
                        }
                    }

                    cursor = feed.nextSince;
                    if (!rotationSource) {
                        session = { ...session, pulledSeq: cursor };
                        await putCloudSyncSession(toStoredCloudSession(session));
                    }
                    if (!feed.hasMore) break;
                }

                if (rotationSource && seenRecords !== rotationSource.status.recordCount) throw unverifiedBackup();
                return { downloaded, accepted, changed, pulledSeq: cursor };
            } finally {
                activePull = null;
            }
        })();
        return activePull;
    };

    return {
        pullChanges,
        getActivePull: () => activePull,
    };
}
