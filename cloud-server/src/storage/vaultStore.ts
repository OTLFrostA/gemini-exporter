import type { CloudChangesResponse, CloudRecordMeta, CloudVaultStatusResponse } from '../../../src/shared/types/cloudSync.js';

export interface D1PreparedStatementLike {
    bind(...values: readonly unknown[]): D1PreparedStatementLike;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta: { changes?: number } }>;
}

export interface D1DatabaseLike {
    prepare(query: string): D1PreparedStatementLike;
    batch(statements: readonly D1PreparedStatementLike[]): Promise<Array<{ results?: unknown[]; meta?: { changes?: number } }>>;
}

export interface R2ObjectBodyLike {
    arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2BucketLike {
    put(key: string, value: Uint8Array | ArrayBuffer): Promise<unknown>;
    get(key: string): Promise<R2ObjectBodyLike | null>;
    delete(keys: string | string[]): Promise<void>;
}

export interface VaultUserRow {
    readonly ownerSubject: string;
    readonly tokenEpoch: number;
    readonly keyFingerprint?: string;
    readonly usedBytes: number;
    readonly quotaBytes: number;
    readonly headSeq: number;
}

export type PutRecordOutcome =
    | { readonly status: 'committed'; readonly meta: CloudRecordMeta }
    | { readonly status: 'conflict'; readonly currentRevision: number }
    | { readonly status: 'key_mismatch'; readonly vaultKeyFingerprint: string }
    | { readonly status: 'quota_exceeded'; readonly usedBytes: number; readonly quotaBytes: number };

export interface VaultStore {
    ensureUser(ownerSubject: string, defaultQuotaBytes: number, nowMs?: number): Promise<VaultUserRow>;
    getUser(ownerSubject: string): Promise<VaultUserRow | null>;
    rotateUserTokenEpoch(ownerSubject: string, nowMs?: number): Promise<number>;
    getVaultStatus(ownerSubject: string): Promise<CloudVaultStatusResponse | null>;
    putRecord(input: {
        readonly ownerSubject: string;
        readonly blindRecordId: string;
        readonly expectedRevision: number;
        readonly ciphertext: Uint8Array<ArrayBuffer>;
        readonly sha256: string;
        readonly keyFingerprint?: string;
        readonly nowMs?: number;
    }): Promise<PutRecordOutcome>;
    getRecord(ownerSubject: string, blindRecordId: string): Promise<{ meta: CloudRecordMeta; ciphertext: Uint8Array<ArrayBuffer> } | null>;
    listChanges(ownerSubject: string, sinceSeq: number, limit: number): Promise<CloudChangesResponse>;
    purgeVault(ownerSubject: string, nowMs?: number): Promise<void>;
}

function buildVersionedR2Key(ownerSubject: string, blindRecordId: string, revision: number): string {
    return `v1/${encodeURIComponent(ownerSubject)}/${blindRecordId}/r${revision}`;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    let hex = '';
    for (const byte of digest) {
        hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
}

function readSafeInt(row: Record<string, unknown>, field: string): number {
    const val: unknown = row[field];
    if (typeof val !== 'number' || !Number.isSafeInteger(val)) {
        throw new Error(`Invalid integer column ${field} in D1 result`);
    }
    return val;
}

function readText(row: Record<string, unknown>, field: string): string {
    const val: unknown = row[field];
    if (typeof val !== 'string') {
        throw new Error(`Invalid text column ${field} in D1 result`);
    }
    return val;
}

/**
 * Production Cloudflare D1 + R2 storage engine using immutable versioned R2 object keys
 * (`v1/<subject>/<blindId>/r<rev>`) and atomic D1 `batch()` optimistic-concurrency swaps.
 */
export function createCloudflareVaultStore(db: D1DatabaseLike, bucket: R2BucketLike): VaultStore {
    const getUser = async (ownerSubject: string): Promise<VaultUserRow | null> => {
        const row = await db
            .prepare('SELECT user_id, token_epoch, key_fingerprint, used_bytes, quota_bytes, next_seq FROM users WHERE user_id = ?1')
            .bind(ownerSubject)
            .first<Record<string, unknown>>();
        if (!row) return null;
        const fp = typeof row.key_fingerprint === 'string' && row.key_fingerprint ? row.key_fingerprint : undefined;
        return {
            ownerSubject: readText(row, 'user_id'),
            tokenEpoch: readSafeInt(row, 'token_epoch'),
            ...(fp ? { keyFingerprint: fp } : {}),
            usedBytes: readSafeInt(row, 'used_bytes'),
            quotaBytes: readSafeInt(row, 'quota_bytes'),
            headSeq: readSafeInt(row, 'next_seq') - 1,
        };
    };

    return {
        async ensureUser(ownerSubject, defaultQuotaBytes, nowMs = Date.now()) {
            await db
                .prepare(
                    'INSERT INTO users (user_id, token_epoch, used_bytes, quota_bytes, next_seq, created_at, updated_at) ' +
                    'VALUES (?1, 1, 0, ?2, 1, ?3, ?3) ON CONFLICT(user_id) DO NOTHING',
                )
                .bind(ownerSubject, defaultQuotaBytes, nowMs)
                .run();
            const user = await getUser(ownerSubject);
            if (!user) throw new Error('Failed to persist user row in D1');
            return user;
        },

        getUser,

        async rotateUserTokenEpoch(ownerSubject, nowMs = Date.now()) {
            await db
                .prepare('UPDATE users SET token_epoch = token_epoch + 1, updated_at = ?2 WHERE user_id = ?1')
                .bind(ownerSubject, nowMs)
                .run();
            const updated = await getUser(ownerSubject);
            if (!updated) throw new Error('User not found during token epoch rotation');
            return updated.tokenEpoch;
        },

        async getVaultStatus(ownerSubject) {
            const user = await getUser(ownerSubject);
            if (!user) return null;
            const countRow = await db
                .prepare('SELECT COUNT(*) AS cnt FROM vault_records WHERE user_id = ?1')
                .bind(ownerSubject)
                .first<Record<string, unknown>>();
            const recordCount = countRow ? readSafeInt(countRow, 'cnt') : 0;
            return {
                ownerSubject,
                recordCount,
                usedBytes: user.usedBytes,
                quotaBytes: user.quotaBytes,
                headSeq: user.headSeq,
                ...(user.keyFingerprint ? { keyFingerprint: user.keyFingerprint } : {}),
            };
        },

        async putRecord(input) {
            const nowMs = input.nowMs ?? Date.now();
            const newSize = input.ciphertext.byteLength;
            const nextRevision = input.expectedRevision + 1;
            const newR2Key = buildVersionedR2Key(input.ownerSubject, input.blindRecordId, nextRevision);

            const [user, existing] = await Promise.all([
                getUser(input.ownerSubject),
                db.prepare(
                    'SELECT revision, byte_length, r2_key FROM vault_records WHERE user_id = ?1 AND blind_record_id = ?2',
                )
                    .bind(input.ownerSubject, input.blindRecordId)
                    .first<Record<string, unknown>>(),
            ]);
            if (!user) throw new Error('User does not exist');

            if (user.keyFingerprint && input.keyFingerprint && user.keyFingerprint !== input.keyFingerprint) {
                return { status: 'key_mismatch', vaultKeyFingerprint: user.keyFingerprint };
            }

            const currentRevision = existing ? readSafeInt(existing, 'revision') : 0;
            if (currentRevision !== input.expectedRevision) {
                return { status: 'conflict', currentRevision };
            }
            const previousBytes = existing ? readSafeInt(existing, 'byte_length') : 0;
            const previousR2Key = existing ? readText(existing, 'r2_key') : null;
            const projectedUsedBytes = user.usedBytes - previousBytes + newSize;
            if (projectedUsedBytes > user.quotaBytes) {
                return { status: 'quota_exceeded', usedBytes: user.usedBytes, quotaBytes: user.quotaBytes };
            }

            // Stage immutable versioned blob in R2 BEFORE swapping the D1 metadata pointer.
            await bucket.put(newR2Key, input.ciphertext);

            const nextKeyFp = user.keyFingerprint ?? input.keyFingerprint ?? null;
            const deltaBytes = newSize - previousBytes;
            let batchResults: Array<{ meta?: { changes?: number } }>;
            try {
                if (input.expectedRevision === 0) {
                    batchResults = await db.batch([
                        db.prepare(
                            'INSERT INTO vault_records (user_id, blind_record_id, revision, change_seq, byte_length, sha256_hex, r2_key, updated_at) ' +
                            'SELECT ?1, ?2, 1, next_seq, ?3, ?4, ?5, ?6 FROM users ' +
                            'WHERE user_id = ?1 AND used_bytes + ?3 <= quota_bytes ' +
                            'AND (key_fingerprint IS NULL OR ?7 IS NULL OR key_fingerprint = ?7) ' +
                            'AND NOT EXISTS (SELECT 1 FROM vault_records WHERE user_id = ?1 AND blind_record_id = ?2)',
                        ).bind(input.ownerSubject, input.blindRecordId, newSize, input.sha256, newR2Key, nowMs, nextKeyFp),
                        db.prepare(
                            'UPDATE users SET used_bytes = used_bytes + ?2, next_seq = next_seq + 1, ' +
                            'key_fingerprint = COALESCE(key_fingerprint, ?4), updated_at = ?3 ' +
                            'WHERE user_id = ?1 AND changes() = 1',
                        ).bind(input.ownerSubject, deltaBytes, nowMs, nextKeyFp),
                    ]);
                } else {
                    batchResults = await db.batch([
                        db.prepare(
                            'UPDATE vault_records SET revision = ?3, ' +
                            'change_seq = (SELECT next_seq FROM users WHERE user_id = ?1), ' +
                            'byte_length = ?4, sha256_hex = ?5, r2_key = ?6, updated_at = ?7 ' +
                            'WHERE user_id = ?1 AND blind_record_id = ?2 AND revision = ?8 ' +
                            'AND (SELECT used_bytes + ?9 <= quota_bytes AND (key_fingerprint IS NULL OR ?10 IS NULL OR key_fingerprint = ?10) FROM users WHERE user_id = ?1)',
                        ).bind(
                            input.ownerSubject,
                            input.blindRecordId,
                            nextRevision,
                            newSize,
                            input.sha256,
                            newR2Key,
                            nowMs,
                            input.expectedRevision,
                            deltaBytes,
                            nextKeyFp,
                        ),
                        db.prepare(
                            'UPDATE users SET used_bytes = used_bytes + ?2, next_seq = next_seq + 1, ' +
                            'key_fingerprint = COALESCE(key_fingerprint, ?4), updated_at = ?3 ' +
                            'WHERE user_id = ?1 AND changes() = 1',
                        ).bind(input.ownerSubject, deltaBytes, nowMs, nextKeyFp),
                    ]);
                }
            } catch (error) {
                await bucket.delete(newR2Key).catch(() => {});
                throw error;
            }

            const recordChanges = batchResults[0]?.meta?.changes ?? 0;
            if (recordChanges !== 1) {
                await bucket.delete(newR2Key).catch(() => {});
                const [latestUser, latestRow] = await Promise.all([
                    getUser(input.ownerSubject),
                    db.prepare('SELECT revision FROM vault_records WHERE user_id = ?1 AND blind_record_id = ?2')
                        .bind(input.ownerSubject, input.blindRecordId)
                        .first<Record<string, unknown>>(),
                ]);
                if (latestUser?.keyFingerprint && input.keyFingerprint && latestUser.keyFingerprint !== input.keyFingerprint) {
                    return { status: 'key_mismatch', vaultKeyFingerprint: latestUser.keyFingerprint };
                }
                const latestRevision = latestRow ? readSafeInt(latestRow, 'revision') : 0;
                if (latestRevision !== input.expectedRevision) {
                    return { status: 'conflict', currentRevision: latestRevision };
                }
                return {
                    status: 'quota_exceeded',
                    usedBytes: latestUser?.usedBytes ?? user.usedBytes,
                    quotaBytes: latestUser?.quotaBytes ?? user.quotaBytes,
                };
            }

            if (previousR2Key && previousR2Key !== newR2Key) {
                await bucket.delete(previousR2Key).catch(() => {});
            }

            const committed = await db
                .prepare('SELECT change_seq FROM vault_records WHERE user_id = ?1 AND blind_record_id = ?2')
                .bind(input.ownerSubject, input.blindRecordId)
                .first<Record<string, unknown>>();
            const changeSeq = committed ? readSafeInt(committed, 'change_seq') : user.headSeq + 1;

            return {
                status: 'committed',
                meta: {
                    blindRecordId: input.blindRecordId,
                    revision: nextRevision,
                    changeSeq,
                    byteLength: newSize,
                    sha256: input.sha256,
                    updatedAt: nowMs,
                },
            };
        },

        async getRecord(ownerSubject, blindRecordId) {
            const row = await db
                .prepare(
                    'SELECT blind_record_id, revision, change_seq, byte_length, sha256_hex, r2_key, updated_at ' +
                    'FROM vault_records WHERE user_id = ?1 AND blind_record_id = ?2',
                )
                .bind(ownerSubject, blindRecordId)
                .first<Record<string, unknown>>();
            if (!row) return null;
            const r2Key = readText(row, 'r2_key');
            const object = await bucket.get(r2Key);
            if (!object) throw new Error('R2 ciphertext blob missing for committed D1 record');
            const ciphertext = new Uint8Array(await object.arrayBuffer());
            const meta: CloudRecordMeta = {
                blindRecordId: readText(row, 'blind_record_id'),
                revision: readSafeInt(row, 'revision'),
                changeSeq: readSafeInt(row, 'change_seq'),
                byteLength: readSafeInt(row, 'byte_length'),
                sha256: readText(row, 'sha256_hex'),
                updatedAt: readSafeInt(row, 'updated_at'),
            };
            return { meta, ciphertext };
        },

        async listChanges(ownerSubject, sinceSeq, limit) {
            const clampedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
            const [user, queryResult] = await Promise.all([
                getUser(ownerSubject),
                db.prepare(
                    'SELECT blind_record_id, revision, change_seq, byte_length, sha256_hex, updated_at ' +
                    'FROM vault_records WHERE user_id = ?1 AND change_seq > ?2 ' +
                    'ORDER BY change_seq ASC LIMIT ?3',
                )
                    .bind(ownerSubject, sinceSeq, clampedLimit + 1)
                    .all<Record<string, unknown>>(),
            ]);
            const headSeq = user?.headSeq ?? 0;
            const rows = queryResult.results;
            const hasMore = rows.length > clampedLimit;
            const slice = hasMore ? rows.slice(0, clampedLimit) : rows;
            const items: CloudRecordMeta[] = slice.map(row => ({
                blindRecordId: readText(row, 'blind_record_id'),
                revision: readSafeInt(row, 'revision'),
                changeSeq: readSafeInt(row, 'change_seq'),
                byteLength: readSafeInt(row, 'byte_length'),
                sha256: readText(row, 'sha256_hex'),
                updatedAt: readSafeInt(row, 'updated_at'),
            }));
            const nextSince = items.length > 0 ? items[items.length - 1].changeSeq : sinceSeq;
            return { items, nextSince, headSeq, hasMore };
        },

        async purgeVault(ownerSubject, nowMs = Date.now()) {
            const keysResult = await db
                .prepare('SELECT r2_key FROM vault_records WHERE user_id = ?1')
                .bind(ownerSubject)
                .all<Record<string, unknown>>();
            const r2Keys = keysResult.results.map(r => readText(r, 'r2_key'));
            await db.batch([
                db.prepare('DELETE FROM vault_records WHERE user_id = ?1').bind(ownerSubject),
                db.prepare('UPDATE users SET used_bytes = 0, key_fingerprint = NULL, updated_at = ?2 WHERE user_id = ?1').bind(ownerSubject, nowMs),
            ]);
            for (let i = 0; i < r2Keys.length; i += 500) {
                await bucket.delete(r2Keys.slice(i, i + 500)).catch(() => {});
            }
        },
    };
}

/**
 * Exact behavioral in-memory reference VaultStore for deterministic CI / E2E testing
 * and local standalone development without requiring Cloudflare credentials.
 */
export function createInMemoryVaultStore(): VaultStore & {
    /** Test-only inspection hook to prove zero plaintext leaks in stored blobs/rows. */
    inspectRawBlobs(): ReadonlyMap<string, Uint8Array>;
} {
    interface MemoryUser {
        tokenEpoch: number;
        keyFingerprint?: string;
        usedBytes: number;
        quotaBytes: number;
        nextSeq: number;
    }
    interface MemoryRecord {
        meta: CloudRecordMeta;
        r2Key: string;
    }

    const users = new Map<string, MemoryUser>();
    const recordsByUser = new Map<string, Map<string, MemoryRecord>>();
    const blobs = new Map<string, Uint8Array<ArrayBuffer>>();

    const toUserRow = (ownerSubject: string, u: MemoryUser): VaultUserRow => ({
        ownerSubject,
        tokenEpoch: u.tokenEpoch,
        ...(u.keyFingerprint ? { keyFingerprint: u.keyFingerprint } : {}),
        usedBytes: u.usedBytes,
        quotaBytes: u.quotaBytes,
        headSeq: u.nextSeq - 1,
    });

    return {
        inspectRawBlobs: () => blobs,

        async ensureUser(ownerSubject, defaultQuotaBytes) {
            let user = users.get(ownerSubject);
            if (!user) {
                user = { tokenEpoch: 1, usedBytes: 0, quotaBytes: defaultQuotaBytes, nextSeq: 1 };
                users.set(ownerSubject, user);
                recordsByUser.set(ownerSubject, new Map());
            }
            return toUserRow(ownerSubject, user);
        },

        async getUser(ownerSubject) {
            const user = users.get(ownerSubject);
            return user ? toUserRow(ownerSubject, user) : null;
        },

        async rotateUserTokenEpoch(ownerSubject) {
            const user = users.get(ownerSubject);
            if (!user) throw new Error('User not found');
            user.tokenEpoch += 1;
            return user.tokenEpoch;
        },

        async getVaultStatus(ownerSubject) {
            const user = users.get(ownerSubject);
            if (!user) return null;
            const userRecords = recordsByUser.get(ownerSubject);
            return {
                ownerSubject,
                recordCount: userRecords?.size ?? 0,
                usedBytes: user.usedBytes,
                quotaBytes: user.quotaBytes,
                headSeq: user.nextSeq - 1,
                ...(user.keyFingerprint ? { keyFingerprint: user.keyFingerprint } : {}),
            };
        },

        async putRecord(input) {
            const nowMs = input.nowMs ?? Date.now();
            const user = users.get(input.ownerSubject);
            if (!user) throw new Error('User does not exist');
            if (user.keyFingerprint && input.keyFingerprint && user.keyFingerprint !== input.keyFingerprint) {
                return { status: 'key_mismatch', vaultKeyFingerprint: user.keyFingerprint };
            }
            let userRecords = recordsByUser.get(input.ownerSubject);
            if (!userRecords) {
                userRecords = new Map();
                recordsByUser.set(input.ownerSubject, userRecords);
            }
            const existing = userRecords.get(input.blindRecordId);
            const currentRevision = existing?.meta.revision ?? 0;
            if (currentRevision !== input.expectedRevision) {
                return { status: 'conflict', currentRevision };
            }
            const previousBytes = existing?.meta.byteLength ?? 0;
            const nextBytes = user.usedBytes - previousBytes + input.ciphertext.byteLength;
            if (nextBytes > user.quotaBytes) {
                return { status: 'quota_exceeded', usedBytes: user.usedBytes, quotaBytes: user.quotaBytes };
            }
            const nextRevision = currentRevision + 1;
            const changeSeq = user.nextSeq++;
            const r2Key = buildVersionedR2Key(input.ownerSubject, input.blindRecordId, nextRevision);
            const copy = new Uint8Array(input.ciphertext.byteLength);
            copy.set(input.ciphertext);
            blobs.set(r2Key, copy);
            if (existing) blobs.delete(existing.r2Key);
            if (!user.keyFingerprint && input.keyFingerprint) {
                user.keyFingerprint = input.keyFingerprint;
            }
            user.usedBytes = nextBytes;
            const meta: CloudRecordMeta = {
                blindRecordId: input.blindRecordId,
                revision: nextRevision,
                changeSeq,
                byteLength: copy.byteLength,
                sha256: input.sha256,
                updatedAt: nowMs,
            };
            userRecords.set(input.blindRecordId, { meta, r2Key });
            return { status: 'committed', meta };
        },

        async getRecord(ownerSubject, blindRecordId) {
            const record = recordsByUser.get(ownerSubject)?.get(blindRecordId);
            if (!record) return null;
            const stored = blobs.get(record.r2Key);
            if (!stored) throw new Error('Missing stored ciphertext blob');
            const copy = new Uint8Array(stored.byteLength);
            copy.set(stored);
            return { meta: { ...record.meta }, ciphertext: copy };
        },

        async listChanges(ownerSubject, sinceSeq, limit) {
            const clampedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
            const user = users.get(ownerSubject);
            const headSeq = user ? user.nextSeq - 1 : 0;
            const all = [...(recordsByUser.get(ownerSubject)?.values() ?? [])]
                .map(r => r.meta)
                .filter(m => m.changeSeq > sinceSeq)
                .sort((a, b) => a.changeSeq - b.changeSeq);
            const hasMore = all.length > clampedLimit;
            const items = (hasMore ? all.slice(0, clampedLimit) : all).map(m => ({ ...m }));
            const nextSince = items.length > 0 ? items[items.length - 1].changeSeq : sinceSeq;
            return { items, nextSince, headSeq, hasMore };
        },

        async purgeVault(ownerSubject) {
            const user = users.get(ownerSubject);
            const userRecords = recordsByUser.get(ownerSubject);
            if (userRecords) {
                for (const rec of userRecords.values()) blobs.delete(rec.r2Key);
                userRecords.clear();
            }
            if (user) {
                user.usedBytes = 0;
                user.keyFingerprint = undefined;
            }
        },
    };
}
