import { OperationError } from '../../shared/errors/operationError.js';
import type {
    CloudAuthSessionResponse,
    CloudChangesResponse,
    CloudRecordMeta,
    CloudVaultStatusResponse,
} from '../../shared/types/cloudSync.js';
import { isRecord } from '../../shared/utils/typeGuards.js';

export type CloudFetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Normalize and enforce HTTPS for remote Cloud Vault URLs (allowing loopback HTTP only for local testing). */
export function normalizeCloudServerUrl(rawUrl: string): string {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl.trim());
    } catch {
        throw new OperationError('CLOUD_SERVER_ERROR', 'Invalid Cloud Vault server URL');
    }
    const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
        throw new OperationError('CLOUD_SERVER_ERROR', 'Cloud Vault server URL must use HTTPS');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new OperationError('CLOUD_SERVER_ERROR', 'Cloud Vault server URL must not contain credentials or query strings');
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

function parseRetryAfterTimestamp(header: string | null): number | undefined {
    if (!header) return undefined;
    const secs = Number(header.trim());
    if (Number.isFinite(secs) && secs > 0) return Date.now() + Math.ceil(secs * 1000);
    return undefined;
}

async function readErrorDetails(response: Response): Promise<{ code?: string; message: string; currentRevision?: number }> {
    try {
        const json: unknown = await response.json();
        if (isRecord(json) && isRecord(json.error)) {
            const code = typeof json.error.code === 'string' ? json.error.code : undefined;
            const message = typeof json.error.message === 'string' && json.error.message
                ? json.error.message
                : `HTTP ${response.status}`;
            const currentRevision = typeof json.error.currentRevision === 'number'
                && Number.isSafeInteger(json.error.currentRevision)
                ? json.error.currentRevision
                : undefined;
            return { code, message, currentRevision };
        }
    } catch {
        // Ignore non-JSON error body
    }
    return { message: `Cloud Vault HTTP ${response.status}` };
}

function throwMappedHttpError(
    status: number,
    details: { code?: string; message: string },
    retryAfterHeader: string | null,
): never {
    const retryAt = parseRetryAfterTimestamp(retryAfterHeader);
    if (status === 401 || status === 403 || details.code === 'UNAUTHORIZED') {
        throw new OperationError('CLOUD_AUTH_REQUIRED', details.message, status);
    }
    if (details.code === 'KEY_FINGERPRINT_MISMATCH') {
        throw new OperationError('CLOUD_KEY_MISMATCH', details.message, status);
    }
    if (details.code === 'QUOTA_EXCEEDED') {
        throw new OperationError('CLOUD_QUOTA_EXCEEDED', details.message, status);
    }
    if (status === 413 || details.code === 'RECORD_TOO_LARGE') {
        throw new OperationError('CLOUD_RECORD_TOO_LARGE', details.message, status);
    }
    throw new OperationError('CLOUD_SERVER_ERROR', details.message, status, retryAt ? { retryAt } : undefined);
}

