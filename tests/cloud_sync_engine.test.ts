import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudVaultClient, normalizeCloudServerUrl } from '../src/l1/cloud/vaultClient.js';
import { createCloudSyncEngine } from '../src/application/cloud/cloudSyncEngine.js';
import { updateSettings } from '../src/application/settings/index.js';
import { ingestDetail, ingestIndexes } from '../src/l2/ingestion.js';
import { readConversation } from '../src/l2/readConversation.js';
import { getOrCreateAccount } from '../src/runtime/api/accountRegistry.js';
import { indexStorage } from './helpers/indexStorage.js';
import { createMockCloudVaultHttp } from './helpers/mockCloudVaultHttp.js';
import { createVaultKeySetup, prepareOneTimeVaultKey } from '../src/application/cloud/vaultKeySetup.js';
import { enqueueCloudOutboxKeys, listDueCloudOutbox, putCloudSyncSession, getCloudSyncSession, getSyncedCloudRecord, putSyncedCloudRecord } from '../src/l3a/cloudSyncStore.js';
import { deleteStoredConversation, getIndex } from '../src/l3a/storageService.js';
import { deriveBlindRecordId, deriveVaultKeyring, encodeLengthPrefixedTuple, parseRecoveryKey } from '../src/shared/crypto/index.js';
import { OperationError } from '../src/shared/errors/operationError.js';
import { CLOUD_MAX_RECORD_BYTES } from '../src/shared/types/cloudSync.js';

const SERVER_URL = 'https://vault.gemini-exporter.test';

function attachSharedChromeSync(sharedSyncBag: Record<string, unknown>): void {
    const syncArea = {
        async get(keys: string | string[] | null) {
            if (keys === null) return structuredClone(sharedSyncBag);
            const list = typeof keys === 'string' ? [keys] : keys;
            return structuredClone(Object.fromEntries(list.filter(k => k in sharedSyncBag).map(k => [k, sharedSyncBag[k]])));
        },
        async set(patch: Record<string, unknown>) {
            Object.assign(sharedSyncBag, structuredClone(patch));
        },
    };
    Object.assign(globalThis.chrome.storage, { sync: syncArea });
}

test('vaultClient rejects insecure non-loopback HTTP URLs and normalizes HTTPS origins', () => {
    assert.throws(() => normalizeCloudServerUrl('http://vault.example.com'), /HTTPS/);
    assert.equal(normalizeCloudServerUrl('https://vault.example.com/'), 'https://vault.example.com');
    assert.equal(normalizeCloudServerUrl('http://localhost:8787/api/'), 'http://localhost:8787/api');
});

test('CloudSyncEngine upgrades existing key metadata without requiring recovery key re-entry', async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const legacyKeyring = await deriveVaultKeyring(new Uint8Array(32).fill(42));
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open('gemini_exporter_cloud_v2', 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('localKeys', { keyPath: 'ownerSubject' }).put({
                    ownerSubject: 'primary:vault', origin: 'generated', ...legacyKeyring,
                });
            };
            request.onsuccess = () => { request.result.close(); resolve(); };
            request.onerror = () => reject(request.error);
        });
        const backend = createMockCloudVaultHttp();
        const engine = createCloudSyncEngine({ client: createCloudVaultClient(
            (url, init) => backend.handler(new Request(url, init)),
        ) });
        const before = await engine.getStatusSnapshot();
        assert.equal(before.hasRecoveryKey, true);
        assert.equal(before.keyFingerprint, legacyKeyring.keyFingerprint);
        assert.equal(before.keyOrigin, 'generated');
        await engine.connectCloudVault(SERVER_URL);
        assert.equal(backend.inspectTenantCount(), 1);
        const after = await engine.getStatusSnapshot();
        assert.equal(after.keyFingerprint, before.keyFingerprint);
        assert.equal(after.keyOrigin, 'imported');
    } finally {
        env.restore();
    }
});

