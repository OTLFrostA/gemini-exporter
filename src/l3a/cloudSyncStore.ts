import type { ConversationKey } from '../l2/conversationKey.js';
import type { CloudVaultBackendType } from '../shared/types/cloudSync.js';
import { isDirectoryHandle, type DirectoryHandle } from '../shared/types/directoryHandle.js';

export type { CloudVaultBackendType } from '../shared/types/cloudSync.js';

const CLOUD_DB_NAME = 'gemini_exporter_cloud_v2';
const CLOUD_DB_VERSION = 2;
const KEYRING_METADATA_INDEX = 'byOwnerFingerprintOrigin';

export interface CloudSyncSessionState {
    readonly id: 'active';
    readonly backend: CloudVaultBackendType;
    readonly serverUrl: string;
    readonly ownerSubject: string;
    readonly sessionToken: string;
    readonly expiresAt: number;
    readonly folderName?: string;
    readonly accessCode?: string;
    readonly keyMismatch?: boolean;
    readonly pulledSeq: number;
    readonly enabledSinceAt?: number;
}

export interface CloudOutboxEntry {
    readonly accountId: string;
    readonly conversationId: string;
    readonly enqueueId: string;
    readonly queuedAt: number;
    readonly attempts: number;
    readonly nextRetryAt: number;
    readonly lastErrorCode?: string;
    readonly lastErrorMessage?: string;
}

export interface CloudSyncedRecordState {
    readonly ownerSubject: string;
    readonly accountId: string;
    readonly conversationId: string;
    readonly blindRecordId: string;
    readonly remoteRevision: number;
    readonly payloadSha256: string;
    readonly indexPayloadSha256?: string;
    readonly syncedAt: number;
    readonly oversizedBytes?: number;
}

export type VaultKeyProvisionOrigin = 'generated' | 'imported';

export interface VaultKeyMetadata {
    readonly keyFingerprint: string;
    readonly origin: VaultKeyProvisionOrigin;
}

export interface StoredNonExtractableKeyring extends VaultKeyMetadata {
    readonly ownerSubject: string;
    readonly recordIdKey: CryptoKey;
    readonly payloadKey: CryptoKey;
    readonly authKey: CryptoKey;
}

interface PooledCloudDb {
    readonly openFn: IDBFactory['open'];
    readonly promise: Promise<IDBDatabase>;
}

const pooledCloudDbs = new WeakMap<IDBFactory, PooledCloudDb>();

function openCloudDBOnFactory(factory: IDBFactory, onEvict?: () => void): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = factory === indexedDB
            ? indexedDB.open(CLOUD_DB_NAME, CLOUD_DB_VERSION)
            : factory.open(CLOUD_DB_NAME, CLOUD_DB_VERSION);
        request.onupgradeneeded = event => {
            if (event.oldVersion !== 0) {
                request.transaction?.abort();
                return;
            }
            const db = request.result;
            db.createObjectStore('session', { keyPath: 'id' });
            db.createObjectStore('outbox', { keyPath: ['accountId', 'conversationId'] });
            const synced = db.createObjectStore('syncedRecords', {
                keyPath: ['ownerSubject', 'accountId', 'conversationId'],
            });
            synced.createIndex('byOwnerBlindId', ['ownerSubject', 'blindRecordId'], { unique: true });
            const localKeys = db.createObjectStore('localKeys', { keyPath: 'ownerSubject' });
            localKeys.createIndex(KEYRING_METADATA_INDEX, ['ownerSubject', 'keyFingerprint', 'origin']);
            db.createObjectStore('vaultHandles');
        };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => {
                onEvict?.();
                db.close();
            };
            db.onclose = () => { onEvict?.(); };
            resolve(db);
        };
        request.onerror = () => {
            onEvict?.();
            reject(request.error);
        };
    });
}

function acquireCloudDB(): Promise<IDBDatabase> {
    const factory = indexedDB;
    const currentOpen = factory.open;
    const cached = pooledCloudDbs.get(factory);
    if (cached && cached.openFn === currentOpen) return cached.promise;
    let entry: PooledCloudDb | undefined;
    const evict = (): void => {
        if (pooledCloudDbs.get(factory) === entry) pooledCloudDbs.delete(factory);
    };
    const promise = openCloudDBOnFactory(factory, evict);
    entry = { openFn: currentOpen, promise };
    pooledCloudDbs.set(factory, entry);
    return promise;
}

