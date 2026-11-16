import type { CloudChangesResponse, CloudRecordMeta, CloudVaultStatusResponse } from '../../../src/shared/types/cloudSync.js';
import type { PutRecordOutcome, VaultStore, VaultUserRow } from './vaultStore.js';

export interface SqlStorageCursorLike {
    toArray(): Array<Record<string, unknown>>;
}

export interface SqlStorageLike {
    exec(query: string, ...bindings: unknown[]): SqlStorageCursorLike;
}

export interface DurableObjectStorageLike {
    readonly sql: SqlStorageLike;
    transactionSync<T>(closure: () => T): T;
}

export interface DurableObjectStateLike {
    readonly storage: DurableObjectStorageLike;
}

export interface DurableObjectIdLike {
    toString(): string;
}

export interface DurableObjectStubLike {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
    idFromName(name: string): DurableObjectIdLike;
    get(id: DurableObjectIdLike): DurableObjectStubLike;
}

const CHUNK_SIZE_BYTES = 512 * 1024; // 512 KiB chunks keep every SQLite row well below the 2 MiB row ceiling

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readInt(row: Record<string, unknown>, key: string): number {
    const v = row[key];
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
        throw new Error(`Invalid integer column ${key} in Durable Object SQLite`);
    }
    return v;
}

function readStr(row: Record<string, unknown>, key: string): string {
    const v = row[key];
    if (typeof v !== 'string') {
        throw new Error(`Invalid text column ${key} in Durable Object SQLite`);
    }
    return v;
}

function constantTimeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