test('CloudSyncEngine: explicit creation and manual pairing retain auto-enqueue, offline retry and conflict healing', async () => {
    const backend = createMockCloudVaultHttp();
    const sharedChromeSync: Record<string, unknown> = {};
    let networkOffline = false;
    let clockMs = Date.now();
    let recoveryKey = '';
    let fingerprint = '';

    const transport = async (url: string, init?: RequestInit): Promise<Response> => {
        if (networkOffline) throw new TypeError('Failed to fetch: network offline');
        return backend.handler(new Request(url, init));
    };

    // ================= DEVICE A =================
    const envA = indexStorage();
    try {
        await envA.ready;
        attachSharedChromeSync(sharedChromeSync);
        const engineA = createCloudSyncEngine({
            client: createCloudVaultClient(transport),
            now: () => clockMs,
        });
        const unsubscribeA = engineA.installAutoEnqueueListener();
        try {
            const accA = await getOrCreateAccount('gemini', 'gaia-sync-user-1', 'sync@example.com', 'Sync User');

            // 1. Pre-toggle conversation BEFORE cloud sync is enabled: nothing uploaded while disabled
            await ingestDetail(accA.id, 'c_before_toggle', {
                savedAt: 1000,
                quality: { status: 'complete' },
                assets: [],
                messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Old pre-toggle chat' }] }] }],
            }, { title: 'Old Pre-Toggle', titleSource: 'provider', updatedAt: 1000 });
            assert.equal(backend.inspectRawBlobs().size, 0, 'nothing uploaded while Cloud Sync is disabled');

            recoveryKey = await prepareOneTimeVaultKey();
            assert.equal((await engineA.getStatusSnapshot()).hasRecoveryKey, false, 'a draft does not initialize custody');
            const setup = createVaultKeySetup(engineA.activateVaultKeyring);
            const committed = await setup(recoveryKey, 'generated', null);
            fingerprint = committed.keyFingerprint;
            assert.equal((await engineA.getStatusSnapshot()).keyOrigin, 'generated');
            await assert.rejects(setup(await prepareOneTimeVaultKey(), 'generated', null), { code: 'CLOUD_KEY_CHANGED' });
            await assert.rejects(engineA.connectCloudVault(SERVER_URL, undefined, 'unlock'), { code: 'CLOUD_VAULT_NOT_FOUND' });
            assert.equal(backend.inspectTenantCount(), 0, 'unlock never provisions a tenant');
            // Newly generated key automatically uses mode='create' on first Cloud Vault connection, then transitions keyOrigin to 'imported'
            const connectedA = await engineA.connectCloudVault(SERVER_URL);
            assert.equal(connectedA.keyFingerprint, fingerprint);
            assert.equal((await engineA.getStatusSnapshot()).keyOrigin, 'imported');
            assert.equal('recoveryKey' in connectedA, false);
            assert.deepEqual(sharedChromeSync, {}, 'initialization never writes Chrome Sync');
            await engineA.setIncludeDetail(true);
            await engineA.setAutoSyncEnabled(true);
            await engineA.waitForIdle();

            assert.equal(backend.inspectRawBlobs().size, 1, 'enabling sync immediately reconciles & uploads pre-existing history without manual buttons');

            // 2. Post-toggle conversation arrives while network is offline -> persisted in Outbox with backoff
            networkOffline = true;
            await ingestDetail(accA.id, 'c_post_toggle_1', {
                savedAt: 2000,
                quality: { status: 'complete' },
                assets: [],
                messages: [
                    { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Auto-synced prompt' }] }] },
                    { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Auto-synced answer v1' }] }] },
                ],
            }, { title: 'Post-Toggle Topic', titleSource: 'provider', updatedAt: 2000 });

            await engineA.waitForIdle();
            const offlineStatus = await engineA.getStatusSnapshot();
            assert.equal(offlineStatus.pendingOutbox, 1);
            assert.equal(offlineStatus.failedOutbox, 1);
            assert.equal(backend.inspectRawBlobs().size, 1);

            // 3. Network recovers and time advances past retry backoff -> flushOutbox uploads automatically!
            networkOffline = false;
            clockMs += 10_000;
            const flush1 = await engineA.flushOutbox();
            assert.equal(flush1.uploaded, 1);
            assert.equal((await engineA.getStatusSnapshot()).pendingOutbox, 0);
            assert.equal(backend.inspectRawBlobs().size, 2);

            // 4. Subsequent Index title upgrade on the same conversation automatically pushes revision 2!
            await ingestIndexes(accA.id, [{
                conversationId: 'c_post_toggle_1',
                fields: { title: 'User Renamed Topic', titleSource: 'user', updatedAt: 2500 },
            }]);
            await engineA.waitForIdle();
            assert.equal((await engineA.getStatusSnapshot()).pendingOutbox, 0);
        } finally {
            unsubscribeA();
            await engineA.waitForIdle();
        }
    } finally {
        envA.restore();
    }

    // ================= DEVICE B (Fresh DB, same Chrome Sync account) =================
    const envB = indexStorage();
    try {
        await envB.ready;
        attachSharedChromeSync(sharedChromeSync);
        const restoreCursors: string[] = [];
        const engineB = createCloudSyncEngine({
            client: createCloudVaultClient((url, init) => {
                const parsed = new URL(url);
                if (parsed.pathname === '/v2/vault/changes') {
                    restoreCursors.push(parsed.searchParams.get('since') ?? '');
                    parsed.searchParams.set('limit', '1');
                }
                return transport(parsed.href, init);
            }),
            now: () => clockMs,
        });
        const unsubscribeB = engineB.installAutoEnqueueListener();
        try {
            await assert.rejects(engineB.connectCloudVault(SERVER_URL, undefined, 'unlock'), { code: 'CLOUD_KEY_NOT_INITIALIZED' });
            await createVaultKeySetup(engineB.activateVaultKeyring)(recoveryKey, 'imported', null);
            const connectedB = await engineB.connectCloudVault(SERVER_URL, undefined, 'unlock');
            assert.equal(connectedB.keyFingerprint, fingerprint);
            assert.equal(backend.inspectTenantCount(), 1);
            await engineB.setIncludeDetail(true);
            await engineB.setAutoSyncEnabled(true);
            await engineB.waitForIdle();

            // Enabling sync on Device B already pulled both records automatically without manual pullChanges()!
            assert.deepEqual(restoreCursors, ['0', '1']);
            assert.equal((await engineB.getStatusSnapshot()).pendingOutbox, 0, 'restoring from cloud must NOT echo back into Outbox');

            // Verify conversation landed on Device B with the upgraded user title and v1 answer
            const accB = await getOrCreateAccount('gemini', 'gaia-sync-user-1');
            const restoredPreExisting = await readConversation({ accountId: accB.id, conversationId: 'c_before_toggle' });
            assert.equal(restoredPreExisting?.index.title, 'Old Pre-Toggle');
            const restoredOnB = await readConversation({ accountId: accB.id, conversationId: 'c_post_toggle_1' });
            assert.ok(restoredOnB);
            assert.equal(restoredOnB.index.title, 'User Renamed Topic');

            // Device B appends a newer turn (savedAt: 3000) and syncs revision 3 to server
            await ingestDetail(accB.id, 'c_post_toggle_1', {
                savedAt: 3000,
                quality: { status: 'complete' },
                assets: [],
                messages: [
                    { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Auto-synced prompt' }] }] },
                    { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Device B newer answer v3' }] }] },
                ],
            }, { updatedAt: 3000 });
            await engineB.waitForIdle();
            await engineB.flushOutbox();
        } finally {
            unsubscribeB();
            await engineB.waitForIdle();
        }
    } finally {
        envB.restore();
    }

    // ================= DEVICE C (Simulates stale revision 1 hitting 409 Conflict against server revision 3) =================
    const envC = indexStorage();
    try {
        await envC.ready;
        attachSharedChromeSync(sharedChromeSync);
        const engineC = createCloudSyncEngine({
            client: createCloudVaultClient(transport),
            now: () => clockMs,
        });
        await createVaultKeySetup(engineC.activateVaultKeyring)(recoveryKey, 'imported', null);
        await engineC.connectCloudVault(SERVER_URL, undefined, 'unlock');
        await engineC.setIncludeDetail(true);

        // Device C has NOT pulled yet (thinks remoteRevision is 0), and has an older local draft (savedAt: 1500)
        const accC = await getOrCreateAccount('gemini', 'gaia-sync-user-1');
        await ingestDetail(accC.id, 'c_post_toggle_1', {
            savedAt: 1500,
            quality: { status: 'partial' },
            assets: [],
            messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Stale draft on C' }] }] }],
        }, { title: 'Draft Title', titleSource: 'derived', updatedAt: 1500 });

        await updateSettings({ cloudSyncEnabled: true });
        await engineC.enqueueAllExistingHistory();
        // Pushing from C hits 409 (expected 0 vs server 3) -> auto-pulls rev 3 -> L2 merges (rev 3 wins!) -> converges with 0 overwrite!
        const conflictHeal = await engineC.flushOutbox();
        assert.equal(conflictHeal.skippedUnchanged, 1, 'after pulling superior server rev 3, Device C converges without overwriting server');

        const convergedOnC = await readConversation({ accountId: accC.id, conversationId: 'c_post_toggle_1' });
        assert.ok(convergedOnC);
        assert.equal(convergedOnC.index.title, 'User Renamed Topic');
        assert.ok(JSON.stringify(convergedOnC.detail.messages).includes('Device B newer answer v3'));

        // Connected key rotation: if user forgot saved key, generating a fresh key while connected switches cleanly to a new Cloud Vault tenant
        const rotatedRecoveryKey = await prepareOneTimeVaultKey();
        const rotateOutcome = await createVaultKeySetup(engineC.activateVaultKeyring)(rotatedRecoveryKey, 'generated', fingerprint);
        assert.equal(rotateOutcome.resolution, 'rekeyed');
        assert.notEqual(rotateOutcome.keyFingerprint, fingerprint);
        assert.equal(backend.inspectTenantCount(), 2);
        assert.equal(rotateOutcome.cloudBackup?.saved, 2, 'both local conversations backed up and verified before switching');
        const postRotateSync = await engineC.syncNow();
        assert.equal(postRotateSync.push.uploaded, 0, 'the verified backup is not reuploaded');
    } finally {
        envC.restore();
    }
});

test('CloudSyncEngine: a PUT acknowledgment preserves an update queued during upload', async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const mock = createMockCloudVaultHttp();
        const puts = [0, 1].map(() => {
            let started!: (request: Request) => void;
            let release!: () => void;
            const request = new Promise<Request>(resolve => { started = resolve; });
            const gate = new Promise<void>(resolve => { release = resolve; });
            return { request, gate, started, release };
        });
        let putCount = 0;
        const client = createCloudVaultClient(async (url, init) => {
            const request = new Request(url, init);
            if (request.method === 'PUT') {
                const put = puts[putCount++];
                if (put) {
                    put.started(request);
                    await put.gate;
                }
            }
            return mock.handler(request);
        });
        const nowMs = Date.now();
        const engine = createCloudSyncEngine({ client, now: () => nowMs });
        await createVaultKeySetup(engine.activateVaultKeyring)(await prepareOneTimeVaultKey(), 'generated', null);
        await engine.connectCloudVault(SERVER_URL, undefined, 'create');
        await engine.setAutoSyncEnabled(true);
        await engine.waitForIdle();

        const account = await getOrCreateAccount('gemini', 'gaia-outbox-race', 'race@example.com', 'Outbox Race');
        const conversationId = 'c_outbox_race';
        const key = { accountId: account.id, conversationId };
        await ingestIndexes(account.id, [{
            conversationId, fields: { title: 'Original', titleSource: 'provider', updatedAt: nowMs - 1 },
        }]);
        await enqueueCloudOutboxKeys([key], nowMs);

        const flush = engine.flushOutbox();
        try {
            const original = await Promise.race([puts[0].request, flush.then(() => null)]);
            assert.ok(original, 'the original upload reached PUT');
            await ingestIndexes(account.id, [{
                conversationId, fields: { title: 'Updated', titleSource: 'provider', updatedAt: nowMs },
            }]);
            await enqueueCloudOutboxKeys([key], nowMs);
            assert.equal((await listDueCloudOutbox(nowMs)).length, 1, 'the update was queued before the ack');

            puts[0].release();
            const updated = await Promise.race([puts[1].request, flush.then(() => null)]);
            assert.deepEqual(
                (await listDueCloudOutbox(nowMs)).map(({ accountId, conversationId }) => ({ accountId, conversationId })),
                [key],
                'the first PUT acknowledgment must not remove the newer outbox entry',
            );
            assert.ok(updated, 'the next flush iteration uploads the newer entry');
            assert.equal(updated.url, original.url);
            assert.equal(updated.headers.get('X-Expected-Revision'), '1');
        } finally {
            for (const put of puts) put.release();
            await flush;
        }
        assert.equal((await flush).uploaded, 2);
        assert.deepEqual(await listDueCloudOutbox(nowMs), []);
    } finally {
        env.restore();
    }
});

test('CloudSyncEngine uploads and acknowledges an outbox row written before enqueue identities', async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const mock = createMockCloudVaultHttp();
        const client = createCloudVaultClient((url, init) => mock.handler(new Request(url, init)));
        const engine = createCloudSyncEngine({ client });
        await createVaultKeySetup(engine.activateVaultKeyring)(await prepareOneTimeVaultKey(), 'generated', null);
        await engine.connectCloudVault(SERVER_URL, undefined, 'create');
        const account = await getOrCreateAccount('gemini', 'gaia-outbox-legacy', 'legacy@example.com', 'Legacy Outbox');
        const conversationId = 'c_outbox_legacy';
        await ingestIndexes(account.id, [{ conversationId, fields: { title: 'Already queued', titleSource: 'provider' } }]);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('gemini_exporter_cloud_v2');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        try {
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction('outbox', 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onabort = () => reject(tx.error);
                tx.objectStore('outbox').put({
                    accountId: account.id, conversationId, queuedAt: 1, attempts: 0, nextRetryAt: 0,
                });
            });
        } finally {
            db.close();
        }
        // Enable flushing without a full history scan, which would re-enqueue the legacy row.
        await updateSettings({ cloudSyncEnabled: true });
        assert.equal((await listDueCloudOutbox())[0]?.enqueueId, null);
        assert.equal((await engine.flushOutbox()).uploaded, 1);
        assert.deepEqual(await listDueCloudOutbox(), []);
    } finally {
        env.restore();
    }
});