type CloudStoreName = 'session' | 'outbox' | 'syncedRecords' | 'localKeys' | 'vaultHandles';

async function inCloudStores<T>(
    names: readonly CloudStoreName[],
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T> {
    const factory = indexedDB;
    let db = await acquireCloudDB();
    let tx: IDBTransaction;
    try {
        tx = db.transaction([...names], mode);
    } catch (error) {
        if (error instanceof DOMException && error.name === 'InvalidStateError') {
            pooledCloudDbs.delete(factory);
            db = await acquireCloudDB();
            tx = db.transaction([...names], mode);
        } else {
            throw error;
        }
    }
    return new Promise<T>((resolve, reject) => {
        let result!: T;
        let failure: unknown;
        const fail = (error: unknown): void => {
            failure = error;
            try { tx.abort(); } catch { reject(error); }
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('Cloud sync transaction aborted'));
        try {
            run(tx, value => { result = value; }, fail);
        } catch (error) {
            fail(error);
        }
    });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseSessionState(raw: unknown): CloudSyncSessionState | null {
    if (!isPlainObject(raw)) return null;
    if (raw.id !== 'active'
        || (raw.backend !== 'local-folder' && raw.backend !== 'cloud-server')
        || typeof raw.serverUrl !== 'string' || !raw.serverUrl
        || typeof raw.ownerSubject !== 'string' || !raw.ownerSubject
        || typeof raw.sessionToken !== 'string' || !raw.sessionToken
        || typeof raw.expiresAt !== 'number' || !Number.isSafeInteger(raw.expiresAt)
        || typeof raw.pulledSeq !== 'number' || !Number.isSafeInteger(raw.pulledSeq) || raw.pulledSeq < 0) {
        return null;
    }
    return {
        id: 'active',
        backend: raw.backend,
        serverUrl: raw.serverUrl,
        ownerSubject: raw.ownerSubject,
        sessionToken: raw.sessionToken,
        expiresAt: raw.expiresAt,
        pulledSeq: raw.pulledSeq,
        ...(typeof raw.folderName === 'string' && raw.folderName ? { folderName: raw.folderName } : {}),
        ...(typeof raw.accessCode === 'string' && raw.accessCode ? { accessCode: raw.accessCode } : {}),
        ...(raw.keyMismatch === true ? { keyMismatch: true } : {}),
        ...(typeof raw.enabledSinceAt === 'number' && Number.isSafeInteger(raw.enabledSinceAt)
            ? { enabledSinceAt: raw.enabledSinceAt }
            : {}),
    };
}

function parseOutboxEntry(raw: unknown): CloudOutboxEntry | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.accountId !== 'string' || !raw.accountId
        || typeof raw.conversationId !== 'string' || !raw.conversationId
        || typeof raw.enqueueId !== 'string' || !raw.enqueueId
        || typeof raw.queuedAt !== 'number' || !Number.isSafeInteger(raw.queuedAt)
        || typeof raw.attempts !== 'number' || !Number.isSafeInteger(raw.attempts)
        || typeof raw.nextRetryAt !== 'number' || !Number.isSafeInteger(raw.nextRetryAt)) {
        return null;
    }
    return {
        accountId: raw.accountId,
        conversationId: raw.conversationId,
        enqueueId: raw.enqueueId,
        queuedAt: raw.queuedAt,
        attempts: raw.attempts,
        nextRetryAt: raw.nextRetryAt,
        ...(typeof raw.lastErrorCode === 'string' ? { lastErrorCode: raw.lastErrorCode } : {}),
        ...(typeof raw.lastErrorMessage === 'string' ? { lastErrorMessage: raw.lastErrorMessage } : {}),
    };
}

function parseSyncedRecordState(raw: unknown): CloudSyncedRecordState | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.ownerSubject !== 'string' || !raw.ownerSubject
        || typeof raw.accountId !== 'string' || !raw.accountId
        || typeof raw.conversationId !== 'string' || !raw.conversationId
        || typeof raw.blindRecordId !== 'string' || !raw.blindRecordId
        || typeof raw.remoteRevision !== 'number' || !Number.isSafeInteger(raw.remoteRevision)
        || typeof raw.payloadSha256 !== 'string' || !raw.payloadSha256
        || typeof raw.syncedAt !== 'number' || !Number.isSafeInteger(raw.syncedAt)) {
        return null;
    }
    return {
        ownerSubject: raw.ownerSubject,
        accountId: raw.accountId,
        conversationId: raw.conversationId,
        blindRecordId: raw.blindRecordId,
        remoteRevision: raw.remoteRevision,
        payloadSha256: raw.payloadSha256,
        ...(typeof raw.indexPayloadSha256 === 'string' ? { indexPayloadSha256: raw.indexPayloadSha256 } : {}),
        syncedAt: raw.syncedAt,
        ...(typeof raw.oversizedBytes === 'number' && Number.isSafeInteger(raw.oversizedBytes)
            ? { oversizedBytes: raw.oversizedBytes }
            : {}),
    };
}

