const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const VALID_GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LIFETIME_SECONDS = 24 * 3600;
const JWKS_DEFAULT_TTL_MS = 3600 * 1000;
const JWKS_MIN_REFRESH_INTERVAL_MS = 30 * 1000;

export interface VerifiedGoogleIdentity {
    /** Canonical tenant subject bound into client AEAD AAD: `google:<sub>`. */
    readonly ownerSubject: string;
    readonly googleSub: string;
    /** Returned transiently to the client UI; never stored in server persistence. */
    readonly email?: string;
}

export interface JwksFetcher {
    (): Promise<{ keys: readonly JsonWebKeyWithKid[]; maxAgeMs?: number }>;
}

export interface JsonWebKeyWithKid extends JsonWebKey {
    readonly kid?: string;
    readonly alg?: string;
    readonly use?: string;
}

export class AuthVerificationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuthVerificationError';
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function decodeBase64UrlBytes(segment: string): Uint8Array<ArrayBuffer> {
    if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
        throw new AuthVerificationError('Invalid base64url segment');
    }
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
        + '='.repeat((4 - (segment.length % 4)) % 4);
    let binary: string;
    try {
        binary = atob(padded);
    } catch {
        throw new AuthVerificationError('Malformed base64url encoding');
    }
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

export function encodeBase64UrlBytes(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeJwtJson(segment: string): Record<string, unknown> {
    const bytes = decodeBase64UrlBytes(segment);
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new AuthVerificationError('Invalid UTF-8 in JWT segment');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new AuthVerificationError('Malformed JSON in JWT segment');
    }
    if (!isPlainObject(parsed)) {
        throw new AuthVerificationError('JWT segment is not a JSON object');
    }
    return parsed;
}