test('an expired session renews with unlock from the installed key without a plaintext copy', async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const mock = createMockCloudVaultHttp();
        const authModes: unknown[] = [];
        const client = createCloudVaultClient(async (url, init) => {
            const request = new Request(url, init);
            if (url.endsWith('/v2/auth/key')) authModes.push(Reflect.get(await request.clone().json(), 'mode'));
            return mock.handler(request);
        });
        const engine = createCloudSyncEngine({ client });
        await createVaultKeySetup(engine.activateVaultKeyring)(await prepareOneTimeVaultKey(), 'generated', null);
        const { session } = await engine.connectCloudVault(SERVER_URL, undefined, 'create');
        await putCloudSyncSession({ ...session, expiresAt: 1 });
        await createCloudSyncEngine({ client }).pullChanges();
        assert.deepEqual(authModes, ['create', 'unlock']);
        assert.equal(mock.inspectTenantCount(), 1);
    } finally {
        env.restore();
    }
});

test('CloudSyncEngine bounds Cloud Vault change feed bodies before parsing', async t => {
    const limitBytes = 64 * 1024;
    const chunk = new TextEncoder().encode(' '.repeat(16 * 1024));
    const feed = new TextEncoder().encode(JSON.stringify({ items: [], nextSince: 0, headSeq: 0, hasMore: false }));
    for (const scenario of [
        { name: 'no Content-Length', contentLength: undefined, status: 200, maxBytesRead: limitBytes + chunk.byteLength, code: 'CLOUD_SERVER_ERROR' },
        { name: 'understated Content-Length', contentLength: String(feed.byteLength), status: 200, maxBytesRead: limitBytes + chunk.byteLength, code: 'CLOUD_SERVER_ERROR' },
        { name: 'oversized Content-Length', contentLength: String(10 * chunk.byteLength + feed.byteLength), status: 200, maxBytesRead: 0, code: 'CLOUD_SERVER_ERROR' },
        { name: 'oversized HTTP error', contentLength: undefined, status: 429, maxBytesRead: limitBytes + chunk.byteLength, code: 'CLOUD_RATE_LIMITED' },
    ]) {
        await t.test(scenario.name, async () => {
            const env = indexStorage();
            try {
                await env.ready;
                const mock = createMockCloudVaultHttp();
                let bytesRead = 0;
                let cancelled = false;
                const client = createCloudVaultClient((url, init) => {
                    const request = new Request(url, init);
                    if (new URL(url).pathname !== '/v2/vault/changes') return mock.handler(request);
                    const body = new ReadableStream<Uint8Array>({
                        pull(controller) {
                            const next = bytesRead < 10 * chunk.byteLength ? chunk : feed;
                            bytesRead += next.byteLength;
                            controller.enqueue(next);
                            if (next === feed) controller.close();
                        },
                        cancel() { cancelled = true; },
                    }, { highWaterMark: 0 });
                    const headers: HeadersInit = scenario.contentLength === undefined
                        ? {}
                        : { 'Content-Length': scenario.contentLength };
                    return Promise.resolve(new Response(body, { status: scenario.status, headers }));
                });
                const engine = createCloudSyncEngine({ client });
                await createVaultKeySetup(engine.activateVaultKeyring)(await prepareOneTimeVaultKey(), 'generated', null);
                await engine.connectCloudVault(SERVER_URL, undefined, 'create');

                const outcome = await engine.syncNow().catch((error: unknown) => error);
                assert.ok(cancelled, `sync read ${bytesRead} bytes without cancelling the change feed`);
                assert.equal(bytesRead, scenario.maxBytesRead);
                assert.ok(outcome instanceof OperationError);
                assert.equal(outcome.code, scenario.code);
            } finally {
                env.restore();
            }
        });
    }
});