function toBytes(raw: unknown): Uint8Array<ArrayBuffer> {
    if (raw instanceof ArrayBuffer) {
        return new Uint8Array(raw);
    }
    if (ArrayBuffer.isView(raw)) {
        const copy = new Uint8Array(raw.byteLength);
        copy.set(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
        return copy;
    }
    throw new Error('Expected binary BLOB column in Durable Object SQLite');
}

/**
 * Per-tenant SQLite-backed Cloudflare Durable Object (`new_sqlite_classes = ["VaultTenantDO"]`).
 * Each `ownerSubject` (`vault:<keyFingerprint>`) maps to its own isolated single-threaded SQLite instance:
 * - Zero external D1 / R2 setup or credit card required (included in Cloudflare Workers Free plan)
 * - Strongly consistent synchronous ACID transactions with zero cross-tenant lock contention
 */
export class VaultTenantDO {
    private readonly sql: SqlStorageLike;
    private readonly storage: DurableObjectStorageLike;
    private initialized = false;

    constructor(state: DurableObjectStateLike) {
        this.storage = state.storage;
        this.sql = state.storage.sql;
    }

    private ensureSchema(): void {
        if (this.initialized) return;
        this.sql.exec(
            'CREATE TABLE IF NOT EXISTS tenant_meta (' +
            '  id INTEGER PRIMARY KEY CHECK (id = 1),' +
            '  owner_subject TEXT NOT NULL,' +
            '  token_epoch INTEGER NOT NULL DEFAULT 1,' +
            '  key_fingerprint TEXT,' +
            '  auth_verifier_hash TEXT,' +
            '  used_bytes INTEGER NOT NULL DEFAULT 0,' +
            '  quota_bytes INTEGER NOT NULL,' +
            '  next_seq INTEGER NOT NULL DEFAULT 1,' +
            '  created_at INTEGER NOT NULL,' +
            '  updated_at INTEGER NOT NULL' +
            ')',
        );
        this.sql.exec(
            'CREATE TABLE IF NOT EXISTS records (' +
            '  blind_record_id TEXT PRIMARY KEY,' +
            '  revision INTEGER NOT NULL,' +
            '  change_seq INTEGER NOT NULL,' +
            '  byte_length INTEGER NOT NULL,' +
            '  sha256_hex TEXT NOT NULL,' +
            '  chunk_count INTEGER NOT NULL,' +
            '  updated_at INTEGER NOT NULL' +
            ')',
        );
        this.sql.exec('CREATE INDEX IF NOT EXISTS idx_records_seq ON records (change_seq ASC)');
        this.sql.exec(
            'CREATE TABLE IF NOT EXISTS record_chunks (' +
            '  blind_record_id TEXT NOT NULL,' +
            '  chunk_idx INTEGER NOT NULL,' +
            '  data BLOB NOT NULL,' +
            '  PRIMARY KEY (blind_record_id, chunk_idx)' +
            ')',
        );
        this.initialized = true;
    }

    private readTenantRow(): VaultUserRow | null {
        const rows = this.sql
            .exec('SELECT owner_subject, token_epoch, key_fingerprint, auth_verifier_hash, used_bytes, quota_bytes, next_seq FROM tenant_meta WHERE id = 1')
            .toArray();
        const row = rows[0];
        if (!row) return null;
        const fp = typeof row.key_fingerprint === 'string' && row.key_fingerprint ? row.key_fingerprint : undefined;
        const verifier = typeof row.auth_verifier_hash === 'string' && row.auth_verifier_hash ? row.auth_verifier_hash : undefined;
        return {
            ownerSubject: readStr(row, 'owner_subject'),
            tokenEpoch: readInt(row, 'token_epoch'),
            ...(fp ? { keyFingerprint: fp } : {}),
            ...(verifier ? { authVerifierHash: verifier } : {}),
            usedBytes: readInt(row, 'used_bytes'),
            quotaBytes: readInt(row, 'quota_bytes'),
            headSeq: readInt(row, 'next_seq') - 1,
        };
    }

    async fetch(request: Request): Promise<Response> {
        this.ensureSchema();
        const url = new URL(request.url);
        const op = url.pathname;

        if (op === '/rpc/ensure-user' && request.method === 'POST') {
            const body: unknown = await request.json();
            if (!isPlainRecord(body) || typeof body.ownerSubject !== 'string' || typeof body.defaultQuotaBytes !== 'number') {
                return new Response('Bad Request', { status: 400 });
            }
            const nowMs = typeof body.nowMs === 'number' ? body.nowMs : Date.now();
            const user = this.storage.transactionSync(() => {
                this.sql.exec(
                    'INSERT INTO tenant_meta (id, owner_subject, token_epoch, used_bytes, quota_bytes, next_seq, created_at, updated_at) ' +
                    'VALUES (1, ?1, 1, 0, ?2, 1, ?3, ?3) ON CONFLICT(id) DO NOTHING',
                    body.ownerSubject,
                    body.defaultQuotaBytes,
                    nowMs,
                );
                return this.readTenantRow();
            });
            return Response.json({ user });
        }

        if (op === '/rpc/auth-key' && request.method === 'POST') {
            const body: unknown = await request.json();
            if (!isPlainRecord(body)
                || typeof body.ownerSubject !== 'string'
                || typeof body.keyFingerprint !== 'string'
                || typeof body.authVerifierHash !== 'string'
                || typeof body.defaultQuotaBytes !== 'number') {
                return new Response('Bad Request', { status: 400 });
            }
            const ownerSubject = body.ownerSubject;
            const keyFingerprint = body.keyFingerprint;
            const authVerifierHash = body.authVerifierHash;
            const defaultQuotaBytes = body.defaultQuotaBytes;
            const nowMs = typeof body.nowMs === 'number' ? body.nowMs : Date.now();
            const user = this.storage.transactionSync(() => {
                this.sql.exec(
                    'INSERT INTO tenant_meta (id, owner_subject, token_epoch, key_fingerprint, auth_verifier_hash, used_bytes, quota_bytes, next_seq, created_at, updated_at) ' +
                    'VALUES (1, ?1, 1, ?2, ?3, 0, ?4, 1, ?5, ?5) ON CONFLICT(id) DO NOTHING',
                    ownerSubject,
                    keyFingerprint,
                    authVerifierHash,
                    defaultQuotaBytes,
                    nowMs,
                );
                const existing = this.readTenantRow();
                if (!existing || !existing.authVerifierHash) return null;
                if (!constantTimeEqualHex(existing.authVerifierHash, authVerifierHash)) return null;
                return existing;
            });
            return Response.json({ user });
        }

        if (op === '/rpc/get-user' && request.method === 'GET') {
            return Response.json({ user: this.readTenantRow() });
        }

        if (op === '/rpc/rotate-epoch' && request.method === 'POST') {
            const body: unknown = await request.json();
            const nowMs = isPlainRecord(body) && typeof body.nowMs === 'number' ? body.nowMs : Date.now();
            const epoch = this.storage.transactionSync(() => {
                this.sql.exec('UPDATE tenant_meta SET token_epoch = token_epoch + 1, updated_at = ?1 WHERE id = 1', nowMs);
                const updated = this.readTenantRow();
                if (!updated) throw new Error('User not found');
                return updated.tokenEpoch;
            });
            return Response.json({ tokenEpoch: epoch });
        }

        if (op === '/rpc/status' && request.method === 'GET') {
            const user = this.readTenantRow();
            if (!user) return Response.json({ status: null });
            const cntRow = this.sql.exec('SELECT COUNT(*) AS cnt FROM records').toArray()[0];
            const recordCount = cntRow ? readInt(cntRow, 'cnt') : 0;
            const status: CloudVaultStatusResponse = {
                ownerSubject: user.ownerSubject,
                recordCount,
                usedBytes: user.usedBytes,
                quotaBytes: user.quotaBytes,
                headSeq: user.headSeq,
                ...(user.keyFingerprint ? { keyFingerprint: user.keyFingerprint } : {}),
            };
            return Response.json({ status });
        }

        if (op === '/rpc/put-record' && request.method === 'PUT') {
            const blindRecordId = request.headers.get('x-blind-id') ?? '';
            const expectedRevision = Number(request.headers.get('x-expected-rev') ?? '0');
            const sha256 = request.headers.get('x-sha256') ?? '';
            const keyFp = request.headers.get('x-key-fp') ?? undefined;
            const nowMs = Number(request.headers.get('x-now-ms') ?? String(Date.now()));
            const ciphertext = new Uint8Array(await request.arrayBuffer());

            const outcome = this.storage.transactionSync((): PutRecordOutcome => {
                const user = this.readTenantRow();
                if (!user) throw new Error('Tenant not initialized');
                if (user.keyFingerprint && keyFp && user.keyFingerprint !== keyFp) {
                    return { status: 'key_mismatch', vaultKeyFingerprint: user.keyFingerprint };
                }
                const existing = this.sql
                    .exec('SELECT revision, byte_length FROM records WHERE blind_record_id = ?1', blindRecordId)
                    .toArray()[0];
                const currentRevision = existing ? readInt(existing, 'revision') : 0;
                if (currentRevision !== expectedRevision) {
                    return { status: 'conflict', currentRevision };
                }
                const previousBytes = existing ? readInt(existing, 'byte_length') : 0;
                const nextUsedBytes = user.usedBytes - previousBytes + ciphertext.byteLength;
                if (nextUsedBytes > user.quotaBytes) {
                    return { status: 'quota_exceeded', usedBytes: user.usedBytes, quotaBytes: user.quotaBytes };
                }

                this.sql.exec('DELETE FROM record_chunks WHERE blind_record_id = ?1', blindRecordId);
                let chunkCount = 0;
                for (let offset = 0; offset < ciphertext.byteLength; offset += CHUNK_SIZE_BYTES) {
                    const end = Math.min(ciphertext.byteLength, offset + CHUNK_SIZE_BYTES);
                    const slice = ciphertext.slice(offset, end);
                    this.sql.exec(
                        'INSERT INTO record_chunks (blind_record_id, chunk_idx, data) VALUES (?1, ?2, ?3)',
                        blindRecordId,
                        chunkCount,
                        slice,
                    );
                    chunkCount++;
                }

                const nextRevision = currentRevision + 1;
                const changeSeq = user.headSeq + 1;
                this.sql.exec(
                    'INSERT INTO records (blind_record_id, revision, change_seq, byte_length, sha256_hex, chunk_count, updated_at) ' +
                    'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ' +
                    'ON CONFLICT(blind_record_id) DO UPDATE SET ' +
                    'revision = excluded.revision, change_seq = excluded.change_seq, byte_length = excluded.byte_length, ' +
                    'sha256_hex = excluded.sha256_hex, chunk_count = excluded.chunk_count, updated_at = excluded.updated_at',
                    blindRecordId,
                    nextRevision,
                    changeSeq,
                    ciphertext.byteLength,
                    sha256,
                    chunkCount,
                    nowMs,
                );
                const lockedFp = user.keyFingerprint ?? (keyFp || null);
                this.sql.exec(
                    'UPDATE tenant_meta SET used_bytes = ?1, next_seq = next_seq + 1, key_fingerprint = COALESCE(key_fingerprint, ?2), updated_at = ?3 WHERE id = 1',
                    nextUsedBytes,
                    lockedFp,
                    nowMs,
                );

                return {
                    status: 'committed',
                    meta: {
                        blindRecordId,
                        revision: nextRevision,
                        changeSeq,
                        byteLength: ciphertext.byteLength,
                        sha256,
                        updatedAt: nowMs,
                    },
                };
            });
            return Response.json(outcome);
        }

        if (op === '/rpc/get-record' && request.method === 'GET') {
            const blindRecordId = url.searchParams.get('id') ?? '';
            const row = this.sql
                .exec(
                    'SELECT blind_record_id, revision, change_seq, byte_length, sha256_hex, updated_at ' +
                    'FROM records WHERE blind_record_id = ?1',
                    blindRecordId,
                )
                .toArray()[0];
            if (!row) return new Response(null, { status: 404 });
            const chunkRows = this.sql
                .exec('SELECT data FROM record_chunks WHERE blind_record_id = ?1 ORDER BY chunk_idx ASC', blindRecordId)
                .toArray();
            const totalBytes = readInt(row, 'byte_length');
            const merged = new Uint8Array(totalBytes);
            let offset = 0;
            for (const c of chunkRows) {
                const part = toBytes(c.data);
                merged.set(part, offset);
                offset += part.byteLength;
            }
            return new Response(merged, {
                status: 200,
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'x-revision': String(readInt(row, 'revision')),
                    'x-change-seq': String(readInt(row, 'change_seq')),
                    'x-sha256': readStr(row, 'sha256_hex'),
                    'x-updated-at': String(readInt(row, 'updated_at')),
                },
            });
        }

        if (op === '/rpc/changes' && request.method === 'GET') {
            const sinceSeq = Number(url.searchParams.get('since') ?? '0');
            const limit = Math.max(1, Math.min(200, Math.trunc(Number(url.searchParams.get('limit') ?? '100'))));
            const user = this.readTenantRow();
            const headSeq = user?.headSeq ?? 0;
            const rows = this.sql
                .exec(
                    'SELECT blind_record_id, revision, change_seq, byte_length, sha256_hex, updated_at ' +
                    'FROM records WHERE change_seq > ?1 ORDER BY change_seq ASC LIMIT ?2',
                    sinceSeq,
                    limit + 1,
                )
                .toArray();
            const hasMore = rows.length > limit;
            const slice = hasMore ? rows.slice(0, limit) : rows;
            const items: CloudRecordMeta[] = slice.map(r => ({
                blindRecordId: readStr(r, 'blind_record_id'),
                revision: readInt(r, 'revision'),
                changeSeq: readInt(r, 'change_seq'),
                byteLength: readInt(r, 'byte_length'),
                sha256: readStr(r, 'sha256_hex'),
                updatedAt: readInt(r, 'updated_at'),
            }));
            const nextSince = items.length > 0 ? items[items.length - 1].changeSeq : sinceSeq;
            const feed: CloudChangesResponse = { items, nextSince, headSeq, hasMore };
            return Response.json(feed);
        }

        if (op === '/rpc/purge' && request.method === 'POST') {
            const body: unknown = await request.json();
            const nowMs = isPlainRecord(body) && typeof body.nowMs === 'number' ? body.nowMs : Date.now();
            this.storage.transactionSync(() => {
                this.sql.exec('DELETE FROM record_chunks');
                this.sql.exec('DELETE FROM records');
                this.sql.exec('UPDATE tenant_meta SET used_bytes = 0, key_fingerprint = NULL, updated_at = ?1 WHERE id = 1', nowMs);
            });
            return Response.json({ ok: true });
        }

        return new Response('Not Found', { status: 404 });
    }
}

