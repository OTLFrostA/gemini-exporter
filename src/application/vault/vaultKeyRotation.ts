import { OperationError } from '../../shared/errors/operationError.js';
import { deriveBlindRecordId, sealSessionSecrets, type VaultKeyring } from '../../shared/crypto/index.js';
import type { CloudVaultStatusResponse } from '../../shared/types/cloudSync.js';
import { DEFAULT_ACCOUNT_KEY } from '../../l2/accountRegistry.js';
import { encodePortableCloudConversation } from '../../l2/cloudPayload.js';
import { listAccounts, listIndexes } from '../../l3a/storageService.js';
import {
    activateVaultKeyring as persistActivatedVaultKeyring,
    getCloudSyncSession,
    getInitializedVaultKeyMetadata,
    type CloudSyncSessionState,
    type CloudSyncedRecordState,
} from '../../l3a/vaultStorageService.js';
import { getSettings } from '../settings/index.js';
import { openCloudConversation, sealCloudConversation } from './cloudArchiveCodec.js';
import type { VaultConnection } from './vaultConnection.js';
import {
    CLOUD_CHANGE_PAGE_SIZE,
    isValidChangeFeedCursor,
    readLocalSyncSource,
    rotationRequest,
    sha256BytesHex,
    sha256Utf8Hex,
    unverifiedBackup,
    withVaultOperation,
    type ActivateKeyring,
    type ActiveCloudSession,
    type CloudPullResult,
} from './vaultShared.js';