test('CloudSyncEngine pullChanges rejects authenticated invalid UTF-8 with CLOUD_DECOMPRESSION_LIMIT', async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const mock = createMockCloudVaultHttp();
        const client = createCloudVaultClient((url, init) => mock.handler(new Request(url, init)));
        const engine = createCloudSyncEngine({ client });
        const recoveryKey = await prepareOneTimeVaultKey();
        await createVaultKeySetup(engine.activateVaultKeyring)(recoveryKey, 'generated', null);
        const { session } = await engine.connectCloudVault(SERVER_URL, undefined, 'create');
        const keyring = await deriveVaultKeyring(await parseRecoveryKey(recoveryKey));
        const blindRecordId = await deriveBlindRecordId(keyring, 'gemini', 'gaia-invalid-utf8', 'c_invalid_utf8');
        const stream = new Blob([new Uint8Array([0xff, 0xfe])]).stream().pipeThrough(new CompressionStream('gzip'));
        const compressed = await new Response(stream).arrayBuffer();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const additionalData = encodeLengthPrefixedTuple([
            'GEE1-AAD', session.ownerSubject, blindRecordId, '1',
        ]);
        const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
            keyring.payloadKey,
            compressed,
        ));
        const envelope = new Uint8Array(4 + iv.byteLength + ciphertext.byteLength);
        envelope.set(new TextEncoder().encode('GEE1'));
        envelope.set(iv, 4);
        envelope.set(ciphertext, 4 + iv.byteLength);
        await mock.seedRawRecord(session.ownerSubject, blindRecordId, envelope);

        await assert.rejects(
            createCloudSyncEngine({ client }).pullChanges(),
            (error: unknown) => error instanceof OperationError
                && error.code === 'CLOUD_DECOMPRESSION_LIMIT'
                && error.cause instanceof TypeError,
        );
    } finally {
        env.restore();
    }
});