function parseOptionalUserRow(raw: unknown): VaultUserRow | null {
    if (!isPlainRecord(raw) || !isPlainRecord(raw.user)) return null;
    const u = raw.user;
    if (typeof u.ownerSubject !== 'string'
        || typeof u.tokenEpoch !== 'number'
        || typeof u.usedBytes !== 'number'
        || typeof u.quotaBytes !== 'number'
        || typeof u.headSeq !== 'number') {
        return null;
    }
    return {
        ownerSubject: u.ownerSubject,
        tokenEpoch: u.tokenEpoch,
        ...(typeof u.keyFingerprint === 'string' ? { keyFingerprint: u.keyFingerprint } : {}),
        ...(typeof u.authVerifierHash === 'string' ? { authVerifierHash: u.authVerifierHash } : {}),
        usedBytes: u.usedBytes,
        quotaBytes: u.quotaBytes,
        headSeq: u.headSeq,
    };
}

function parseMeta(raw: unknown): CloudRecordMeta {
    if (!isPlainRecord(raw)
        || typeof raw.blindRecordId !== 'string'
        || typeof raw.revision !== 'number'
        || typeof raw.changeSeq !== 'number'
        || typeof raw.byteLength !== 'number'
        || typeof raw.sha256 !== 'string'
        || typeof raw.updatedAt !== 'number') {
        throw new Error('Malformed CloudRecordMeta from VaultTenantDO');
    }
    return {
        blindRecordId: raw.blindRecordId,
        revision: raw.revision,
        changeSeq: raw.changeSeq,
        byteLength: raw.byteLength,
        sha256: raw.sha256,
        updatedAt: raw.updatedAt,
    };
}

