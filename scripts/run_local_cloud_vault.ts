import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCloudServerHandler } from '../cloud-server/src/router.js';
import type { CloudChangesResponse, CloudRecordMeta, CloudVaultStatusResponse } from '../src/shared/types/cloudSync.js';
import type { PutRecordOutcome, VaultStore, VaultUserRow } from '../cloud-server/src/storage/vaultStore.js';

interface DiskTenantState {
    tokenEpoch: number;
    keyFingerprint?: string;
    authVerifierHash?: string;
    usedBytes: number;
    quotaBytes: number;
    nextSeq: number;
    records: Record<string, CloudRecordMeta>;
}

interface DiskStoreIndex {
    version: 1;
    sessionSecret: string;
    tenants: Record<string, DiskTenantState>;
}

function createDiskBackedLocalVaultStore(rootDir: string): { store: VaultStore; sessionSecret: string } {
    fs.mkdirSync(path.join(rootDir, 'blobs'), { recursive: true });
    const indexPath = path.join(rootDir, 'vault-index.json');

    const loadIndex = (): DiskStoreIndex => {
        if (!fs.existsSync(indexPath)) {
            const fresh: DiskStoreIndex = {
                version: 1,
                sessionSecret: crypto.randomBytes(48).toString('base64url'),
                tenants: {},
            };
            fs.writeFileSync(indexPath, JSON.stringify(fresh, null, 2));
            return fresh;
        }
        return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    };

    const state = loadIndex();
    const saveIndex = (): void => {
        const tmpPath = `${indexPath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
        fs.renameSync(tmpPath, indexPath);
    };

    const blobFilePath = (ownerSubject: string, blindId: string, revision: number): string => {
        const safeSub = Buffer.from(ownerSubject, 'utf8').toString('hex');
        return path.join(rootDir, 'blobs', `${safeSub}_${blindId}_r${revision}.gee1`);
    };

    const toRow = (ownerSubject: string, t: DiskTenantState): VaultUserRow => ({
        ownerSubject,
        tokenEpoch: t.tokenEpoch,
        ...(t.keyFingerprint ? { keyFingerprint: t.keyFingerprint } : {}),
        ...(t.authVerifierHash ? { authVerifierHash: t.authVerifierHash } : {}),
        usedBytes: t.usedBytes,
        quotaBytes: t.quotaBytes,
        headSeq: t.nextSeq - 1,
    });

    const store: VaultStore = {
        async ensureUser(ownerSubject, defaultQuotaBytes) {
            let t = state.tenants[ownerSubject];
            if (!t) {
                t = { tokenEpoch: 1, usedBytes: 0, quotaBytes: defaultQuotaBytes, nextSeq: 1, records: {} };
                state.tenants[ownerSubject] = t;
                saveIndex();
            }
            return toRow(ownerSubject, t);
        },

        async authenticateKeyTenant(input) {
            let t = state.tenants[input.ownerSubject];
            if (!t) {
                t = {
                    tokenEpoch: 1,
                    keyFingerprint: input.keyFingerprint,
                    authVerifierHash: input.authVerifierHash,
                    usedBytes: 0,
                    quotaBytes: input.defaultQuotaBytes,
                    nextSeq: 1,
                    records: {},
                };
                state.tenants[input.ownerSubject] = t;
                saveIndex();
                return toRow(input.ownerSubject, t);
            }
            if (!t.authVerifierHash || t.authVerifierHash !== input.authVerifierHash) return null;
            return toRow(input.ownerSubject, t);
        },

        async getUser(ownerSubject) {
            const t = state.tenants[ownerSubject];
            return t ? toRow(ownerSubject, t) : null;
        },

        async rotateUserTokenEpoch(ownerSubject) {
            const t = state.tenants[ownerSubject];
            if (!t) throw new Error('User not found');
            t.tokenEpoch += 1;
            saveIndex();
            return t.tokenEpoch;
        },

        async getVaultStatus(ownerSubject): Promise<CloudVaultStatusResponse | null> {
            const t = state.tenants[ownerSubject];
            if (!t) return null;
            return {
                ownerSubject,
                recordCount: Object.keys(t.records).length,
                usedBytes: t.usedBytes,
                quotaBytes: t.quotaBytes,
                headSeq: t.nextSeq - 1,
                ...(t.keyFingerprint ? { keyFingerprint: t.keyFingerprint } : {}),
            };
        },

        async putRecord(input): Promise<PutRecordOutcome> {
            const t = state.tenants[input.ownerSubject];
            if (!t) throw new Error('Tenant not found');
            if (t.keyFingerprint && input.keyFingerprint && t.keyFingerprint !== input.keyFingerprint) {
                return { status: 'key_mismatch', vaultKeyFingerprint: t.keyFingerprint };
            }
            const existing = t.records[input.blindRecordId];
            const currentRevision = existing?.revision ?? 0;
            if (currentRevision !== input.expectedRevision) {
                return { status: 'conflict', currentRevision };
            }
            const nextBytes = t.usedBytes - (existing?.byteLength ?? 0) + input.ciphertext.byteLength;
            if (nextBytes > t.quotaBytes) {
                return { status: 'quota_exceeded', usedBytes: t.usedBytes, quotaBytes: t.quotaBytes };
            }
            const nextRevision = currentRevision + 1;
            const changeSeq = t.nextSeq++;
            fs.writeFileSync(blobFilePath(input.ownerSubject, input.blindRecordId, nextRevision), input.ciphertext);
            if (existing) {
                const oldPath = blobFilePath(input.ownerSubject, input.blindRecordId, existing.revision);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            if (!t.keyFingerprint && input.keyFingerprint) t.keyFingerprint = input.keyFingerprint;
            t.usedBytes = nextBytes;
            const meta: CloudRecordMeta = {
                blindRecordId: input.blindRecordId,
                revision: nextRevision,
                changeSeq,
                byteLength: input.ciphertext.byteLength,
                sha256: input.sha256,
                updatedAt: input.nowMs ?? Date.now(),
            };
            t.records[input.blindRecordId] = meta;
            saveIndex();
            return { status: 'committed', meta };
        },

        async getRecord(ownerSubject, blindRecordId) {
            const t = state.tenants[ownerSubject];
            const meta = t?.records[blindRecordId];
            if (!meta) return null;
            const filePath = blobFilePath(ownerSubject, blindRecordId, meta.revision);
            if (!fs.existsSync(filePath)) return null;
            const raw = fs.readFileSync(filePath);
            const ciphertext = new Uint8Array(raw.byteLength);
            ciphertext.set(raw);
            return { meta: { ...meta }, ciphertext };
        },

        async listChanges(ownerSubject, sinceSeq, limit): Promise<CloudChangesResponse> {
            const t = state.tenants[ownerSubject];
            const headSeq = t ? t.nextSeq - 1 : 0;
            const all = Object.values(t?.records ?? {})
                .filter(m => m.changeSeq > sinceSeq)
                .sort((a, b) => a.changeSeq - b.changeSeq);
            const clamped = Math.max(1, Math.min(200, Math.trunc(limit)));
            const hasMore = all.length > clamped;
            const items = hasMore ? all.slice(0, clamped) : all;
            const nextSince = items.length > 0 ? items[items.length - 1].changeSeq : sinceSeq;
            return { items, nextSince, headSeq, hasMore };
        },

        async purgeVault(ownerSubject) {
            const t = state.tenants[ownerSubject];
            if (!t) return;
            for (const rec of Object.values(t.records)) {
                const p = blobFilePath(ownerSubject, rec.blindRecordId, rec.revision);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            }
            t.records = {};
            t.usedBytes = 0;
            t.keyFingerprint = undefined;
            saveIndex();
        },
    };

    return { store, sessionSecret: state.sessionSecret };
}

const port = Number(process.env.PORT ?? '8788');
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = path.resolve(process.env.VAULT_DATA_DIR ?? 'temp/local-cloud-vault');
const accessCode = process.env.SERVER_ACCESS_CODE?.trim() || undefined;

const { store, sessionSecret } = createDiskBackedLocalVaultStore(dataDir);
const handler = createCloudServerHandler({
    store,
    config: {
        sessionHmacSecret: sessionSecret,
        ...(accessCode ? { serverAccessCode: accessCode } : {}),
        allowedOrigins: ['*'],
    },
});

const server = http.createServer(async (req, res) => {
    try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const bodyBuf = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers.set(k, v);
            else if (Array.isArray(v)) headers.set(k, v.join(', '));
        }
        const url = `http://${req.headers.host ?? `${host}:${port}`}${req.url ?? '/'}`;
        const method = req.method ?? 'GET';
        const webReq = new Request(url, {
            method,
            headers,
            ...(method !== 'GET' && method !== 'HEAD' ? { body: new Uint8Array(bodyBuf) } : {}),
        });
        const webRes = await handler(webReq);
        res.statusCode = webRes.status;
        webRes.headers.forEach((val, key) => res.setHeader(key, val));
        const resBuf = Buffer.from(await webRes.arrayBuffer());
        res.end(resBuf);
    } catch (err) {
        console.error('[LocalCloudVault] Error:', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }));
    }
});

server.listen(port, host, () => {
    console.log('============================================================');
    console.log('🔒 Zero-Knowledge E2EE Cloud Vault (Local Standalone Server)');
    console.log(`🌐 URL         : http://${host}:${port}`);
    console.log(`💾 Storage Dir : ${dataDir}`);
    console.log(`🔑 Access Code : ${accessCode ? 'ENABLED (protected)' : 'OPEN (no access code required)'}`);
    console.log('============================================================');
});