for (const action of ['restore', 'heal']) {
    test(`CloudSyncEngine same-key reset lets a paired device ${action} despite its old revision`, async () => {
        const env = indexStorage();
        try {
            await env.ready;
            const mock = createMockCloudVaultHttp();
            const client = createCloudVaultClient((url, init) => mock.handler(new Request(url, init)));
            const engineA = createCloudSyncEngine({ client });
            await createVaultKeySetup(engineA.activateVaultKeyring)(await prepareOneTimeVaultKey(), 'generated', null);
            const { session } = await engineA.connectCloudVault(SERVER_URL, undefined, 'create');
            const account = await getOrCreateAccount('gemini', 'gaia-reset');
            const key = { accountId: account.id, conversationId: 'c_reset' };
            await updateSettings({ cloudSyncEnabled: true });
            for (let revision = 1; revision <= 5; revision++) {
                await ingestIndexes(account.id, [{ conversationId: key.conversationId, fields: {
                    title: `Revision ${revision}`, titleSource: 'provider', updatedAt: 1700000000000 + revision,
                } }]);
                await enqueueCloudOutboxKeys([key]);
                assert.equal((await engineA.flushOutbox()).uploaded, 1);
            }
            const pairedRecord = await getSyncedCloudRecord(session.ownerSubject, key);
            assert.equal(pairedRecord?.remoteRevision, 5);
            assert.ok(pairedRecord);
            await engineA.resetVaultWithCurrentKey();
            await enqueueCloudOutboxKeys([key]);
            assert.equal((await engineA.flushOutbox()).uploaded, 1);
            assert.equal((await getSyncedCloudRecord(session.ownerSubject, key))?.remoteRevision, 1);

            // Switch to the paired device's pre-reset sync metadata.
            await putSyncedCloudRecord(pairedRecord);
            await putCloudSyncSession({ ...session, pulledSeq: 5 });
            const engineB = createCloudSyncEngine({ client });
            if (action === 'restore') {
                await deleteStoredConversation(key);
                assert.equal((await engineB.pullChanges()).accepted, 1);
                assert.equal((await getIndex(key))?.title, 'Revision 5');
                assert.equal((await getSyncedCloudRecord(session.ownerSubject, key))?.remoteRevision, 1);
            } else {
                await ingestIndexes(account.id, [{ conversationId: key.conversationId, fields: {
                    title: 'Paired device update', titleSource: 'provider', updatedAt: 1700000000010,
                } }]);
                await enqueueCloudOutboxKeys([key]);
                const result = await engineB.flushOutbox();
                assert.equal(result.retriedLater, 0);
                assert.equal(result.uploaded, 1);
                assert.equal((await getSyncedCloudRecord(session.ownerSubject, key))?.remoteRevision, 2);
            }
        } finally { env.restore(); }
    });
}

