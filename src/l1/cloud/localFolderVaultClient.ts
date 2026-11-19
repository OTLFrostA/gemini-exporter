import { OperationError } from '../../shared/errors/operationError.js';
import { bytesToHex } from '../../shared/crypto/index.js';
import type { DirectoryHandle } from '../../shared/types/directoryHandle.js';
import {
    CLOUD_MAX_RECORD_BYTES,
    CLOUD_WIRE_MAGIC,
    type CloudRecordMeta,
} from '../../shared/types/cloudSync.js';
import { isRecord } from '../../shared/utils/typeGuards.js';
import type { VaultRecordClient } from './vaultClient.js';

export const LOCAL_VAULT_OWNER_SUBJECT = 'local:vault';
export const LOCAL_VAULT_SERVER_URL = 'local-vault://directory';
const MANIFEST_FILENAME = 'vault-manifest.json';
const RECORDS_SUBDIR = 'records';
const LOCAL_VAULT_LOCK = 'gemini_exporter_local_vault_fs_lock';
const BLIND_ID_PATTERN = /^[0-9a-f]{64}$/;
const KEY_FP_PATTERN = /^[0-9a-f]{32}$/;
const MIN_GEE1_BYTES = 4 + 12 + 16;

interface LocalRecordMeta extends CloudRecordMeta {
    readonly filename?: string;
}

interface LocalVaultManifest {
    readonly schema: 'e2ee-vault-manifest';
    readonly version: 1;
    readonly ownerSubject: string;
    readonly keyFingerprint?: string;
    readonly nextSeq: number;
    readonly usedBytes: number;
    readonly records: Record<string, LocalRecordMeta>;
}

function emptyManifest(): LocalVaultManifest {
    return {
        schema: 'e2ee-vault-manifest',
        version: 1,
        ownerSubject: LOCAL_VAULT_OWNER_SUBJECT,
        nextSeq: 1,
        usedBytes: 0,
        records: {},
    };
}

function hasValidGee1Magic(bytes: Uint8Array): boolean {
    if (bytes.byteLength < MIN_GEE1_BYTES) return false;
    for (let i = 0; i < CLOUD_WIRE_MAGIC.length; i++) {
        if (bytes[i] !== CLOUD_WIRE_MAGIC[i]) return false;
    }
    return true;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return bytesToHex(digest);
}

function isNotFoundError(error: unknown): boolean {
    return error instanceof Error && error.name === 'NotFoundError';
}

function parseMetaRecord(raw: unknown): LocalRecordMeta | null {
    if (!isRecord(raw)
        || typeof raw.blindRecordId !== 'string' || !BLIND_ID_PATTERN.test(raw.blindRecordId)
        || typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision) || raw.revision < 1
        || typeof raw.changeSeq !== 'number' || !Number.isSafeInteger(raw.changeSeq) || raw.changeSeq < 1
        || typeof raw.byteLength !== 'number' || !Number.isSafeInteger(raw.byteLength) || raw.byteLength < MIN_GEE1_BYTES
        || typeof raw.sha256 !== 'string' || !BLIND_ID_PATTERN.test(raw.sha256)
        || typeof raw.updatedAt !== 'number' || !Number.isSafeInteger(raw.updatedAt)) {
        return null;
    }
    if (raw.filename !== undefined && (typeof raw.filename !== 'string'
        || !new RegExp(`^${raw.blindRecordId}\\.[0-9a-f-]{36}\\.gee1$`).test(raw.filename))) return null;
    return {
        blindRecordId: raw.blindRecordId,
        revision: raw.revision,
        changeSeq: raw.changeSeq,
        byteLength: raw.byteLength,
        sha256: raw.sha256,
        updatedAt: raw.updatedAt,
        ...(typeof raw.filename === 'string' ? { filename: raw.filename } : {}),
    };
}