export function getCloudSyncSession(): Promise<CloudSyncSessionState | null> {
    return inCloudStores(['session'], 'readonly', (tx, done) => {
        const req = tx.objectStore('session').get('active');
        req.onsuccess = () => done(parseSessionState(req.result));
    });
}

export function putCloudSyncSession(session: CloudSyncSessionState): Promise<void> {
    return inCloudStores(['session'], 'readwrite', (tx, done) => {
        tx.objectStore('session').put(session);
        done(undefined);
    });
}

export function clearCloudSyncSession(clearOutbox = true): Promise<void> {
    const stores: CloudStoreName[] = clearOutbox ? ['session', 'outbox'] : ['session'];
    return inCloudStores(stores, 'readwrite', (tx, done) => {
        tx.objectStore('session').delete('active');
        if (clearOutbox) tx.objectStore('outbox').clear();
        done(undefined);
    });
}

/** Enqueue changed ConversationKeys into the durable outbox, resetting retry schedule to immediate. */
export function enqueueCloudOutboxKeys(keys: readonly ConversationKey[], nowMs = Date.now()): Promise<void> {
    if (keys.length === 0) return Promise.resolve();
    const dedup = new Map<string, ConversationKey>();
    for (const key of keys) {
        dedup.set(JSON.stringify([key.accountId, key.conversationId]), key);
    }
    const unique = [...dedup.values()];
    return inCloudStores(['outbox'], 'readwrite', (tx, done) => {
        const store = tx.objectStore('outbox');
        let remaining = unique.length;
        for (const key of unique) {
            const getReq = store.get([key.accountId, key.conversationId]);
            getReq.onsuccess = () => {
                const prev = parseOutboxEntry(getReq.result);
                const next: CloudOutboxEntry = {
                    accountId: key.accountId,
                    conversationId: key.conversationId,
                    enqueueId: crypto.randomUUID(),
                    queuedAt: prev?.queuedAt ?? nowMs,
                    attempts: 0,
                    nextRetryAt: 0,
                };
                store.put(next);
                if (--remaining === 0) done(undefined);
            };
        }
    });
}

export function listDueCloudOutbox(nowMs = Date.now(), limit = 50): Promise<CloudOutboxEntry[]> {
    return inCloudStores(['outbox'], 'readonly', (tx, done) => {
        const req = tx.objectStore('outbox').getAll();
        req.onsuccess = () => {
            const rawList: readonly unknown[] = Array.isArray(req.result) ? req.result : [];
            const parsed: CloudOutboxEntry[] = [];
            for (const item of rawList) {
                const entry = parseOutboxEntry(item);
                if (entry && entry.nextRetryAt <= nowMs) parsed.push(entry);
            }
            parsed.sort((a, b) => a.queuedAt - b.queuedAt);
            done(parsed.slice(0, limit));
        };
    });
}

export function countCloudOutbox(): Promise<{ total: number; failed: number }> {
    return inCloudStores(['outbox'], 'readonly', (tx, done) => {
        const req = tx.objectStore('outbox').getAll();
        req.onsuccess = () => {
            const rawList: readonly unknown[] = Array.isArray(req.result) ? req.result : [];
            let total = 0;
            let failed = 0;
            for (const item of rawList) {
                const entry = parseOutboxEntry(item);
                if (entry) {
                    total++;
                    if (entry.attempts > 0) failed++;
                }
            }
            done({ total, failed });
        };
    });
}

function mutateCurrentOutboxEntry(
    tx: IDBTransaction,
    entry: CloudOutboxEntry,
    mutate: (store: IDBObjectStore, key: string[], current: CloudOutboxEntry) => void,
): void {
    const store = tx.objectStore('outbox');
    const key = [entry.accountId, entry.conversationId];
    const req = store.get(key);
    req.onsuccess = () => {
        const current = parseOutboxEntry(req.result);
        if (current && current.enqueueId === entry.enqueueId) mutate(store, key, current);
    };
}