for (const scenario of ['feed floor', 'missing record', 'regressing cursor', 'fractional cursor', 'empty invalid cursor', 'stalled page', 'empty partial page', 'newer revision']) {
    test(`CloudSyncEngine revision safety: ${scenario}`, async () => {
        const env = indexStorage();
        try {
            await env.ready;
            const mock = createMockCloudVaultHttp();
            const client = createCloudVaultClient((url, init) => mock.handler(new Request(url, init)));
            const engine = createCloudSyncEngine({ client });
            await createVaultKeySetup(engine.activateVaultKeyring)(await prepareOneTimeVaultKey(), 'generated', null);
            const { session } = await engine.connectCloudVault(SERVER_URL, undefined, 'create');
            const account = await getOrCreateAccount('gemini', 'gaia-revision-safety');
            const key = { accountId: account.id, conversationId: 'c_revision_safety' };
            await ingestIndexes(account.id, [{ conversationId: key.conversationId, fields: { title: 'Original', titleSource: 'provider' } }]);
            await updateSettings({ cloudSyncEnabled: true });
            await enqueueCloudOutboxKeys([key]);
            assert.equal((await engine.flushOutbox()).uploaded, 1);
            if (scenario === 'newer revision') {
                await ingestIndexes(account.id, [{ conversationId: key.conversationId, fields: { title: 'Newer', titleSource: 'provider', updatedAt: Date.now() + 1000 } }]);
                await enqueueCloudOutboxKeys([key]);
                assert.equal((await engine.flushOutbox()).uploaded, 1);
            }
            const original = await getSyncedCloudRecord(session.ownerSubject, key);
            assert.ok(original);
            await putCloudSyncSession({ ...session, pulledSeq: 7 });
            const guarded = createCloudSyncEngine({ client: {
                ...client,
                async listChanges(args) {
                    const feed = await client.listChanges({ ...args, sinceSeq: 0 });
                    return {
                        ...feed,
                        items: scenario === 'empty invalid cursor' || scenario === 'empty partial page' ? []
                            : feed.items.map(meta => ({ ...meta, revision: scenario === 'feed floor' ? 2 : 1 })),
                        nextSince: scenario === 'regressing cursor' ? 6 : scenario === 'stalled page' ? 7
                            : scenario.includes('cursor') ? 1.5 : 8,
                        hasMore: scenario === 'stalled page' || scenario === 'empty partial page',
                    };
                },
                async getEncryptedRecord(args) {
                    return scenario === 'missing record' ? null : client.getEncryptedRecord(args);
                },
            } });
            await deleteStoredConversation(key);
            if (scenario === 'regressing cursor' || scenario === 'stalled page') {
                await ingestIndexes(account.id, [{ conversationId: 'c_anchor', fields: { title: 'Keep local cursor', titleSource: 'provider' } }]);
            }
            if (scenario === 'newer revision') {
                assert.equal((await guarded.pullChanges()).accepted, 1);
                assert.equal((await getSyncedCloudRecord(session.ownerSubject, key))?.remoteRevision, 2);
                assert.equal((await getCloudSyncSession())?.pulledSeq, 8);
            } else {
                await assert.rejects(guarded.pullChanges(), { code: 'CLOUD_SERVER_ERROR' });
                assert.equal(await getIndex(key), null);
                assert.deepEqual(await getSyncedCloudRecord(session.ownerSubject, key), original);
                assert.equal((await getCloudSyncSession())?.pulledSeq, 7);
            }
        } finally { env.restore(); }
    });
}