function parseRecordMeta(raw: unknown): CloudRecordMeta {
    if (!isRecord(raw)
        || typeof raw.blindRecordId !== 'string'
        || typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision)
        || typeof raw.changeSeq !== 'number' || !Number.isSafeInteger(raw.changeSeq)
        || typeof raw.byteLength !== 'number' || !Number.isSafeInteger(raw.byteLength)
        || typeof raw.sha256 !== 'string'
        || typeof raw.updatedAt !== 'number' || !Number.isSafeInteger(raw.updatedAt)) {
        throw new OperationError('CLOUD_SERVER_ERROR', 'Malformed CloudRecordMeta from server');
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

export interface CloudVaultClient {
    authenticateGoogle(serverUrl: string, idToken: string, signal?: AbortSignal): Promise<CloudAuthSessionResponse>;
    logoutAll(serverUrl: string, sessionToken: string, signal?: AbortSignal): Promise<void>;
    getVaultStatus(serverUrl: string, sessionToken: string, signal?: AbortSignal): Promise<CloudVaultStatusResponse>;
    putEncryptedRecord(input: {
        readonly serverUrl: string;
        readonly sessionToken: string;
        readonly blindRecordId: string;
        readonly expectedRevision: number;
        readonly envelope: Uint8Array<ArrayBuffer>;
        readonly sha256: string;
        readonly keyFingerprint?: string;
        readonly signal?: AbortSignal;
    }): Promise<
        | { readonly status: 'committed'; readonly meta: CloudRecordMeta }
        | { readonly status: 'conflict'; readonly currentRevision: number }
    >;
    getEncryptedRecord(input: {
        readonly serverUrl: string;
        readonly sessionToken: string;
        readonly blindRecordId: string;
        readonly signal?: AbortSignal;
    }): Promise<{
        readonly revision: number;
        readonly changeSeq: number;
        readonly sha256: string;
        readonly envelope: Uint8Array<ArrayBuffer>;
    } | null>;
    listChanges(input: {
        readonly serverUrl: string;
        readonly sessionToken: string;
        readonly sinceSeq: number;
        readonly limit?: number;
        readonly signal?: AbortSignal;
    }): Promise<CloudChangesResponse>;
    purgeVault(serverUrl: string, sessionToken: string, signal?: AbortSignal): Promise<void>;
}

export function createCloudVaultClient(fetchFn: CloudFetchFn = globalThis.fetch.bind(globalThis)): CloudVaultClient {
    return {
        async authenticateGoogle(serverUrl, idToken, signal) {
            const base = normalizeCloudServerUrl(serverUrl);
            const res = await fetchFn(`${base}/v1/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken }),
                signal,
            });
            if (!res.ok) {
                throwMappedHttpError(res.status, await readErrorDetails(res), res.headers.get('Retry-After'));
            }
            const raw: unknown = await res.json();
            if (!isRecord(raw)
                || typeof raw.sessionToken !== 'string' || !raw.sessionToken
                || typeof raw.ownerSubject !== 'string' || !raw.ownerSubject
                || typeof raw.expiresAt !== 'number' || !Number.isSafeInteger(raw.expiresAt)) {
                throw new OperationError('CLOUD_SERVER_ERROR', 'Malformed authentication response from Cloud Vault');
            }
            return {
                sessionToken: raw.sessionToken,
                ownerSubject: raw.ownerSubject,
                expiresAt: raw.expiresAt,
                ...(typeof raw.email === 'string' && raw.email ? { email: raw.email } : {}),
            };
        },

        async logoutAll(serverUrl, sessionToken, signal) {
            const base = normalizeCloudServerUrl(serverUrl);
            const res = await fetchFn(`${base}/v1/auth/logout-all`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${sessionToken}` },
                signal,
            });
            if (!res.ok) {
                throwMappedHttpError(res.status, await readErrorDetails(res), res.headers.get('Retry-After'));
            }
        },

        async getVaultStatus(serverUrl, sessionToken, signal) {
            const base = normalizeCloudServerUrl(serverUrl);
            const res = await fetchFn(`${base}/v1/vault/status`, {
                headers: { Authorization: `Bearer ${sessionToken}` },
                signal,
            });
            if (!res.ok) {
                throwMappedHttpError(res.status, await readErrorDetails(res), res.headers.get('Retry-After'));
            }
            const raw: unknown = await res.json();
            if (!isRecord(raw)
                || typeof raw.ownerSubject !== 'string'
                || typeof raw.recordCount !== 'number'
                || typeof raw.usedBytes !== 'number'
                || typeof raw.quotaBytes !== 'number'
                || typeof raw.headSeq !== 'number') {
                throw new OperationError('CLOUD_SERVER_ERROR', 'Malformed vault status response');
            }
            return {
                ownerSubject: raw.ownerSubject,
                recordCount: raw.recordCount,
                usedBytes: raw.usedBytes,
                quotaBytes: raw.quotaBytes,
                headSeq: raw.headSeq,
                ...(typeof raw.keyFingerprint === 'string' && raw.keyFingerprint
                    ? { keyFingerprint: raw.keyFingerprint }
                    : {}),
            };
        },

        async putEncryptedRecord(input) {
            const base = normalizeCloudServerUrl(input.serverUrl);
            const res = await fetchFn(`${base}/v1/vault/records/${input.blindRecordId}`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${input.sessionToken}`,
                    'Content-Type': 'application/octet-stream',
                    'X-Expected-Revision': String(input.expectedRevision),
                    'X-Content-SHA256': input.sha256,
                    ...(input.keyFingerprint ? { 'X-Vault-Key-Fingerprint': input.keyFingerprint } : {}),
                },
                body: input.envelope,
                signal: input.signal,
            });
            if (res.status === 409) {
                const details = await readErrorDetails(res);
                if (details.code === 'KEY_FINGERPRINT_MISMATCH') {
                    throw new OperationError('CLOUD_KEY_MISMATCH', details.message, 409);
                }
                if (details.currentRevision === undefined) {
                    throw new OperationError('CLOUD_SERVER_ERROR', 'Conflict response missing currentRevision', 409);
                }
                return { status: 'conflict', currentRevision: details.currentRevision };
            }
            if (!res.ok) {
                throwMappedHttpError(res.status, await readErrorDetails(res), res.headers.get('Retry-After'));
            }
            return { status: 'committed', meta: parseRecordMeta(await res.json()) };
        },

        async getEncryptedRecord(input) {
            const base = normalizeCloudServerUrl(input.serverUrl);
            const res = await fetchFn(`${base}/v1/vault/records/${input.blindRecordId}`, {
                headers: { Authorization: `Bearer ${input.sessionToken}` },
                signal: input.signal,
            });
            if (res.status === 404) return null;
            if (!res.ok) {
                throwMappedHttpError(res.status, await readErrorDetails(res), res.headers.get('Retry-After'));
            }
            const revHeader = res.headers.get('X-Record-Revision');
            const seqHeader = res.headers.get('X-Record-Change-Seq') ?? '0';
            const shaHeader = res.headers.get('X-Content-SHA256') ?? '';
            const revision = revHeader ? Number(revHeader) : NaN;
            const changeSeq = Number(seqHeader);
            if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(changeSeq)) {
                throw new OperationError('CLOUD_SERVER_ERROR', 'Missing or invalid X-Record-Revision header on download');
            }
            const envelope = new Uint8Array(await res.arrayBuffer());
            return { revision, changeSeq, sha256: shaHeader, envelope };
        },

        async listChanges(input) {
            const base = normalizeCloudServerUrl(input.serverUrl);
            const limit = input.limit ?? 100;
            const res = await fetchFn(`${base}/v1/vault/changes?since=${input.sinceSeq}&limit=${limit}`, {
                headers: { Authorization: `Bearer ${input.sessionToken}` },
                signal: input.signal,
            });
            if (!res.ok) {
                throwMappedHttpError(res.status, await readErrorDetails(res), res.headers.get('Retry-After'));
            }
            const raw: unknown = await res.json();
            if (!isRecord(raw)
                || !Array.isArray(raw.items)
                || typeof raw.nextSince !== 'number'
                || typeof raw.headSeq !== 'number'
                || typeof raw.hasMore !== 'boolean') {
                throw new OperationError('CLOUD_SERVER_ERROR', 'Malformed changes response');
            }
            return {
                items: raw.items.map(item => parseRecordMeta(item)),
                nextSince: raw.nextSince,
                headSeq: raw.headSeq,
                hasMore: raw.hasMore,
            };
        },

        async purgeVault(serverUrl, sessionToken, signal) {
            const base = normalizeCloudServerUrl(serverUrl);
            const res = await fetchFn(`${base}/v1/vault`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${sessionToken}` },
                signal,
            });
            if (!res.ok) {
                throwMappedHttpError(res.status, await readErrorDetails(res), res.headers.get('Retry-After'));
            }
        },
    };
}
