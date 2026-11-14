import {
    CLOUD_DEFAULT_USER_QUOTA_BYTES,
    CLOUD_MAX_RECORD_BYTES,
    CLOUD_WIRE_MAGIC,
    type CloudAuthSessionResponse,
    type CloudErrorResponse,
} from '../../src/shared/types/cloudSync.js';
import { AuthVerificationError, type GoogleOidcVerifier } from './auth/googleOidc.js';
import { issueSessionToken, verifySessionToken } from './auth/sessionToken.js';
import { createRateLimiter, type RateLimiter } from './rateLimit.js';
import { sha256Hex, type VaultStore } from './storage/vaultStore.js';

const BLIND_RECORD_ID_PATTERN = /^[0-9a-f]{64}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const MIN_GEE1_ENVELOPE_BYTES = 4 + 12 + 16; // Magic(4) + IV(12) + Tag(16)

export interface CloudServerConfig {
    readonly sessionHmacSecret: string;
    readonly googleClientIds: readonly string[];
    /** Comma-separated or explicit list of allowed Origins (e.g., `chrome-extension://<id>`). Empty allows only Origin-less or explicit extension origins if `*` is set. */
    readonly allowedOrigins?: readonly string[];
    readonly defaultQuotaBytes?: number;
    readonly maxRecordBytes?: number;
    readonly authRateLimitPerMinute?: number;
    readonly writeRateLimitPerMinute?: number;
    readonly now?: () => number;
}

export interface CloudServerDependencies {
    readonly store: VaultStore;
    readonly oidcVerifier: GoogleOidcVerifier;
    readonly config: CloudServerConfig;
    readonly rateLimiter?: RateLimiter;
}

function baseSecurityHeaders(corsOrigin: string | null): Record<string, string> {
    return {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        Vary: 'Origin',
        ...(corsOrigin ? {
            'Access-Control-Allow-Origin': corsOrigin,
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Expected-Revision, X-Content-SHA256',
            'Access-Control-Expose-Headers': 'ETag, X-Record-Revision, X-Record-Change-Seq, X-Content-SHA256, Retry-After',
            'Access-Control-Max-Age': '86400',
        } : {}),
    };
}

function resolveAllowedCorsOrigin(requestOrigin: string | null, allowedOrigins?: readonly string[]): string | null {
    if (!requestOrigin) return null;
    if (!allowedOrigins || allowedOrigins.length === 0) return null;
    if (allowedOrigins.includes('*')) return requestOrigin;
    return allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
}

function jsonResponse(
    status: number,
    body: unknown,
    corsOrigin: string | null,
    extraHeaders: Record<string, string> = {},
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...baseSecurityHeaders(corsOrigin),
            ...extraHeaders,
        },
    });
}

function errorResponse(
    status: number,
    code: CloudErrorResponse['error']['code'],
    message: string,
    corsOrigin: string | null,
    options: { currentRevision?: number; retryAfterSec?: number } = {},
): Response {
    const payload: CloudErrorResponse = {
        error: {
            code,
            message,
            ...(options.currentRevision !== undefined ? { currentRevision: options.currentRevision } : {}),
        },
    };
    return jsonResponse(
        status,
        payload,
        corsOrigin,
        options.retryAfterSec !== undefined ? { 'Retry-After': String(options.retryAfterSec) } : {},
    );
}

function clientIpFromHeaders(request: Request): string {
    return request.headers.get('CF-Connecting-IP')?.trim()
        || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
        || 'local';
}

function hasValidGee1Magic(bytes: Uint8Array): boolean {
    if (bytes.byteLength < MIN_GEE1_ENVELOPE_BYTES) return false;
    for (let i = 0; i < CLOUD_WIRE_MAGIC.length; i++) {
        if (bytes[i] !== CLOUD_WIRE_MAGIC[i]) return false;
    }
    return true;
}

