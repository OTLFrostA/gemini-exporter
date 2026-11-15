import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createGoogleOidcVerifier,
    encodeBase64UrlBytes,
    type JsonWebKeyWithKid,
} from '../cloud-server/src/auth/googleOidc.js';
import { createCloudServerHandler } from '../cloud-server/src/router.js';
import {
    createCloudflareVaultStore,
    createInMemoryVaultStore,
    sha256Hex,
    type D1DatabaseLike,
    type D1PreparedStatementLike,
    type R2BucketLike,
} from '../cloud-server/src/storage/vaultStore.js';
import { deriveVaultKeyring, generateMasterKeyBytes } from '../src/shared/crypto/index.js';
import { openCloudConversation, sealCloudConversation } from '../src/application/cloud/cloudArchiveCodec.js';
import type { Account } from '../src/l2/accountRegistry.js';
import type { ReadonlyDomain } from '../src/l2/runtimeValidation.js';
import type {
    CloudAuthSessionResponse,
    CloudChangesResponse,
    CloudErrorResponse,
    CloudRecordMeta,
    CloudVaultStatusResponse,
} from '../src/shared/types/cloudSync.js';

const CLIENT_ID = '999999999999-testclient.apps.googleusercontent.com';
const SESSION_SECRET = 'super-high-entropy-hmac-secret-at-least-32-bytes-long!!';
const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

async function createTestOidcFixture() {
    const keyPair = await crypto.subtle.generateKey(
        {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['sign', 'verify'],
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const jwkWithKid: JsonWebKeyWithKid = { ...publicJwk, kid: 'google-key-1', alg: 'RS256', use: 'sig' };

    const signIdToken = async (claims: Record<string, unknown>, kid = 'google-key-1'): Promise<string> => {
        const headerB64 = encodeBase64UrlBytes(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })));
        const payloadB64 = encodeBase64UrlBytes(new TextEncoder().encode(JSON.stringify(claims)));
        const signingInput = new Uint8Array(new TextEncoder().encode(`${headerB64}.${payloadB64}`));
        const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, signingInput));
        return `${headerB64}.${payloadB64}.${encodeBase64UrlBytes(sig)}`;
    };

    const verifier = createGoogleOidcVerifier(async () => ({ keys: [jwkWithKid], maxAgeMs: 3600_000 }));
    return { verifier, signIdToken };
}

function sampleAccountAndConversation(conversationId = 'c_cloud_test_1', text = 'Confidential research notes'): {
    account: Account;
    conversation: ReadonlyDomain;
} {
    const account: Account = {
        id: '11111111-1111-4111-8111-111111111111',
        providerId: 'gemini',
        providerAccountId: 'gaia-alice-01',
        email: 'alice@example.com',
    };
    const key = { accountId: account.id, conversationId };
    return {
        account,
        conversation: {
            index: { key, title: 'Secret Topic', titleSource: 'provider', updatedAt: 1710000000000 },
            detail: {
                key,
                savedAt: 1710000000000,
                quality: { status: 'complete', sourceTurn: 'finished' },
                assets: [],
                messages: [
                    { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Question?' }] }] },
                    { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text }] }] },
                ],
            },
        },
    };
}

test('Google OIDC RS256 verifier accepts valid Google ID tokens and rejects tampered signatures, wrong audiences, wrong issuers, and expired tokens', async () => {
    const { verifier, signIdToken } = await createTestOidcFixture();
    const nowMs = 1_750_000_000_000;
    const nowSec = Math.floor(nowMs / 1000);

    const validJwt = await signIdToken({
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: '109876543210987654321',
        email: 'alice@example.com',
        email_verified: true,
        iat: nowSec - 10,
        exp: nowSec + 3600,
    });
    const identity = await verifier.verifyIdToken(validJwt, [CLIENT_ID], nowMs);
    assert.deepEqual(identity, {
        ownerSubject: 'google:109876543210987654321',
        googleSub: '109876543210987654321',
        email: 'alice@example.com',
    });

    // Tampered payload with original signature
    const segments = validJwt.split('.');
    const forgedPayload = encodeBase64UrlBytes(new TextEncoder().encode(JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: 'victim_sub_id',
        iat: nowSec - 10,
        exp: nowSec + 3600,
    })));
    await assert.rejects(verifier.verifyIdToken(`${segments[0]}.${forgedPayload}.${segments[2]}`, [CLIENT_ID], nowMs), /signature invalid/);

    // Wrong audience (Confused Deputy defense)
    const wrongAud = await signIdToken({
        iss: 'https://accounts.google.com',
        aud: 'other-app.apps.googleusercontent.com',
        sub: '109876543210987654321',
        iat: nowSec - 10,
        exp: nowSec + 3600,
    });
    await assert.rejects(verifier.verifyIdToken(wrongAud, [CLIENT_ID], nowMs), /audience mismatch/);

    // Wrong issuer
    const wrongIss = await signIdToken({
        iss: 'https://evil.example.com',
        aud: CLIENT_ID,
        sub: '109876543210987654321',
        iat: nowSec - 10,
        exp: nowSec + 3600,
    });
    await assert.rejects(verifier.verifyIdToken(wrongIss, [CLIENT_ID], nowMs), /issuer/);

    // Expired token
    const expired = await signIdToken({
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: '109876543210987654321',
        iat: nowSec - 7200,
        exp: nowSec - 3600,
    });
    await assert.rejects(verifier.verifyIdToken(expired, [CLIENT_ID], nowMs), /expired/);
});

