import { AuthVerificationError, decodeBase64UrlBytes, encodeBase64UrlBytes } from './googleOidc.js';

const TOKEN_PREFIX = 'ges1';
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days

export interface SessionClaims {
    readonly sub: string;
    readonly epoch: number;
    readonly iat: number;
    readonly exp: number;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < a.byteLength; i++) {
        diff |= a[i] ^ b[i];
    }
    return diff === 0;
}

async function importHmacSecret(secret: string): Promise<CryptoKey> {
    const raw = new Uint8Array(new TextEncoder().encode(secret));
    if (raw.byteLength < 32) {
        throw new Error('SESSION_HMAC_SECRET must be at least 32 UTF-8 bytes');
    }
    return crypto.subtle.importKey(
        'raw',
        raw,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
}

export async function issueSessionToken(options: {
    readonly secret: string;
    readonly ownerSubject: string;
    readonly tokenEpoch: number;
    readonly nowMs?: number;
    readonly ttlMs?: number;
}): Promise<{ sessionToken: string; expiresAt: number }> {
    const nowMs = options.nowMs ?? Date.now();
    const expiresAt = nowMs + (options.ttlMs ?? DEFAULT_SESSION_TTL_MS);
    const claims: SessionClaims = {
        sub: options.ownerSubject,
        epoch: options.tokenEpoch,
        iat: nowMs,
        exp: expiresAt,
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(claims));
    const payloadB64 = encodeBase64UrlBytes(payloadBytes);
    const signingInput = new Uint8Array(new TextEncoder().encode(`${TOKEN_PREFIX}.${payloadB64}`));
    const key = await importHmacSecret(options.secret);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, signingInput));
    return {
        sessionToken: `${TOKEN_PREFIX}.${payloadB64}.${encodeBase64UrlBytes(sig)}`,
        expiresAt,
    };
}

export async function verifySessionToken(
    token: string,
    secret: string,
    nowMs: number = Date.now(),
): Promise<SessionClaims> {
    if (typeof token !== 'string' || token.length < 24 || token.length > 2048) {
        throw new AuthVerificationError('Malformed session token');
    }
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
        throw new AuthVerificationError('Unsupported session token version');
    }
    const [, payloadB64, sigB64] = parts;
    const providedSig = decodeBase64UrlBytes(sigB64);
    const signingInput = new Uint8Array(new TextEncoder().encode(`${TOKEN_PREFIX}.${payloadB64}`));
    const key = await importHmacSecret(secret);
    const expectedSig = new Uint8Array(await crypto.subtle.sign('HMAC', key, signingInput));
    if (!constantTimeEqual(providedSig, expectedSig)) {
        throw new AuthVerificationError('Invalid session token signature');
    }

    const payloadBytes = decodeBase64UrlBytes(payloadB64);
    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
    } catch {
        throw new AuthVerificationError('Invalid session token claims');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AuthVerificationError('Invalid session token claims object');
    }
    const sub: unknown = Reflect.get(parsed, 'sub');
    const epoch: unknown = Reflect.get(parsed, 'epoch');
    const iat: unknown = Reflect.get(parsed, 'iat');
    const exp: unknown = Reflect.get(parsed, 'exp');

    if (typeof sub !== 'string' || !(sub.startsWith('vault:') || sub.startsWith('google:'))
        || typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1
        || typeof iat !== 'number' || !Number.isSafeInteger(iat)
        || typeof exp !== 'number' || !Number.isSafeInteger(exp)) {
        throw new AuthVerificationError('Malformed session token fields');
    }
    if (exp <= nowMs) {
        throw new AuthVerificationError('Session token expired');
    }
    return { sub, epoch, iat, exp };
}