test('transport blocks canonical key text before fetch and surfaces the server retry deadline', async () => {
    let requests = 0;
    const client = createCloudVaultClient(async () => {
        requests++;
        return Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429, headers: { 'Retry-After': '60' } });
    });
    const key = await prepareOneTimeVaultKey();
    const auth = { serverUrl: SERVER_URL, keyFingerprint: '0'.repeat(32), authToken: '1'.repeat(64), mode: 'unlock' as const };
    await assert.rejects(client.authenticateKey({ ...auth, accessCode: key }), { code: 'CLOUD_ENVELOPE_INVALID' });
    await assert.rejects(client.getVaultStatus(SERVER_URL, key), { code: 'CLOUD_ENVELOPE_INVALID' });
    await assert.rejects(client.authenticateKey({ ...auth, serverUrl: `${SERVER_URL}/${key}` }), { code: 'CLOUD_ENVELOPE_INVALID' });
    assert.equal(requests, 0);
    const started = Date.now();
    await assert.rejects(client.authenticateKey(auth), (error: unknown) => error instanceof Error
        && 'code' in error && error.code === 'CLOUD_RATE_LIMITED' && 'retryAt' in error
        && typeof error.retryAt === 'number' && error.retryAt >= started + 60_000);
    assert.equal(requests, 1);
});

