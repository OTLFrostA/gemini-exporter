import {
    CLOUD_DEFAULT_USER_QUOTA_BYTES,
    CLOUD_WIRE_MAGIC,
    type CloudChangesResponse,
    type CloudRecordMeta,
    type CloudVaultStatusResponse,
} from '../../src/shared/types/cloudSync.js';

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    let hex = '';
    for (const b of digest) hex += b.toString(16).padStart(2, '0');
    return hex;
}

interface MockTenant {
    keyFingerprint?: string;
    authVerifier?: string;
    purgeVerifierHash?: string;
    generation: number;
    usedBytes: number;
    nextSeq: number;
    records: Map<string, { meta: CloudRecordMeta; blobKey: string }>;
}

/**
 * Minimal client-side HTTP contract test double for `CloudVaultClient` unit & Playwright E2E tests.
 * Production server implementation lives in the separate private cloud repository.
 */
export function createMockCloudVaultHttp(options: {
    readonly serverAccessCode?: string;
    readonly protectedPurge?: boolean;
} = {}): {
    readonly handler: (request: Request) => Promise<Response>;
    readonly inspectRawBlobs: () => ReadonlyMap<string, Uint8Array>;
    readonly inspectTenantCount: () => number;
    readonly seedRawRecord: (ownerSubject: string, blindRecordId: string, ciphertext: Uint8Array<ArrayBuffer>) => Promise<void>;
} {
    const tenants = new Map<string, MockTenant>();
    const sessions = new Map<string, string>();
    const grants = new Map<string, { ownerSubject: string; generation: number }>();
    const blobs = new Map<string, Uint8Array<ArrayBuffer>>();

    const ensureTenant = (ownerSubject: string): MockTenant => {
        let t = tenants.get(ownerSubject);
        if (!t) {
            t = { usedBytes: 0, generation: 0, nextSeq: 1, records: new Map() };
            tenants.set(ownerSubject, t);
        }
        return t;
    };

    const corsHeaders = (origin: string | null): Record<string, string> => (origin ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Expected-Revision, X-Content-SHA256, X-Vault-Key-Fingerprint, X-Vault-Generation, X-Vault-Purge-Token',
        'Access-Control-Expose-Headers': 'ETag, X-Record-Revision, X-Record-Change-Seq, X-Content-SHA256, X-Vault-Generation, Retry-After',
    } : {});

    return {
        inspectRawBlobs: () => blobs,
        inspectTenantCount: () => tenants.size,

        async seedRawRecord(ownerSubject, blindRecordId, ciphertext) {
            const t = ensureTenant(ownerSubject);
            const rev = (t.records.get(blindRecordId)?.meta.revision ?? 0) + 1;
            const seq = t.nextSeq++;
            const blobKey = `${ownerSubject}/${blindRecordId}/r${rev}`;
            const copy = new Uint8Array(ciphertext.byteLength);
            copy.set(ciphertext);
            blobs.set(blobKey, copy);
            t.usedBytes += copy.byteLength;
            t.records.set(blindRecordId, {
                blobKey,
                meta: {
                    blindRecordId,
                    revision: rev,
                    changeSeq: seq,
                    byteLength: copy.byteLength,
                    sha256: await sha256Hex(copy),
                    updatedAt: Date.now(),
                },
            });
        },

        async handler(request: Request): Promise<Response> {
            const origin = request.headers.get('Origin');
            const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
            if (request.method === 'OPTIONS') {
                return new Response(null, { status: 204, headers: corsHeaders(origin) });
            }
            const url = new URL(request.url);
            const path = url.pathname;
            const method = request.method.toUpperCase();

            if (method === 'POST' && path === '/v2/auth/key') {
                const body = (await request.json()) as { keyFingerprint?: string; authToken?: string; accessCode?: string; mode?: string; purgeVerifierHash?: string };
                if (options.serverAccessCode && body.accessCode !== options.serverAccessCode) {
                    return new Response(
                        JSON.stringify({ error: { code: 'ACCESS_CODE_REQUIRED', message: 'Valid server access code is required' } }),
                        { status: 401, headers },
                    );
                }
                if (!body.keyFingerprint || !/^[0-9a-f]{32}$/.test(body.keyFingerprint)
                    || !body.authToken || !/^[0-9a-f]{64}$/.test(body.authToken)
                    || (body.mode !== 'create' && body.mode !== 'unlock')) {
                    return new Response(JSON.stringify({ error: { code: 'INVALID_REQUEST' } }), { status: 400, headers });
                }
                const ownerSubject = `vault:${body.keyFingerprint}`;
                const previous = tenants.get(ownerSubject);
                if (!previous?.authVerifier && body.mode !== 'create') {
                    return new Response(JSON.stringify({ error: { code: 'VAULT_NOT_FOUND' } }), { status: 404, headers });
                }
                const verifier = await sha256Hex(new TextEncoder().encode(`ge-auth-v2:${ownerSubject}:${body.authToken}`));
                const t = previous ?? ensureTenant(ownerSubject);
                if (!t.authVerifier) {
                    t.authVerifier = verifier;
                    t.keyFingerprint = body.keyFingerprint;
                    t.purgeVerifierHash = body.purgeVerifierHash;
                } else if (t.authVerifier !== verifier) {
                    return new Response(
                        JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid authToken' } }),
                        { status: 401, headers },
                    );
                }
                const token = `ges2.mock.${crypto.randomUUID()}`;
                sessions.set(token, ownerSubject);
                return new Response(
                    JSON.stringify({ sessionToken: token, ownerSubject, expiresAt: Date.now() + 7 * 86400_000 }),
                    { status: 200, headers },
                );
            }

            const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
            const ownerSubject = sessions.get(bearer);
            if (!ownerSubject) {
                return new Response(
                    JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid session token' } }),
                    { status: 401, headers },
                );
            }
            const tenant = ensureTenant(ownerSubject);
            if (options.protectedPurge && path !== '/v2/vault/status'
                && Number(request.headers.get('X-Vault-Generation') ?? '0') !== tenant.generation) {
                return Response.json({ error: { code: 'VAULT_GENERATION_MISMATCH' } }, { status: 409, headers });
            }
            const generation = options.protectedPurge ? { generation: tenant.generation } : {};


            if (method === 'GET' && path === '/v2/vault/status') {
                const status: CloudVaultStatusResponse = {
                    ownerSubject,
                    recordCount: tenant.records.size,
                    usedBytes: tenant.usedBytes,
                    quotaBytes: CLOUD_DEFAULT_USER_QUOTA_BYTES,
                    headSeq: tenant.nextSeq - 1,
                    ...generation,
                    ...(tenant.keyFingerprint ? { keyFingerprint: tenant.keyFingerprint } : {}),
                };
                return new Response(JSON.stringify(status), { status: 200, headers });
            }

            if (method === 'GET' && path === '/v2/vault/changes') {
                const since = Number(url.searchParams.get('since') ?? '0');
                const limit = Number(url.searchParams.get('limit') ?? '100');
                const all = [...tenant.records.values()]
                    .map(r => r.meta)
                    .filter(m => m.changeSeq > since)
                    .sort((a, b) => a.changeSeq - b.changeSeq);
                const hasMore = all.length > limit;
                const items = hasMore ? all.slice(0, limit) : all;
                const feed: CloudChangesResponse = {
                    items,
                    nextSince: items.length > 0 ? items[items.length - 1]!.changeSeq : since,
                    headSeq: tenant.nextSeq - 1,
                    ...generation,
                    hasMore,
                };
                return new Response(JSON.stringify(feed), { status: 200, headers });
            }

            if (options.protectedPurge && method === 'POST' && path === '/v2/vault/purge-authorization') {
                const hash = await sha256Hex(new TextEncoder().encode(await request.text()));
                if (!tenant.purgeVerifierHash || hash !== tenant.purgeVerifierHash) {
                    return new Response(null, { status: 401, headers });
                }
                const purgeToken = `gep2.mock.${crypto.randomUUID()}`;
                grants.set(purgeToken, { ownerSubject, generation: tenant.generation });
                return Response.json({ purgeToken }, { headers });
            }

            if (method === 'DELETE' && path === '/v2/vault') {
                if (options.protectedPurge) {
                    const token = request.headers.get('X-Vault-Purge-Token') ?? '';
                    const grant = grants.get(token);
                    if (!grant || grant.ownerSubject !== ownerSubject || grant.generation !== tenant.generation) {
                        return new Response(null, { status: 403, headers });
                    }
                    grants.delete(token);
                    tenant.generation++;
                }
                for (const r of tenant.records.values()) blobs.delete(r.blobKey);
                tenant.records.clear();
                tenant.usedBytes = 0;
                return new Response(JSON.stringify({ ok: true, ...(options.protectedPurge ? { generation: tenant.generation } : {}) }), { status: 200, headers });
            }

            const recPrefix = '/v2/vault/records/';
            if (path.startsWith(recPrefix)) {
                const blindId = path.slice(recPrefix.length);
                if (method === 'GET') {
                    const rec = tenant.records.get(blindId);
                    if (!rec) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: 404, headers });
                    const raw = blobs.get(rec.blobKey)!;
                    return new Response(raw, {
                        status: 200,
                        headers: {
                            ...corsHeaders(origin),
                            'Content-Type': 'application/octet-stream',
                            'X-Record-Revision': String(rec.meta.revision),
                            'X-Record-Change-Seq': String(rec.meta.changeSeq),
                            'X-Content-SHA256': rec.meta.sha256,
                            ...(options.protectedPurge ? { 'X-Vault-Generation': String(tenant.generation) } : {}),
                        },
                    });
                }
                if (method === 'PUT') {
                    const expectedRev = Number(request.headers.get('X-Expected-Revision') ?? '0');
                    const keyFp = request.headers.get('X-Vault-Key-Fingerprint');
                    if (tenant.keyFingerprint !== keyFp) {
                        return new Response(
                            JSON.stringify({ error: { code: 'KEY_FINGERPRINT_MISMATCH', message: 'Key mismatch', vaultKeyFingerprint: tenant.keyFingerprint } }),
                            { status: 409, headers },
                        );
                    }
                    const payload = new Uint8Array(await request.arrayBuffer());
                    if (payload.byteLength < 32 || payload[0] !== CLOUD_WIRE_MAGIC[0] || payload[1] !== CLOUD_WIRE_MAGIC[1]) {
                        return new Response(JSON.stringify({ error: { code: 'PLAINTEXT_REJECTED', message: 'Not GEE1' } }), { status: 400, headers });
                    }
                    const existing = tenant.records.get(blindId);
                    const currentRevision = existing?.meta.revision ?? 0;
                    if (currentRevision !== expectedRev) {
                        return new Response(
                            JSON.stringify({ error: { code: 'REVISION_CONFLICT', message: 'Conflict', currentRevision } }),
                            { status: 409, headers },
                        );
                    }
                    const nextRevision = currentRevision + 1;
                    const seq = tenant.nextSeq++;
                    const blobKey = `${ownerSubject}/${blindId}/r${nextRevision}`;
                    blobs.set(blobKey, payload);
                    if (existing) {
                        blobs.delete(existing.blobKey);
                        tenant.usedBytes -= existing.meta.byteLength;
                    }
                    tenant.usedBytes += payload.byteLength;
                    const meta: CloudRecordMeta = {
                        blindRecordId: blindId,
                        revision: nextRevision,
                        changeSeq: seq,
                        byteLength: payload.byteLength,
                        sha256: await sha256Hex(payload),
                        updatedAt: Date.now(),
                    };
                    tenant.records.set(blindId, { meta, blobKey });
                    return new Response(JSON.stringify(meta), { status: 200, headers });
                }
            }

            return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: 404, headers });
        },
    };
}