test('Multi-tenant E2EE Cloud Vault enforces CORS, tenant isolation, plaintext rejection, optimistic concurrency (409), quotas (413), incremental change feed, and global logout revocation', async () => {
    const { verifier, signIdToken } = await createTestOidcFixture();
    const store = createInMemoryVaultStore();
    let clockMs = 1_750_000_000_000;
    const handler = createCloudServerHandler({
        store,
        oidcVerifier: verifier,
        config: {
            sessionHmacSecret: SESSION_SECRET,
            googleClientIds: [CLIENT_ID],
            allowedOrigins: [EXTENSION_ORIGIN],
            defaultQuotaBytes: 2048, // tight 2 KiB quota to test enforcement
            now: () => clockMs,
        },
    });

    // 1. Disallowed browser Origin is blocked with 403
    const badOriginRes = await handler(new Request('https://vault.example.com/v1/health', {
        headers: { Origin: 'https://malicious.site' },
    }));
    assert.equal(badOriginRes.status, 403);

    // Allowed Extension Origin preflight succeeds
    const preflightRes = await handler(new Request('https://vault.example.com/v1/vault/status', {
        method: 'OPTIONS',
        headers: { Origin: EXTENSION_ORIGIN },
    }));
    assert.equal(preflightRes.status, 204);
    assert.equal(preflightRes.headers.get('Access-Control-Allow-Origin'), EXTENSION_ORIGIN);

    // 2. Authenticate two distinct Google users (Alice & Bob)
    const nowSec = Math.floor(clockMs / 1000);
    const loginUser = async (sub: string, email: string): Promise<CloudAuthSessionResponse> => {
        const idToken = await signIdToken({
            iss: 'https://accounts.google.com',
            aud: CLIENT_ID,
            sub,
            email,
            email_verified: true,
            iat: nowSec - 5,
            exp: nowSec + 3600,
        });
        const res = await handler(new Request('https://vault.example.com/v1/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: EXTENSION_ORIGIN },
            body: JSON.stringify({ idToken }),
        }));
        assert.equal(res.status, 200);
        return (await res.json()) as CloudAuthSessionResponse;
    };

    const aliceAuth = await loginUser('alice_sub_001', 'alice@example.com');
    const bobAuth = await loginUser('bob_sub_002', 'bob@example.com');
    assert.equal(aliceAuth.ownerSubject, 'google:alice_sub_001');
    assert.equal(aliceAuth.email, 'alice@example.com');

    // 3. Plaintext safety interlock: accidental unencrypted JSON upload is rejected with 400 PLAINTEXT_REJECTED
    const dummyBlindId = 'a'.repeat(64);
    const plaintextAttempt = await handler(new Request(`https://vault.example.com/v1/vault/records/${dummyBlindId}`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${aliceAuth.sessionToken}`,
            'X-Expected-Revision': '0',
        },
        body: new TextEncoder().encode(JSON.stringify({ unencrypted: 'oops' })),
    }));
    assert.equal(plaintextAttempt.status, 400);
    const plaintextErr = (await plaintextAttempt.json()) as CloudErrorResponse;
    assert.equal(plaintextErr.error.code, 'PLAINTEXT_REJECTED');
    assert.equal(store.inspectRawBlobs().size, 0, 'rejected plaintext is never stored');

    // 4. Alice seals & uploads revision 1 of a real Domain conversation
    const aliceKeyring = await deriveVaultKeyring(generateMasterKeyBytes());
    const { account, conversation } = sampleAccountAndConversation('c_1', 'Revision 1 answer');
    const sealedR1 = await sealCloudConversation({
        keyring: aliceKeyring,
        ownerSubject: aliceAuth.ownerSubject,
        revision: 1,
        account,
        conversation,
    });
    const shaR1 = await sha256Hex(sealedR1.envelope);

    const putR1 = await handler(new Request(`https://vault.example.com/v1/vault/records/${sealedR1.blindRecordId}`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${aliceAuth.sessionToken}`,
            'X-Expected-Revision': '0',
            'X-Content-SHA256': shaR1,
        },
        body: sealedR1.envelope,
    }));
    assert.equal(putR1.status, 200);
    const metaR1 = (await putR1.json()) as CloudRecordMeta;
    assert.equal(metaR1.revision, 1);
    assert.equal(metaR1.changeSeq, 1);

    // 5. Strict tenant isolation: Bob cannot read or overwrite Alice's blindRecordId
    const bobReadAlice = await handler(new Request(`https://vault.example.com/v1/vault/records/${sealedR1.blindRecordId}`, {
        headers: { Authorization: `Bearer ${bobAuth.sessionToken}` },
    }));
    assert.equal(bobReadAlice.status, 404);

    // 6. Optimistic concurrency: repeating X-Expected-Revision: 0 fails with 409 REVISION_CONFLICT (currentRevision: 1)
    const stalePut = await handler(new Request(`https://vault.example.com/v1/vault/records/${sealedR1.blindRecordId}`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${aliceAuth.sessionToken}`,
            'X-Expected-Revision': '0',
        },
        body: sealedR1.envelope,
    }));
    assert.equal(stalePut.status, 409);
    const conflictBody = (await stalePut.json()) as CloudErrorResponse;
    assert.equal(conflictBody.error.code, 'REVISION_CONFLICT');
    assert.equal(conflictBody.error.currentRevision, 1);

    // 7. Legitimate update to revision 2 advances changeSeq and replaces old R2 blob without leaking quota
    clockMs += 5000;
    const updatedConv = sampleAccountAndConversation('c_1', 'Revision 2 updated answer').conversation;
    const sealedR2 = await sealCloudConversation({
        keyring: aliceKeyring,
        ownerSubject: aliceAuth.ownerSubject,
        revision: 2,
        account,
        conversation: updatedConv,
    });
    const putR2 = await handler(new Request(`https://vault.example.com/v1/vault/records/${sealedR2.blindRecordId}`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${aliceAuth.sessionToken}`,
            'X-Expected-Revision': '1',
        },
        body: sealedR2.envelope,
    }));
    assert.equal(putR2.status, 200);
    const metaR2 = (await putR2.json()) as CloudRecordMeta;
    assert.equal(metaR2.revision, 2);
    assert.equal(metaR2.changeSeq, 2);
    assert.equal(store.inspectRawBlobs().size, 1, 'old versioned blob was garbage-collected');

    const statusRes = await handler(new Request('https://vault.example.com/v1/vault/status', {
        headers: { Authorization: `Bearer ${aliceAuth.sessionToken}` },
    }));
    const vaultStatus = (await statusRes.json()) as CloudVaultStatusResponse;
    assert.equal(vaultStatus.recordCount, 1);
    assert.equal(vaultStatus.usedBytes, sealedR2.envelope.byteLength);
    assert.equal(vaultStatus.headSeq, 2);

    // 8. Incremental sync feed + full round-trip openCloudConversation verification
    const changesRes = await handler(new Request('https://vault.example.com/v1/vault/changes?since=0&limit=10', {
        headers: { Authorization: `Bearer ${aliceAuth.sessionToken}` },
    }));
    const changes = (await changesRes.json()) as CloudChangesResponse;
    assert.equal(changes.items.length, 1);
    assert.equal(changes.items[0]?.revision, 2);
    assert.equal(changes.nextSince, 2);

    const downloadRes = await handler(new Request(`https://vault.example.com/v1/vault/records/${sealedR2.blindRecordId}`, {
        headers: { Authorization: `Bearer ${aliceAuth.sessionToken}` },
    }));
    assert.equal(downloadRes.status, 200);
    assert.equal(downloadRes.headers.get('X-Record-Revision'), '2');
    const downloadedBytes = new Uint8Array(await downloadRes.arrayBuffer());
    const decrypted = await openCloudConversation({
        keyring: aliceKeyring,
        ownerSubject: aliceAuth.ownerSubject,
        blindRecordId: sealedR2.blindRecordId,
        revision: Number(downloadRes.headers.get('X-Record-Revision')),
        envelope: downloadedBytes,
    });
    assert.ok(JSON.stringify(decrypted.detail?.messages).includes('Revision 2 updated answer'));

    // 9. Per-user storage quota enforcement (413 QUOTA_EXCEEDED)
    const bigText = Array.from({ length: 400 }, (_, i) => `Unique incompressible token ${i}-${crypto.randomUUID()}`).join(' ');
    const { conversation: bigConv } = sampleAccountAndConversation('c_huge', bigText);
    const sealedBig = await sealCloudConversation({
        keyring: aliceKeyring,
        ownerSubject: aliceAuth.ownerSubject,
        revision: 1,
        account,
        conversation: bigConv,
    });
    assert.ok(sealedBig.envelope.byteLength > 2048);
    const overQuotaRes = await handler(new Request(`https://vault.example.com/v1/vault/records/${sealedBig.blindRecordId}`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${aliceAuth.sessionToken}`,
            'X-Expected-Revision': '0',
        },
        body: sealedBig.envelope,
    }));
    assert.equal(overQuotaRes.status, 413);
    assert.equal(((await overQuotaRes.json()) as CloudErrorResponse).error.code, 'QUOTA_EXCEEDED');

    // 10. Global token revocation via POST /v1/auth/logout-all invalidates existing sessionToken immediately
    const logoutRes = await handler(new Request('https://vault.example.com/v1/auth/logout-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${aliceAuth.sessionToken}` },
    }));
    assert.equal(logoutRes.status, 200);

    const revokedAttempt = await handler(new Request('https://vault.example.com/v1/vault/status', {
        headers: { Authorization: `Bearer ${aliceAuth.sessionToken}` },
    }));
    assert.equal(revokedAttempt.status, 401);
});