async function pullWithOversizedDownload(declareLength: boolean): Promise<{ error: unknown; pulledBytes: number; cancelled: boolean }> {
    const env = indexStorage();
    try {
        await env.ready;
        const mock = createMockCloudVaultHttp();
        const chunk = new Uint8Array(64 * 1024);
        const totalBytes = 64 * 1024 * 1024;
        let pulledBytes = 0;
        let cancelled = false;
        const client = createCloudVaultClient(async (url, init) => {
            const response = await mock.handler(new Request(url, init));
            if ((init?.method ?? 'GET') !== 'GET' || !new URL(url).pathname.startsWith('/v2/vault/records/')) return response;
            const body = new ReadableStream<Uint8Array>({
                pull(controller) {
                    if (pulledBytes >= totalBytes) return controller.close();
                    pulledBytes += chunk.byteLength;
                    controller.enqueue(chunk.slice());
                },
                cancel() {
                    cancelled = true;
                },
            });
            const headers = new Headers(response.headers);
            if (declareLength) headers.set('Content-Length', String(totalBytes));
            return new Response(body, { status: 200, headers });
        });
        const engine = createCloudSyncEngine({ client });
        const recoveryKey = await prepareOneTimeVaultKey();
        await createVaultKeySetup(engine.activateVaultKeyring)(recoveryKey, 'generated', null);
        const { session } = await engine.connectCloudVault(SERVER_URL, undefined, 'create');
        const keyring = await deriveVaultKeyring(await parseRecoveryKey(recoveryKey));
        const blindRecordId = await deriveBlindRecordId(keyring, 'gemini', 'gaia-oversized', 'c_oversized');
        await mock.seedRawRecord(session.ownerSubject, blindRecordId, new TextEncoder().encode('GEE1-placeholder'));

        const error = await createCloudSyncEngine({ client }).pullChanges().then(() => null, (e: unknown) => e);
        return { error, pulledBytes, cancelled };
    } finally {
        env.restore();
    }
}

test('pullChanges stops reading a record download once it passes the 2 MiB ceiling', async () => {
    const { error, pulledBytes, cancelled } = await pullWithOversizedDownload(false);
    assert.ok(error instanceof OperationError && error.code === 'CLOUD_RECORD_TOO_LARGE', String(error));
    assert.ok(pulledBytes <= CLOUD_MAX_RECORD_BYTES + 128 * 1024, `read ${pulledBytes} bytes before rejecting`);
    assert.equal(cancelled, true, 'the oversized response body is cancelled');
});

test('pullChanges rejects a record download whose Content-Length exceeds 2 MiB without reading it', async () => {
    const { error, pulledBytes, cancelled } = await pullWithOversizedDownload(true);
    assert.ok(error instanceof OperationError && error.code === 'CLOUD_RECORD_TOO_LARGE', String(error));
    assert.ok(pulledBytes <= 128 * 1024, `read ${pulledBytes} bytes before rejecting`);
    assert.equal(cancelled, true, 'the oversized response body is cancelled');
});

test('getEncryptedRecord still returns a record of exactly 2 MiB intact', async () => {
    const envelope = crypto.getRandomValues(new Uint8Array(64 * 1024));
    const full = new Uint8Array(CLOUD_MAX_RECORD_BYTES);
    for (let offset = 0; offset < full.byteLength; offset += envelope.byteLength) full.set(envelope, offset);
    const client = createCloudVaultClient(async () => new Response(full, {
        headers: { 'X-Record-Revision': '1', 'X-Record-Change-Seq': '1', 'X-Content-SHA256': '' },
    }));
    const record = await client.getEncryptedRecord({ serverUrl: SERVER_URL, sessionToken: 't', blindRecordId: '0'.repeat(64) });
    assert.deepEqual(record?.envelope, full);
});