async function readManifestFromDir(rootDir: DirectoryHandle): Promise<LocalVaultManifest> {
    let fileHandle: FileSystemFileHandle;
    try {
        fileHandle = await rootDir.getFileHandle(MANIFEST_FILENAME, { create: false });
    } catch (error) {
        if (isNotFoundError(error)) return emptyManifest();
        throw new OperationError('FILE_WRITE_FAILED', 'Failed to open local vault-manifest.json', undefined, { cause: error });
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text.trim()) return emptyManifest();
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new OperationError('CLOUD_PAYLOAD_INVALID', 'Corrupted vault-manifest.json in local encrypted folder', undefined, { cause: error });
    }
    if (!isRecord(parsed)
        || parsed.schema !== 'e2ee-vault-manifest'
        || parsed.version !== 1
        || typeof parsed.nextSeq !== 'number' || !Number.isSafeInteger(parsed.nextSeq) || parsed.nextSeq < 1
        || !isRecord(parsed.records)) {
        throw new OperationError('CLOUD_PAYLOAD_INVALID', 'Invalid vault-manifest.json schema in local encrypted folder');
    }
    const records: Record<string, LocalRecordMeta> = {};
    let computedBytes = 0;
    for (const [key, val] of Object.entries(parsed.records)) {
        const meta = parseMetaRecord(val);
        if (!meta || meta.blindRecordId !== key) {
            throw new OperationError('CLOUD_PAYLOAD_INVALID', `Invalid record entry in vault-manifest.json: ${key}`);
        }
        records[key] = meta;
        computedBytes += meta.byteLength;
    }
    const keyFingerprint = typeof parsed.keyFingerprint === 'string' && KEY_FP_PATTERN.test(parsed.keyFingerprint)
        ? parsed.keyFingerprint
        : undefined;
    if (!keyFingerprint && (parsed.keyFingerprint !== undefined || Object.keys(records).length > 0)) {
        throw new OperationError('CLOUD_PAYLOAD_INVALID', 'Vault manifest requires a valid key fingerprint');
    }
    return {
        schema: 'e2ee-vault-manifest',
        version: 1,
        ownerSubject: LOCAL_VAULT_OWNER_SUBJECT,
        ...(keyFingerprint ? { keyFingerprint } : {}),
        nextSeq: parsed.nextSeq,
        usedBytes: computedBytes,
        records,
    };
}

async function writeBytesToFile(dir: FileSystemDirectoryHandle, filename: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    try {
        const fileHandle = await dir.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(bytes);
        await writable.close();
    } catch (error) {
        throw new OperationError('FILE_WRITE_FAILED', `Failed writing encrypted vault file ${filename}`, undefined, { cause: error });
    }
}

async function writeManifestToDir(rootDir: DirectoryHandle, manifest: LocalVaultManifest): Promise<void> {
    const encoded = new Uint8Array(new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
    await writeBytesToFile(rootDir, MANIFEST_FILENAME, encoded);
}

function recordFilename(meta: LocalRecordMeta): string {
    return meta.filename ?? `${meta.blindRecordId}.gee1`;
}

async function removeRecordFile(dir: FileSystemDirectoryHandle, filename: string): Promise<void> {
    try {
        await dir.removeEntry(filename);
    } catch {
        // Orphan cleanup must not affect the committed manifest.
    }
}

async function withVaultLock<T>(work: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
        return navigator.locks.request(LOCAL_VAULT_LOCK, () => work());
    }
    return work();
}

/**
 * Local Encrypted Folder implementation of `VaultRecordClient`.
 * Stores identical `GEE1` zero-knowledge `AES-256-GCM` ciphertexts in `records/`
 * and blind sequence metadata (`vault-manifest.json`) directly in a user-chosen local folder.
 */