export function createVaultKeyRotation(ctx: {
    readonly connection: VaultConnection;
    readonly pullChanges: (
        signal?: AbortSignal,
        rotationSource?: { session: ActiveCloudSession; status: CloudVaultStatusResponse; keyring: VaultKeyring },
    ) => Promise<CloudPullResult>;
    readonly now: () => number;
}): { activateVaultKeyring: ActivateKeyring } {
    const { connection, pullChanges, now } = ctx;

    const stageCloudBackup = async (
        session: ActiveCloudSession,
        keyring: VaultKeyring,
        includeDetail: boolean,
    ): Promise<CloudSyncedRecordState[]> => {
        const target = { serverUrl: session.serverUrl, sessionToken: session.sessionToken };
        const written = new Map<string, { state: CloudSyncedRecordState; ciphertextSha256: string }>();
        const oversizedRecords: CloudSyncedRecordState[] = [];
        for (const account of await listAccounts()) {
            if (account.providerAccountId === DEFAULT_ACCOUNT_KEY) continue;
            for (const { key } of await listIndexes(account.id)) {
                const source = await readLocalSyncSource(key, includeDetail);
                if (!source) throw unverifiedBackup();
                const portableJson = encodePortableCloudConversation(account, source);
                const payloadSha256 = await sha256Utf8Hex(portableJson);
                let sealed: Awaited<ReturnType<typeof sealCloudConversation>>;
                let ciphertextSha256: string;
                let put: Awaited<ReturnType<typeof connection.remoteClient.putEncryptedRecord>>;
                try {
                    sealed = await sealCloudConversation({
                        keyring, revision: 1, account, conversation: source,
                    });
                    ciphertextSha256 = await sha256BytesHex(sealed.envelope);
                    put = await rotationRequest(() => connection.remoteClient.putEncryptedRecord({
                        ...target, blindRecordId: sealed.blindRecordId, envelope: sealed.envelope, expectedRevision: 0,
                        keyFingerprint: keyring.keyFingerprint, sha256: ciphertextSha256,
                    }));
                } catch (error) {
                    if (!(error instanceof OperationError) || error.code !== 'CLOUD_RECORD_TOO_LARGE') throw error;
                    const blindRecordId = await deriveBlindRecordId(
                        keyring, account.providerId, account.providerAccountId, key.conversationId,
                    );
                    oversizedRecords.push({
                        ...key,
                        ownerSubject: session.ownerSubject,
                        blindRecordId,
                        remoteRevision: 0,
                        syncedAt: now(),
                        payloadSha256,
                        oversizedBytes: portableJson.length,
                    });
                    continue;
                }
                if (put.status !== 'committed' || put.meta.revision !== 1 || put.meta.blindRecordId !== sealed.blindRecordId) {
                    throw unverifiedBackup();
                }
                written.set(sealed.blindRecordId, {
                    ciphertextSha256,
                    state: {
                        ...key,
                        ownerSubject: session.ownerSubject,
                        blindRecordId: sealed.blindRecordId,
                        remoteRevision: 1,
                        syncedAt: now(),
                        payloadSha256,
                    },
                });
            }
        }

        const verified: CloudSyncedRecordState[] = [...oversizedRecords];
        let cursor = 0;
        for (;;) {
            const feed = await rotationRequest(() => connection.remoteClient.listChanges({
                ...target, sinceSeq: cursor, limit: CLOUD_CHANGE_PAGE_SIZE,
            }));
            if (!isValidChangeFeedCursor(feed, cursor)) throw unverifiedBackup();
            for (const meta of feed.items) {
                const record = written.get(meta.blindRecordId);
                if (!record || meta.revision !== 1 || meta.sha256 !== record.ciphertextSha256) throw unverifiedBackup();
                const blob = await rotationRequest(() => connection.remoteClient.getEncryptedRecord({
                    ...target, blindRecordId: meta.blindRecordId,
                }));
                if (!blob || blob.revision !== 1 || await sha256BytesHex(blob.envelope) !== record.ciphertextSha256) {
                    throw unverifiedBackup();
                }
                await openCloudConversation({ keyring, blindRecordId: meta.blindRecordId, ...blob });
                verified.push(record.state);
                written.delete(meta.blindRecordId);
            }
            if (!feed.hasMore) break;
            cursor = feed.nextSince;
        }
        if (written.size !== 0) throw unverifiedBackup();
        return verified;
    };

    const activateVaultKeyring: ActivateKeyring = (candidateKeyring, origin, expectedFingerprint) =>
        withVaultOperation(async () => {
            const session = await getCloudSyncSession();
            const keyFingerprint = candidateKeyring.keyFingerprint;
            const current = await getInitializedVaultKeyMetadata();
            if ((current?.keyFingerprint ?? null) !== expectedFingerprint) {
                throw new OperationError('CLOUD_KEY_CHANGED', 'The active Master Key has changed. Review the current key before trying again.');
            }
            if (!session) {
                await persistActivatedVaultKeyring(candidateKeyring, origin);
                return { keyFingerprint, resolution: 'initialized' };
            }
            const { keyMismatch: _cleared, ...cleanSession } = session;
            if (session.backend === 'cloud-server') {
                if (origin === 'generated') {
                    const settings = await getSettings();
                    const oldSession = await rotationRequest(connection.requireActiveSession);
                    const oldKeyring = await connection.resolveKeyring(oldSession);
                    const source = await rotationRequest(() => connection.verifyVaultKeyCompatibility(oldSession, oldKeyring));
                    const previous = await pullChanges(undefined, { ...source, keyring: oldKeyring });
                    const auth = await rotationRequest(() => connection.authenticateVaultKey(
                        session.serverUrl, candidateKeyring, 'create', oldSession.accessCode,
                    ));
                    if (auth.ownerSubject === session.ownerSubject) throw unverifiedBackup();
                    const nextSealed = await sealSessionSecrets(
                        candidateKeyring,
                        { sessionToken: auth.sessionToken, ...(oldSession.accessCode ? { accessCode: oldSession.accessCode } : {}) },
                        { serverUrl: session.serverUrl, ownerSubject: auth.ownerSubject },
                    );
                    const nextStoredSession: CloudSyncSessionState = {
                        ...cleanSession,
                        ownerSubject: auth.ownerSubject,
                        expiresAt: auth.expiresAt,
                        sealedCredentials: nextSealed,
                        pulledSeq: 0,
                    };
                    const nextActiveSession: ActiveCloudSession = {
                        ...nextStoredSession,
                        sessionToken: auth.sessionToken,
                        ...(oldSession.accessCode ? { accessCode: oldSession.accessCode } : {}),
                    };
                    const verified = await stageCloudBackup(nextActiveSession, candidateKeyring, settings.cloudSyncIncludeDetail === true);
                    const activeSession = await rotationRequest(connection.requireActiveSession);
                    const latest = await rotationRequest(() => connection.remoteClient.getVaultStatus(activeSession.serverUrl, activeSession.sessionToken));
                    if (latest.headSeq !== source.status.headSeq || latest.recordCount !== source.status.recordCount
                        || latest.keyFingerprint !== source.status.keyFingerprint) throw unverifiedBackup();
                    await persistActivatedVaultKeyring(candidateKeyring, 'imported', nextStoredSession, session.ownerSubject, verified);
                    return {
                        keyFingerprint,
                        resolution: 'rekeyed',
                        cloudBackup: { saved: verified.length, restoredChanges: previous.changed > 0 },
                    };
                }
                const accessCode = await connection.readSessionAccessCode(session);
                const auth = await connection.authenticateVaultKey(session.serverUrl, candidateKeyring, 'unlock', accessCode);
                const nextSealed = await sealSessionSecrets(
                    candidateKeyring,
                    { sessionToken: auth.sessionToken, ...(accessCode ? { accessCode } : {}) },
                    { serverUrl: session.serverUrl, ownerSubject: auth.ownerSubject },
                );
                await persistActivatedVaultKeyring(
                    candidateKeyring,
                    'imported',
                    {
                        ...cleanSession,
                        ownerSubject: auth.ownerSubject,
                        expiresAt: auth.expiresAt,
                        sealedCredentials: nextSealed,
                        pulledSeq: 0,
                    },
                    session.ownerSubject,
                );
                return { keyFingerprint, resolution: 'unlocked' };
            }

            const activeClient = connection.clientForSession(session);
            const vaultStatus = await activeClient.getVaultStatus(session.serverUrl, 'local-folder-session');
            if (origin === 'generated') {
                if (vaultStatus.recordCount > 0 && (!current || vaultStatus.keyFingerprint !== current.keyFingerprint)) {
                    await persistActivatedVaultKeyring(candidateKeyring, 'generated', { ...cleanSession, keyMismatch: true, pulledSeq: 0 });
                    return { keyFingerprint, resolution: 'initialized' };
                }
                if (vaultStatus.recordCount > 0) await pullChanges();
                await activeClient.purgeVault(session.serverUrl, 'local-folder-session');
                await persistActivatedVaultKeyring(candidateKeyring, 'generated', { ...cleanSession, pulledSeq: 0 });
                return { keyFingerprint, resolution: 'rekeyed' };
            }
            if (vaultStatus.recordCount > 0 && vaultStatus.keyFingerprint !== keyFingerprint) {
                throw new OperationError('CLOUD_KEY_MISMATCH', 'The entered Master Key does not match the key that encrypted this vault.');
            }
            await persistActivatedVaultKeyring(candidateKeyring, 'imported', { ...cleanSession, pulledSeq: 0 });
            return { keyFingerprint, resolution: 'unlocked' };
        });

    return { activateVaultKeyring };
}