/**
 * `VaultStore` adapter backed by per-tenant SQLite Durable Objects (`VaultTenantDO`).
 */
export function createDurableObjectVaultStore(ns: DurableObjectNamespaceLike): VaultStore {
    const stubFor = (ownerSubject: string): DurableObjectStubLike => ns.get(ns.idFromName(ownerSubject));

    return {
        async ensureUser(ownerSubject, defaultQuotaBytes, nowMs = Date.now()) {
            const res = await stubFor(ownerSubject).fetch('https://do.internal/rpc/ensure-user', {
                method: 'POST',
                body: JSON.stringify({ ownerSubject, defaultQuotaBytes, nowMs }),
            });
            const user = parseOptionalUserRow(await res.json());
            if (!user) throw new Error('Failed to initialize Durable Object tenant');
            return user;
        },

        async authenticateKeyTenant(input) {
            const res = await stubFor(input.ownerSubject).fetch('https://do.internal/rpc/auth-key', {
                method: 'POST',
                body: JSON.stringify(input),
            });
            return parseOptionalUserRow(await res.json());
        },

        async getUser(ownerSubject) {
            const res = await stubFor(ownerSubject).fetch('https://do.internal/rpc/get-user');
            return parseOptionalUserRow(await res.json());
        },

        async rotateUserTokenEpoch(ownerSubject, nowMs = Date.now()) {
            const res = await stubFor(ownerSubject).fetch('https://do.internal/rpc/rotate-epoch', {
                method: 'POST',
                body: JSON.stringify({ nowMs }),
            });
            const raw: unknown = await res.json();
            if (!isPlainRecord(raw) || typeof raw.tokenEpoch !== 'number') {
                throw new Error('Failed rotating Durable Object token epoch');
            }
            return raw.tokenEpoch;
        },

        async getVaultStatus(ownerSubject) {
            const res = await stubFor(ownerSubject).fetch('https://do.internal/rpc/status');
            const raw: unknown = await res.json();
            if (!isPlainRecord(raw) || !isPlainRecord(raw.status)) return null;
            const s = raw.status;
            if (typeof s.ownerSubject !== 'string'
                || typeof s.recordCount !== 'number'
                || typeof s.usedBytes !== 'number'
                || typeof s.quotaBytes !== 'number'
                || typeof s.headSeq !== 'number') {
                return null;
            }
            return {
                ownerSubject: s.ownerSubject,
                recordCount: s.recordCount,
                usedBytes: s.usedBytes,
                quotaBytes: s.quotaBytes,
                headSeq: s.headSeq,
                ...(typeof s.keyFingerprint === 'string' ? { keyFingerprint: s.keyFingerprint } : {}),
            };
        },

        async putRecord(input) {
            const res = await stubFor(input.ownerSubject).fetch('https://do.internal/rpc/put-record', {
                method: 'PUT',
                headers: {
                    'x-blind-id': input.blindRecordId,
                    'x-expected-rev': String(input.expectedRevision),
                    'x-sha256': input.sha256,
                    ...(input.keyFingerprint ? { 'x-key-fp': input.keyFingerprint } : {}),
                    'x-now-ms': String(input.nowMs ?? Date.now()),
                },
                body: input.ciphertext,
            });
            const raw: unknown = await res.json();
            if (!isPlainRecord(raw) || typeof raw.status !== 'string') {
                throw new Error('Malformed putRecord response from VaultTenantDO');
            }
            if (raw.status === 'committed') {
                return { status: 'committed', meta: parseMeta(raw.meta) };
            }
            if (raw.status === 'conflict' && typeof raw.currentRevision === 'number') {
                return { status: 'conflict', currentRevision: raw.currentRevision };
            }
            if (raw.status === 'key_mismatch' && typeof raw.vaultKeyFingerprint === 'string') {
                return { status: 'key_mismatch', vaultKeyFingerprint: raw.vaultKeyFingerprint };
            }
            if (raw.status === 'quota_exceeded' && typeof raw.usedBytes === 'number' && typeof raw.quotaBytes === 'number') {
                return { status: 'quota_exceeded', usedBytes: raw.usedBytes, quotaBytes: raw.quotaBytes };
            }
            throw new Error(`Unexpected putRecord outcome: ${raw.status}`);
        },

        async getRecord(ownerSubject, blindRecordId) {
            const res = await stubFor(ownerSubject).fetch(
                `https://do.internal/rpc/get-record?id=${encodeURIComponent(blindRecordId)}`,
            );
            if (res.status === 404) return null;
            const ciphertext = new Uint8Array(await res.arrayBuffer());
            const meta: CloudRecordMeta = {
                blindRecordId,
                revision: Number(res.headers.get('x-revision') ?? '1'),
                changeSeq: Number(res.headers.get('x-change-seq') ?? '1'),
                byteLength: ciphertext.byteLength,
                sha256: res.headers.get('x-sha256') ?? '',
                updatedAt: Number(res.headers.get('x-updated-at') ?? '0'),
            };
            return { meta, ciphertext };
        },

        async listChanges(ownerSubject, sinceSeq, limit) {
            const res = await stubFor(ownerSubject).fetch(
                `https://do.internal/rpc/changes?since=${sinceSeq}&limit=${limit}`,
            );
            const raw: unknown = await res.json();
            if (!isPlainRecord(raw)
                || !Array.isArray(raw.items)
                || typeof raw.nextSince !== 'number'
                || typeof raw.headSeq !== 'number'
                || typeof raw.hasMore !== 'boolean') {
                throw new Error('Malformed listChanges response from VaultTenantDO');
            }
            return {
                items: raw.items.map(item => parseMeta(item)),
                nextSince: raw.nextSince,
                headSeq: raw.headSeq,
                hasMore: raw.hasMore,
            };
        },

        async purgeVault(ownerSubject, nowMs = Date.now()) {
            await stubFor(ownerSubject).fetch('https://do.internal/rpc/purge', {
                method: 'POST',
                body: JSON.stringify({ nowMs }),
            });
        },
    };
}