export function createLocalFolderVaultClient(
    resolveDirectory: () => Promise<DirectoryHandle>,
    now: () => number = Date.now,
): VaultRecordClient {
    const requireWritableDirectory = async (): Promise<DirectoryHandle> => {
        const handle = await resolveDirectory();
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
            throw new OperationError(
                'DIRECTORY_PERMISSION_REQUIRED',
                'Local Encrypted Vault folder requires read/write permission',
            );
        }
        return handle;
    };

    return {
        async getVaultStatus() {
            return withVaultLock(async () => {
                const dir = await requireWritableDirectory();
                const manifest = await readManifestFromDir(dir);
                return {
                    ownerSubject: LOCAL_VAULT_OWNER_SUBJECT,
                    recordCount: Object.keys(manifest.records).length,
                    usedBytes: manifest.usedBytes,
                    quotaBytes: Number.MAX_SAFE_INTEGER,
                    headSeq: manifest.nextSeq - 1,
                    ...(manifest.keyFingerprint ? { keyFingerprint: manifest.keyFingerprint } : {}),
                };
            });
        },

        async putEncryptedRecord(input) {
            if (!BLIND_ID_PATTERN.test(input.blindRecordId)) {
                throw new OperationError('CLOUD_ENVELOPE_INVALID', 'Invalid blindRecordId');
            }
            if (!KEY_FP_PATTERN.test(input.keyFingerprint)) {
                throw new OperationError('CLOUD_ENVELOPE_INVALID', 'Invalid vault key fingerprint');
            }
            if (input.envelope.byteLength > CLOUD_MAX_RECORD_BYTES) {
                throw new OperationError('CLOUD_RECORD_TOO_LARGE', 'Encrypted record exceeds 2 MiB ceiling');
            }
            if (!hasValidGee1Magic(input.envelope)) {
                throw new OperationError('CLOUD_ENVELOPE_INVALID', 'Refusing to write non-GEE1 plaintext payload to local vault');
            }
            const actualSha = await sha256Hex(input.envelope);
            if (actualSha !== input.sha256) {
                throw new OperationError('CLOUD_ENVELOPE_INVALID', 'Ciphertext SHA-256 mismatch before disk write');
            }

            return withVaultLock(async () => {
                input.signal?.throwIfAborted();
                const rootDir = await requireWritableDirectory();
                const manifest = await readManifestFromDir(rootDir);
                if (manifest.keyFingerprint && manifest.keyFingerprint !== input.keyFingerprint) {
                    throw new OperationError(
                        'CLOUD_KEY_MISMATCH',
                        'This vault is encrypted with a different Master Key. Import the original Recovery Key to unlock it.',
                    );
                }
                const existing = manifest.records[input.blindRecordId];
                const currentRevision = existing?.revision ?? 0;
                if (currentRevision !== input.expectedRevision) {
                    return { status: 'conflict', currentRevision };
                }

                const recordsDir = await rootDir.getDirectoryHandle(RECORDS_SUBDIR, { create: true });
                const filename = existing
                    ? `${input.blindRecordId}.${crypto.randomUUID()}.gee1`
                    : `${input.blindRecordId}.gee1`;

                const nextRevision = currentRevision + 1;
                const changeSeq = manifest.nextSeq;
                const meta: LocalRecordMeta = {
                    blindRecordId: input.blindRecordId,
                    revision: nextRevision,
                    changeSeq,
                    byteLength: input.envelope.byteLength,
                    sha256: actualSha,
                    updatedAt: now(),
                    ...(existing ? { filename } : {}),
                };
                const nextRecords: Record<string, LocalRecordMeta> = {
                    ...manifest.records,
                    [input.blindRecordId]: meta,
                };
                const nextUsedBytes = manifest.usedBytes - (existing?.byteLength ?? 0) + meta.byteLength;
                try {
                    await writeBytesToFile(recordsDir, filename, input.envelope);
                    await writeManifestToDir(rootDir, {
                        ...manifest,
                        keyFingerprint: input.keyFingerprint,
                        nextSeq: changeSeq + 1,
                        usedBytes: nextUsedBytes,
                        records: nextRecords,
                    });
                } catch (error) {
                    await removeRecordFile(recordsDir, filename);
                    throw error;
                }
                if (existing) await removeRecordFile(recordsDir, recordFilename(existing));

                return { status: 'committed', meta };
            });
        },

        async getEncryptedRecord(input) {
            if (!BLIND_ID_PATTERN.test(input.blindRecordId)) {
                throw new OperationError('CLOUD_ENVELOPE_INVALID', 'Invalid blindRecordId');
            }
            return withVaultLock(async () => {
                input.signal?.throwIfAborted();
                const rootDir = await requireWritableDirectory();
                const manifest = await readManifestFromDir(rootDir);
                const meta = manifest.records[input.blindRecordId];
                if (!meta) return null;

                let fileHandle: FileSystemFileHandle;
                try {
                    const recordsDir = await rootDir.getDirectoryHandle(RECORDS_SUBDIR, { create: false });
                    fileHandle = await recordsDir.getFileHandle(recordFilename(meta), { create: false });
                } catch (error) {
                    if (isNotFoundError(error)) return null;
                    throw new OperationError('FILE_WRITE_FAILED', 'Failed reading local encrypted .gee1 file', undefined, { cause: error });
                }
                const bytes = new Uint8Array(await (await fileHandle.getFile()).arrayBuffer());
                const actualSha = await sha256Hex(bytes);
                if (actualSha !== meta.sha256) {
                    throw new OperationError('CLOUD_DECRYPT_AUTH_FAILED', 'Local .gee1 file SHA-256 integrity check failed');
                }
                return {
                    revision: meta.revision,
                    changeSeq: meta.changeSeq,
                    sha256: meta.sha256,
                    envelope: bytes,
                };
            });
        },

        async listChanges(input) {
            return withVaultLock(async () => {
                input.signal?.throwIfAborted();
                const rootDir = await requireWritableDirectory();
                const manifest = await readManifestFromDir(rootDir);
                const clampedLimit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 100)));
                const headSeq = manifest.nextSeq - 1;
                const sorted = Object.values(manifest.records)
                    .filter(r => r.changeSeq > input.sinceSeq)
                    .sort((a, b) => a.changeSeq - b.changeSeq);
                const hasMore = sorted.length > clampedLimit;
                const items = hasMore ? sorted.slice(0, clampedLimit) : sorted;
                const nextSince = items.length > 0 ? items[items.length - 1].changeSeq : input.sinceSeq;
                return { items, nextSince, headSeq, hasMore };
            });
        },

        async purgeVault() {
            await withVaultLock(async () => {
                const rootDir = await requireWritableDirectory();
                try {
                    await rootDir.removeEntry(RECORDS_SUBDIR, { recursive: true });
                } catch (error) {
                    if (!isNotFoundError(error)) throw error;
                }
                await writeManifestToDir(rootDir, emptyManifest());
            });
        },
    };
}