test('Cloudflare D1 + R2 VaultStore cleans up staged R2 orphan blobs when optimistic-lock D1 batch reports 0 changes', async () => {
    const r2Objects = new Map<string, Uint8Array>();
    const deletedKeys: string[] = [];
    const mockBucket: R2BucketLike = {
        async put(key, value) {
            r2Objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
        },
        async get(key) {
            const found = r2Objects.get(key);
            if (!found) return null;
            return { arrayBuffer: async () => found.slice().buffer };
        },
        async delete(keys) {
            for (const k of Array.isArray(keys) ? keys : [keys]) {
                deletedKeys.push(k);
                r2Objects.delete(k);
            }
        },
    };

    // Simulate a race where initial SELECT saw revision 1, but another Worker won the D1 batch first (changes = 0, revision now 2)
    let selectCount = 0;
    const makeStmt = (sql: string): D1PreparedStatementLike => ({
        bind() { return this; },
        async first<T>() {
            if (sql.includes('FROM users')) {
                return { user_id: 'google:u1', token_epoch: 1, used_bytes: 100, quota_bytes: 100_000, next_seq: 2 } as unknown as T;
            }
            if (sql.includes('FROM vault_records')) {
                selectCount++;
                return (selectCount === 1
                    ? { revision: 1, byte_length: 100, r2_key: 'v1/google%3Au1/' + 'b'.repeat(64) + '/r1' }
                    : { revision: 2, byte_length: 120, r2_key: 'v1/google%3Au1/' + 'b'.repeat(64) + '/r2' }) as unknown as T;
            }
            return null;
        },
        async all<T>() { return { results: [] as T[] }; },
        async run() { return { meta: { changes: 1 } }; },
    });
    const mockDb: D1DatabaseLike = {
        prepare: makeStmt,
        async batch() {
            return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
        },
    };

    const cfStore = createCloudflareVaultStore(mockDb, mockBucket);
    const payload = new Uint8Array(40);
    payload.set([0x47, 0x45, 0x45, 0x31], 0);
    const outcome = await cfStore.putRecord({
        ownerSubject: 'google:u1',
        blindRecordId: 'b'.repeat(64),
        expectedRevision: 1,
        ciphertext: payload,
        sha256: await sha256Hex(payload),
    });

    assert.deepEqual(outcome, { status: 'conflict', currentRevision: 2 });
    assert.equal(r2Objects.size, 0, 'staged R2 blob must be deleted immediately on D1 conflict');
    assert.equal(deletedKeys.length, 1);
});