function parseCacheMaxAgeMs(cacheControl: string | null): number | undefined {
    if (!cacheControl) return undefined;
    const match = /\bmax-age=(\d+)\b/i.exec(cacheControl);
    if (!match) return undefined;
    const seconds = Number(match[1]);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

export function createDefaultGoogleJwksFetcher(fetchFn: typeof fetch = globalThis.fetch): JwksFetcher {
    return async () => {
        const response = await fetchFn(GOOGLE_JWKS_URL, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
            throw new AuthVerificationError(`Failed to fetch Google JWKS: HTTP ${response.status}`);
        }
        const raw: unknown = await response.json();
        if (!isPlainObject(raw) || !Array.isArray(raw.keys)) {
            throw new AuthVerificationError('Invalid Google JWKS payload');
        }
        const rawKeys: readonly unknown[] = raw.keys;
        const keys: JsonWebKeyWithKid[] = [];
        for (const entry of rawKeys) {
            if (!isPlainObject(entry)) continue;
            const kid = typeof entry.kid === 'string' ? entry.kid : undefined;
            const kty = typeof entry.kty === 'string' ? entry.kty : undefined;
            const n = typeof entry.n === 'string' ? entry.n : undefined;
            const e = typeof entry.e === 'string' ? entry.e : undefined;
            const alg = typeof entry.alg === 'string' ? entry.alg : undefined;
            const use = typeof entry.use === 'string' ? entry.use : undefined;
            if (kid && kty === 'RSA' && n && e) {
                keys.push({ kty, kid, n, e, ...(alg ? { alg } : {}), ...(use ? { use } : {}) });
            }
        }
        return { keys, maxAgeMs: parseCacheMaxAgeMs(response.headers.get('cache-control')) };
    };
}

export interface GoogleOidcVerifier {
    verifyIdToken(idToken: string, allowedClientIds: readonly string[], nowMs?: number): Promise<VerifiedGoogleIdentity>;
}

/**
 * Stateful JWKS-cached RS256 verifier for Google OpenID Connect ID tokens.
 */
export function createGoogleOidcVerifier(fetchJwks: JwksFetcher = createDefaultGoogleJwksFetcher()): GoogleOidcVerifier {
    let cachedKeys = new Map<string, CryptoKey>();
    let expiresAtMs = 0;
    let lastFetchedAtMs = 0;
    let inflight: Promise<Map<string, CryptoKey>> | null = null;

    const reloadKeys = async (nowMs: number): Promise<Map<string, CryptoKey>> => {
        if (inflight) return inflight;
        inflight = (async () => {
            try {
                const { keys, maxAgeMs } = await fetchJwks();
                const imported = new Map<string, CryptoKey>();
                for (const jwk of keys) {
                    if (!jwk.kid || jwk.kty !== 'RSA') continue;
                    if (jwk.alg && jwk.alg !== 'RS256') continue;
                    if (jwk.use && jwk.use !== 'sig') continue;
                    const cryptoKey = await crypto.subtle.importKey(
                        'jwk',
                        jwk,
                        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                        false,
                        ['verify'],
                    );
                    imported.set(jwk.kid, cryptoKey);
                }
                cachedKeys = imported;
                lastFetchedAtMs = nowMs;
                expiresAtMs = nowMs + (maxAgeMs ?? JWKS_DEFAULT_TTL_MS);
                return imported;
            } finally {
                inflight = null;
            }
        })();
        return inflight;
    };

    const resolveSigningKey = async (kid: string, nowMs: number): Promise<CryptoKey> => {
        if (nowMs < expiresAtMs) {
            const hit = cachedKeys.get(kid);
            if (hit) return hit;
        }
        if (cachedKeys.size > 0 && nowMs - lastFetchedAtMs < JWKS_MIN_REFRESH_INTERVAL_MS && nowMs < expiresAtMs) {
            throw new AuthVerificationError('Unknown Google signing key ID');
        }
        const refreshed = await reloadKeys(nowMs);
        const found = refreshed.get(kid);
        if (!found) throw new AuthVerificationError('Unknown Google signing key ID');
        return found;
    };

    return {
        async verifyIdToken(
            idToken: string,
            allowedClientIds: readonly string[],
            nowMs: number = Date.now(),
        ): Promise<VerifiedGoogleIdentity> {
            const audiences = allowedClientIds.map(id => id.trim()).filter(Boolean);
            if (audiences.length === 0) {
                throw new AuthVerificationError('Server has no configured Google OAuth Client IDs');
            }
            if (typeof idToken !== 'string' || idToken.length < 32 || idToken.length > 16384) {
                throw new AuthVerificationError('Invalid ID token format');
            }
            const parts = idToken.split('.');
            if (parts.length !== 3) {
                throw new AuthVerificationError('JWT must contain 3 segments');
            }
            const [headerB64, payloadB64, sigB64] = parts;
            const header = decodeJwtJson(headerB64);
            if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
                throw new AuthVerificationError('Unsupported JWT algorithm or missing kid');
            }
            const payload = decodeJwtJson(payloadB64);
            if (typeof payload.iss !== 'string' || !VALID_GOOGLE_ISSUERS.has(payload.iss)) {
                throw new AuthVerificationError('Invalid Google token issuer');
            }
            const audMatch = typeof payload.aud === 'string'
                ? audiences.includes(payload.aud)
                : Array.isArray(payload.aud) && payload.aud.some((a): a is string => typeof a === 'string' && audiences.includes(a));
            if (!audMatch) {
                throw new AuthVerificationError('Google token audience mismatch');
            }
            const nowSec = Math.floor(nowMs / 1000);
            if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= nowSec - CLOCK_SKEW_SECONDS) {
                throw new AuthVerificationError('Google ID token has expired');
            }
            if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)
                || payload.iat > nowSec + CLOCK_SKEW_SECONDS
                || payload.exp - payload.iat > MAX_TOKEN_LIFETIME_SECONDS) {
                throw new AuthVerificationError('Invalid Google ID token issued-at window');
            }
            if (typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(payload.sub)) {
                throw new AuthVerificationError('Invalid Google subject identifier');
            }

            const signingKey = await resolveSigningKey(header.kid, nowMs);
            const signingInput = new Uint8Array(new TextEncoder().encode(`${headerB64}.${payloadB64}`));
            const signatureBytes = decodeBase64UrlBytes(sigB64);
            const validSig = await crypto.subtle.verify(
                'RSASSA-PKCS1-v1_5',
                signingKey,
                signatureBytes,
                signingInput,
            );
            if (!validSig) {
                throw new AuthVerificationError('Google ID token cryptographic signature invalid');
            }

            const email = typeof payload.email === 'string' && payload.email_verified !== false && payload.email.trim()
                ? payload.email.trim()
                : undefined;

            return {
                ownerSubject: `google:${payload.sub}`,
                googleSub: payload.sub,
                ...(email ? { email } : {}),
            };
        },
    };
}