export function removeCloudOutboxEntry(entry: CloudOutboxEntry): Promise<void> {
    return inCloudStores(['outbox'], 'readwrite', (tx, done) => {
        mutateCurrentOutboxEntry(tx, entry, (store, key) => { store.delete(key); });
        done(undefined);
    });
}

export function recordCloudOutboxFailure(
    entry: CloudOutboxEntry,
    nextRetryAt: number,
    errorCode: string,
    errorMessage: string,
): Promise<void> {
    return inCloudStores(['outbox'], 'readwrite', (tx, done) => {
        mutateCurrentOutboxEntry(tx, entry, (store, _, current) => {
            const updated: CloudOutboxEntry = {
                ...current,
                attempts: current.attempts + 1,
                nextRetryAt,
                lastErrorCode: errorCode,
                lastErrorMessage: errorMessage,
            };
            store.put(updated);
        });
        done(undefined);
    });
}

export function getSyncedCloudRecord(
    ownerSubject: string,
    key: ConversationKey,
): Promise<CloudSyncedRecordState | null> {
    return inCloudStores(['syncedRecords'], 'readonly', (tx, done) => {
        const req = tx.objectStore('syncedRecords').get([ownerSubject, key.accountId, key.conversationId]);
        req.onsuccess = () => done(parseSyncedRecordState(req.result));
    });
}

export function getSyncedCloudRecordByBlindId(
    ownerSubject: string,
    blindRecordId: string,
): Promise<CloudSyncedRecordState | null> {
    return inCloudStores(['syncedRecords'], 'readonly', (tx, done) => {
        const req = tx.objectStore('syncedRecords').index('byOwnerBlindId').get([ownerSubject, blindRecordId]);
        req.onsuccess = () => done(parseSyncedRecordState(req.result));
    });
}

export function putSyncedCloudRecord(state: CloudSyncedRecordState, entry?: CloudOutboxEntry): Promise<void> {
    const stores: CloudStoreName[] = entry ? ['syncedRecords', 'outbox'] : ['syncedRecords'];
    return inCloudStores(stores, 'readwrite', (tx, done) => {
        tx.objectStore('syncedRecords').put(state);
        if (entry) {
            mutateCurrentOutboxEntry(tx, entry, (store, key) => { store.delete(key); });
        }
        done(undefined);
    });
}

export function countOversizedCloudRecords(ownerSubject: string): Promise<number> {
    return inCloudStores(['syncedRecords'], 'readonly', (tx, done) => {
        const range = IDBKeyRange.bound([ownerSubject], [ownerSubject, []]);
        const req = tx.objectStore('syncedRecords').getAll(range);
        req.onsuccess = () => {
            const rawList: readonly unknown[] = Array.isArray(req.result) ? req.result : [];
            let count = 0;
            for (const item of rawList) {
                const parsed = parseSyncedRecordState(item);
                if (parsed?.oversizedBytes !== undefined) count++;
            }
            done(count);
        };
    });
}

export function clearSyncedCloudRecordsForOwner(ownerSubject: string): Promise<void> {
    return inCloudStores(['syncedRecords'], 'readwrite', (tx, done) => {
        const range = IDBKeyRange.bound([ownerSubject], [ownerSubject, []]);
        tx.objectStore('syncedRecords').delete(range);
        done(undefined);
    });
}

function isNonExtractableCryptoKey(value: unknown, algorithm: string): value is CryptoKey {
    return value !== null
        && typeof value === 'object'
        && 'extractable' in value && value.extractable === false
        && 'type' in value && value.type === 'secret'
        && 'algorithm' in value && isPlainObject(value.algorithm) && value.algorithm.name === algorithm;
}

function parseKeyMetadata(fingerprint: unknown, origin: unknown): VaultKeyMetadata | null {
    return typeof fingerprint === 'string' && /^[0-9a-f]{32}$/.test(fingerprint)
        && (origin === 'generated' || origin === 'imported')
        ? { keyFingerprint: fingerprint, origin }
        : null;
}