/**
 * Pure Web-Standards HTTP router for the multi-tenant zero-knowledge E2EE Vault Worker.
 */
export function createCloudServerHandler(deps: CloudServerDependencies): (request: Request) => Promise<Response> {
    const rateLimiter = deps.rateLimiter ?? createRateLimiter();
    const now = deps.config.now ?? Date.now;
    const defaultQuotaBytes = deps.config.defaultQuotaBytes ?? CLOUD_DEFAULT_USER_QUOTA_BYTES;
    const maxRecordBytes = deps.config.maxRecordBytes ?? CLOUD_MAX_RECORD_BYTES;
    const authLimit = deps.config.authRateLimitPerMinute ?? 20;
    const writeLimit = deps.config.writeRateLimitPerMinute ?? 180;

    const authenticate = async (request: Request): Promise<string> => {
        const header = request.headers.get('Authorization');
        if (!header || !header.startsWith('Bearer ')) {
            throw new AuthVerificationError('Missing Bearer session token');
        }
        const token = header.slice('Bearer '.length).trim();
        const claims = await verifySessionToken(token, deps.config.sessionHmacSecret, now());
        const user = await deps.store.getUser(claims.sub);
        if (!user || user.tokenEpoch !== claims.epoch) {
            throw new AuthVerificationError('Session token has been revoked or user does not exist');
        }
        return user.ownerSubject;
    };

    return async (request: Request): Promise<Response> => {
        const requestOrigin = request.headers.get('Origin');
        const corsOrigin = resolveAllowedCorsOrigin(requestOrigin, deps.config.allowedOrigins);

        // Enforce strict Origin allowlist whenever an Origin header is present
        if (requestOrigin && !corsOrigin) {
            return errorResponse(403, 'UNAUTHORIZED', 'Origin is not permitted', null);
        }
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: baseSecurityHeaders(corsOrigin) });
        }

        let url: URL;
        try {
            url = new URL(request.url);
        } catch {
            return errorResponse(400, 'INVALID_REQUEST', 'Malformed request URL', corsOrigin);
        }

        const path = url.pathname;
        const method = request.method.toUpperCase();

        try {
            if (method === 'GET' && path === '/v1/health') {
                return jsonResponse(200, { ok: true, service: 'gemini-exporter-e2ee-vault', version: 1 }, corsOrigin);
            }

            // 1. Google OIDC login -> stateless epoch-bound session token
            if (method === 'POST' && path === '/v1/auth/google') {
                const ip = clientIpFromHeaders(request);
                const rate = rateLimiter.allow(`auth:${ip}`, authLimit, 60_000, now());
                if (!rate.allowed) {
                    return errorResponse(429, 'RATE_LIMITED', 'Too many authentication attempts', corsOrigin, {
                        retryAfterSec: rate.retryAfterSec,
                    });
                }
                const contentLength = Number(request.headers.get('content-length') ?? '0');
                if (contentLength > 32768) {
                    return errorResponse(413, 'RECORD_TOO_LARGE', 'Auth payload too large', corsOrigin);
                }
                let rawBody: unknown;
                try {
                    rawBody = await request.json();
                } catch {
                    return errorResponse(400, 'INVALID_REQUEST', 'Expected JSON body with idToken', corsOrigin);
                }
                const idToken: unknown = rawBody && typeof rawBody === 'object' ? Reflect.get(rawBody, 'idToken') : undefined;
                if (typeof idToken !== 'string' || !idToken.trim()) {
                    return errorResponse(400, 'INVALID_REQUEST', 'Missing Google idToken string', corsOrigin);
                }
                const verified = await deps.oidcVerifier.verifyIdToken(idToken, deps.config.googleClientIds, now());
                const user = await deps.store.ensureUser(verified.ownerSubject, defaultQuotaBytes, now());
                const issued = await issueSessionToken({
                    secret: deps.config.sessionHmacSecret,
                    ownerSubject: user.ownerSubject,
                    tokenEpoch: user.tokenEpoch,
                    nowMs: now(),
                });
                const response: CloudAuthSessionResponse = {
                    sessionToken: issued.sessionToken,
                    ownerSubject: user.ownerSubject,
                    expiresAt: issued.expiresAt,
                    ...(verified.email ? { email: verified.email } : {}),
                };
                return jsonResponse(200, response, corsOrigin);
            }

            // All remaining /v1/* endpoints require a valid authenticated session
            const ownerSubject = await authenticate(request);

            // 2. Revoke all active session tokens across devices by incrementing token_epoch
            if (method === 'POST' && path === '/v1/auth/logout-all') {
                const nextEpoch = await deps.store.rotateUserTokenEpoch(ownerSubject, now());
                return jsonResponse(200, { ok: true, tokenEpoch: nextEpoch }, corsOrigin);
            }

            // 3. Vault quota & sync sequence summary
            if (method === 'GET' && path === '/v1/vault/status') {
                const status = await deps.store.getVaultStatus(ownerSubject);
                if (!status) return errorResponse(404, 'NOT_FOUND', 'Vault user not found', corsOrigin);
                return jsonResponse(200, status, corsOrigin);
            }

            // 4. Incremental change feed ordered by monotonic per-user change_seq
            if (method === 'GET' && path === '/v1/vault/changes') {
                const rawSince = url.searchParams.get('since') ?? '0';
                const rawLimit = url.searchParams.get('limit') ?? '100';
                if (!/^\d+$/.test(rawSince) || !/^\d+$/.test(rawLimit)) {
                    return errorResponse(400, 'INVALID_REQUEST', 'Query parameters since and limit must be non-negative integers', corsOrigin);
                }
                const sinceSeq = Number(rawSince);
                const limit = Number(rawLimit);
                if (!Number.isSafeInteger(sinceSeq) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
                    return errorResponse(400, 'INVALID_REQUEST', 'Invalid since cursor or limit (1..200)', corsOrigin);
                }
                const feed = await deps.store.listChanges(ownerSubject, sinceSeq, limit);
                return jsonResponse(200, feed, corsOrigin);
            }

            // 5. Purge entire user vault
            if (method === 'DELETE' && path === '/v1/vault') {
                await deps.store.purgeVault(ownerSubject, now());
                return jsonResponse(200, { ok: true }, corsOrigin);
            }

            // 6. Blind record PUT / GET: /v1/vault/records/:blindRecordId
            const recordPrefix = '/v1/vault/records/';
            if (path.startsWith(recordPrefix)) {
                const blindRecordId = path.slice(recordPrefix.length);
                if (!BLIND_RECORD_ID_PATTERN.test(blindRecordId)) {
                    return errorResponse(400, 'INVALID_REQUEST', 'blindRecordId must be a 64-character lowercase hex HMAC', corsOrigin);
                }

                if (method === 'GET') {
                    const stored = await deps.store.getRecord(ownerSubject, blindRecordId);
                    if (!stored) {
                        return errorResponse(404, 'NOT_FOUND', 'Encrypted record not found', corsOrigin);
                    }
                    const computedHash = await sha256Hex(stored.ciphertext);
                    if (computedHash !== stored.meta.sha256) {
                        return errorResponse(500, 'INTERNAL_ERROR', 'Stored ciphertext integrity hash mismatch', corsOrigin);
                    }
                    return new Response(stored.ciphertext, {
                        status: 200,
                        headers: {
                            'Content-Type': 'application/octet-stream',
                            'Content-Length': String(stored.ciphertext.byteLength),
                            ETag: `"r${stored.meta.revision}-${stored.meta.sha256.slice(0, 16)}"`,
                            'X-Record-Revision': String(stored.meta.revision),
                            'X-Record-Change-Seq': String(stored.meta.changeSeq),
                            'X-Content-SHA256': stored.meta.sha256,
                            ...baseSecurityHeaders(corsOrigin),
                        },
                    });
                }

                if (method === 'PUT') {
                    const rate = rateLimiter.allow(`write:${ownerSubject}`, writeLimit, 60_000, now());
                    if (!rate.allowed) {
                        return errorResponse(429, 'RATE_LIMITED', 'Write rate limit exceeded', corsOrigin, {
                            retryAfterSec: rate.retryAfterSec,
                        });
                    }
                    const rawExpectedRev = request.headers.get('X-Expected-Revision');
                    if (rawExpectedRev === null || !/^\d+$/.test(rawExpectedRev)) {
                        return errorResponse(400, 'INVALID_REQUEST', 'Missing non-negative integer X-Expected-Revision header', corsOrigin);
                    }
                    const expectedRevision = Number(rawExpectedRev);
                    if (!Number.isSafeInteger(expectedRevision)) {
                        return errorResponse(400, 'INVALID_REQUEST', 'Invalid X-Expected-Revision value', corsOrigin);
                    }

                    const declaredLength = Number(request.headers.get('Content-Length') ?? '0');
                    if (declaredLength > maxRecordBytes) {
                        return errorResponse(413, 'RECORD_TOO_LARGE', `Encrypted record exceeds ${maxRecordBytes} byte ceiling`, corsOrigin);
                    }
                    const bodyBuffer = await request.arrayBuffer();
                    if (bodyBuffer.byteLength > maxRecordBytes) {
                        return errorResponse(413, 'RECORD_TOO_LARGE', `Encrypted record exceeds ${maxRecordBytes} byte ceiling`, corsOrigin);
                    }
                    const ciphertext = new Uint8Array(bodyBuffer);

                    // Zero-knowledge safety interlock: reject anything that is not a GEE1 binary ciphertext envelope
                    if (!hasValidGee1Magic(ciphertext)) {
                        return errorResponse(
                            400,
                            'PLAINTEXT_REJECTED',
                            'Payload rejected: missing GEE1 E2EE binary envelope header or below minimum AEAD length',
                            corsOrigin,
                        );
                    }

                    const actualSha256 = await sha256Hex(ciphertext);
                    const declaredSha256 = request.headers.get('X-Content-SHA256');
                    if (declaredSha256 !== null) {
                        if (!SHA256_HEX_PATTERN.test(declaredSha256) || declaredSha256 !== actualSha256) {
                            return errorResponse(400, 'INVALID_REQUEST', 'Ciphertext SHA-256 transport checksum mismatch', corsOrigin);
                        }
                    }

                    const outcome = await deps.store.putRecord({
                        ownerSubject,
                        blindRecordId,
                        expectedRevision,
                        ciphertext,
                        sha256: actualSha256,
                        nowMs: now(),
                    });

                    if (outcome.status === 'conflict') {
                        return errorResponse(
                            409,
                            'REVISION_CONFLICT',
                            'Optimistic concurrency conflict: remote record has a different revision',
                            corsOrigin,
                            { currentRevision: outcome.currentRevision },
                        );
                    }
                    if (outcome.status === 'quota_exceeded') {
                        return errorResponse(
                            413,
                            'QUOTA_EXCEEDED',
                            `Vault storage quota exceeded (${outcome.usedBytes} / ${outcome.quotaBytes} bytes)`,
                            corsOrigin,
                        );
                    }
                    return jsonResponse(200, outcome.meta, corsOrigin, {
                        ETag: `"r${outcome.meta.revision}-${outcome.meta.sha256.slice(0, 16)}"`,
                    });
                }
            }

            return errorResponse(404, 'NOT_FOUND', 'Unknown endpoint or method', corsOrigin);
        } catch (error) {
            if (error instanceof AuthVerificationError) {
                return errorResponse(401, 'UNAUTHORIZED', error.message, corsOrigin);
            }
            console.error('[CloudVault] Unhandled internal error:', error);
            return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error', corsOrigin);
        }
    };
}