function parseStoredKeyring(raw: unknown): StoredNonExtractableKeyring | null {
    if (!isPlainObject(raw) || typeof raw.ownerSubject !== 'string') return null;
    const metadata = parseKeyMetadata(raw.keyFingerprint, raw.origin);
    if (!metadata
        || !isNonExtractableCryptoKey(raw.recordIdKey, 'HMAC')
        || !isNonExtractableCryptoKey(raw.payloadKey, 'AES-GCM')
        || !isNonExtractableCryptoKey(raw.authKey, 'HMAC')) return null;
    return {
        ...metadata,
        ownerSubject: raw.ownerSubject,
        recordIdKey: raw.recordIdKey,
        payloadKey: raw.payloadKey,
        authKey: raw.authKey,
    };
}

export function getStoredNonExtractableKeyring(ownerSubject: string): Promise<StoredNonExtractableKeyring | null> {
    return inCloudStores(['localKeys'], 'readonly', (tx, done) => {
        const req = tx.objectStore('localKeys').get(ownerSubject);
        req.onsuccess = () => done(parseStoredKeyring(req.result));
    });
}

export function getStoredVaultKeyMetadata(ownerSubject: string): Promise<VaultKeyMetadata | null> {
    return inCloudStores(['localKeys'], 'readonly', (tx, done) => {
        const range = IDBKeyRange.bound([ownerSubject], [ownerSubject, []]);
        const req = tx.objectStore('localKeys').index(KEYRING_METADATA_INDEX).openKeyCursor(range);
        req.onsuccess = () => {
            // The index key contains metadata only; no CryptoKey value is cloned into this context.
            const key = req.result?.key;
            done(Array.isArray(key) ? parseKeyMetadata(key[1], key[2]) : null);
        };
    });
}

export function activateStoredKeyring(
    entry: StoredNonExtractableKeyring,
    session?: CloudSyncSessionState,
    previousOwnerSubject?: string,
    verifiedBackup?: readonly CloudSyncedRecordState[],
): Promise<void> {
    const safeEntry = parseStoredKeyring(entry);
    if (!safeEntry) {
        return Promise.reject(new Error('Refusing to persist invalid CryptoKey handles in Vault store'));
    }
    return inCloudStores(['localKeys', 'session', 'syncedRecords', 'outbox'], 'readwrite', (tx, done) => {
        tx.objectStore('localKeys').put(safeEntry);
        if (previousOwnerSubject && previousOwnerSubject !== session?.ownerSubject) {
            tx.objectStore('syncedRecords').delete(
                IDBKeyRange.bound([previousOwnerSubject], [previousOwnerSubject, []]),
            );
        }
        if (session) {
            tx.objectStore('session').put(session);
            tx.objectStore('syncedRecords').delete(IDBKeyRange.bound([session.ownerSubject], [session.ownerSubject, []]));
            if (verifiedBackup) {
                for (const record of verifiedBackup) tx.objectStore('syncedRecords').put(record);
            } else {
                tx.objectStore('outbox').clear();
            }
        }
        done(undefined);
    });
}

function isFileSystemDirLike(value: unknown): value is FileSystemDirectoryHandle {
    return value !== null && typeof value === 'object'
        && 'kind' in value && value.kind === 'directory'
        && 'getFileHandle' in value && typeof value.getFileHandle === 'function';
}

export function getStoredLocalVaultHandle(): Promise<DirectoryHandle | null> {
    return inCloudStores(['vaultHandles'], 'readonly', (tx, done) => {
        const req = tx.objectStore('vaultHandles').get('local-vault');
        req.onsuccess = () => {
            const raw: unknown = req.result;
            done(isFileSystemDirLike(raw) && isDirectoryHandle(raw) ? raw : null);
        };
    });
}

export function putLocalVaultConnection(
    session: CloudSyncSessionState,
    handle: DirectoryHandle,
    resetSyncedRecords: boolean,
): Promise<void> {
    return inCloudStores(['session', 'vaultHandles', 'syncedRecords'], 'readwrite', (tx, done) => {
        tx.objectStore('session').put(session);
        tx.objectStore('vaultHandles').put(handle, 'local-vault');
        if (resetSyncedRecords) {
            const range = IDBKeyRange.bound([session.ownerSubject], [session.ownerSubject, []]);
            tx.objectStore('syncedRecords').delete(range);
        }
        done(undefined);
    });
}

export function setStoredLocalVaultHandle(handle: DirectoryHandle | null): Promise<void> {
    return inCloudStores(['vaultHandles'], 'readwrite', (tx, done) => {
        const store = tx.objectStore('vaultHandles');
        if (handle) store.put(handle, 'local-vault');
        else store.delete('local-vault');
        done(undefined);
    });
}
