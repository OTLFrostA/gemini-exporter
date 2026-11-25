import { type PortableCloudConversation } from "../src/l2/cloudPayload.js";
import { CLOUD_CONVERSATION_SCHEMA } from "../src/l2/cloudPayload.js";
import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import assert from "node:assert/strict";
import { createCloudVaultClient } from "../src/application/vault/transport/vaultClient.js";
import { normalizeCloudServerUrl } from "../src/application/vault/transport/vaultClient.js";
import { createCloudSyncEngine } from "../src/application/vault/cloudSyncEngine.js";
import { getSettings, updateSettings } from "../src/application/settings/index.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { ingestIndexes } from "../src/l2/ingestion.js";
import { readConversation } from "../src/l2/readConversation.js";
import { getOrCreateAccount } from "../src/runtime/api/accountRegistry.js";
import { indexStorage } from "./helpers/indexStorage.js";
import { createMockCloudVaultHttp } from "./helpers/mockCloudVaultHttp.js";
import { createVaultKeySetup } from "../src/application/vault/vaultKeySetup.js";
import { prepareOneTimeVaultKey } from "../src/application/vault/vaultKeySetup.js";
import { enqueueCloudOutboxKeys } from "../src/l3a/cloudSyncStore.js";
import { listDueCloudOutbox } from "../src/l3a/cloudSyncStore.js";
import { putCloudSyncSession } from "../src/l3a/cloudSyncStore.js";
import { getCloudSyncSession } from "../src/l3a/cloudSyncStore.js";
import { getSyncedCloudRecord } from "../src/l3a/cloudSyncStore.js";
import { putSyncedCloudRecord } from "../src/l3a/cloudSyncStore.js";
import { getInitializedVaultKeyring } from "../src/l3a/cloudKeyringStore.js";
import { deleteStoredConversation } from "../src/l3a/storageService.js";
import { getIndex } from "../src/l3a/storageService.js";
import { deriveBlindRecordId } from "../src/shared/crypto/index.js";
import { deriveVaultKeyring } from "../src/shared/crypto/index.js";
import { encodeLengthPrefixedTuple } from "../src/shared/crypto/index.js";
import { openSessionSecrets } from "../src/shared/crypto/index.js";
import { parseRecoveryKey } from "../src/shared/crypto/index.js";
import { OperationError } from "../src/shared/errors/operationError.js";
import { CLOUD_MAX_RECORD_BYTES } from "../src/shared/types/cloudSync.js";
import { formatRecoveryKey } from "../src/shared/crypto/index.js";
import { generateMasterKeyBytes } from "../src/shared/crypto/index.js";
import { sealUtf8Record } from "../src/shared/crypto/index.js";
import { encodePortableCloudConversation } from "../src/l2/cloudPayload.js";
import { listAccounts } from "../src/l3a/storageService.js";
import { openCloudConversation } from "../src/application/vault/cloudArchiveCodec.js";
import { portableVaultSubject } from "../src/application/vault/cloudArchiveCodec.js";
import { restoreCloudConversationsToLocal } from "../src/application/vault/cloudArchiveCodec.js";
import { sealCloudConversation } from "../src/application/vault/cloudArchiveCodec.js";
import { runExport } from "../src/application/export/runExport.js";
import { __getZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { __setZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { readDeliveredFiles } from "./helpers/v2ExportHost.js";
import { v2ExportHost } from "./helpers/v2ExportHost.js";
import { type DirectoryHandle } from "../src/shared/types/directoryHandle.js";
import { createLocalFolderVaultClient } from "../src/application/vault/transport/localFolderVaultClient.js";
import { LOCAL_VAULT_OWNER_SUBJECT } from "../src/application/vault/transport/localFolderVaultClient.js";
import { getDetail } from "../src/l3a/storageService.js";
import { clearLocalScanRecords } from "../src/application/localCleanup.js";
import { MASTER_KEY_BYTES } from "../src/shared/crypto/index.js";

__suiteDescribe("cloud_sync_engine", () => {
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

test('CloudSyncEngine seals sessionToken and accessCode at rest with non-extractable payloadKey and renews on expiry', async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const accessCode = 'test-vault-access-code';
        let clockMs = Date.now();
        const backend = createMockCloudVaultHttp({ serverAccessCode: accessCode });
        const engine = createCloudSyncEngine({
            client: createCloudVaultClient((url, init) => backend.handler(new Request(url, init))),
            now: () => clockMs,
        });
        const installed = await createVaultKeySetup(engine.activateVaultKeyring)(await prepareOneTimeVaultKey(), 'generated', null);
        const before = await engine.getStatusSnapshot();
        assert.equal(before.hasRecoveryKey, true);
        assert.equal(before.keyFingerprint, installed.keyFingerprint);
        assert.equal(before.keyOrigin, 'generated');
        await engine.connectCloudVault(SERVER_URL, accessCode);
        const storedSession = await getCloudSyncSession();
        assert.ok(storedSession?.sealedCredentials instanceof Uint8Array);
        assert.equal('sessionToken' in (storedSession ?? {}), false, 'sessionToken must not be stored in plaintext');
        assert.equal('accessCode' in (storedSession ?? {}), false, 'accessCode must not be stored in plaintext');
        const sealedText = new TextDecoder('latin1').decode(storedSession!.sealedCredentials);
        assert.equal(sealedText.includes(accessCode), false, 'sealedCredentials must not contain plaintext accessCode');
        assert.equal(JSON.stringify(env.local).includes(accessCode), false);
        const keyring = await getInitializedVaultKeyring();
        assert.ok(keyring);
        const decrypted = await openSessionSecrets(keyring!, storedSession!.sealedCredentials!, {
            serverUrl: storedSession!.serverUrl,
            ownerSubject: storedSession!.ownerSubject,
        });
        assert.equal(decrypted.accessCode, accessCode);
        assert.ok(decrypted.sessionToken.length > 0);
        assert.equal(sealedText.includes(decrypted.sessionToken), false, 'sealedCredentials must not contain plaintext sessionToken');
        await assert.rejects(
            openSessionSecrets(keyring!, storedSession!.sealedCredentials!, {
                serverUrl: 'https://evil.example.test',
                ownerSubject: storedSession!.ownerSubject,
            }),
            { code: 'CLOUD_AUTH_REQUIRED' },
        );
        // Advance clock past session expiry and confirm automatic renewal still succeeds with the sealed accessCode.
        clockMs = storedSession!.expiresAt + 60_000;
        const pull = await engine.pullChanges();
        assert.equal(pull.downloaded, 0);
        const renewedSession = await getCloudSyncSession();
        assert.ok(renewedSession?.sealedCredentials instanceof Uint8Array);
        const renewedSecrets = await openSessionSecrets(keyring!, renewedSession!.sealedCredentials!, {
            serverUrl: renewedSession!.serverUrl,
            ownerSubject: renewedSession!.ownerSubject,
        });
        assert.equal(renewedSecrets.accessCode, accessCode);
        assert.notEqual(renewedSecrets.sessionToken, decrypted.sessionToken);
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

        // Manual rotation backs up the connected Vault even while automatic sync is paused.
        await engineC.setAutoSyncEnabled(false);
        const rotatedRecoveryKey = await prepareOneTimeVaultKey();
        const rotateOutcome = await createVaultKeySetup(engineC.activateVaultKeyring)(rotatedRecoveryKey, 'generated', fingerprint);
        assert.equal(rotateOutcome.resolution, 'rekeyed');
        assert.notEqual(rotateOutcome.keyFingerprint, fingerprint);
        assert.equal(backend.inspectTenantCount(), 2);
        assert.equal(rotateOutcome.cloudBackup?.saved, 2, 'both local conversations backed up and verified before switching');
        assert.equal((await engineC.getStatusSnapshot()).enabled, false, 'manual rotation leaves automatic sync paused');
        await updateSettings({ cloudSyncEnabled: true });
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

test('Cloud reset pauses a paired device with a stale upload queue and preserves its local history', async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const mock = createMockCloudVaultHttp({ protectedPurge: true });
        const client = createCloudVaultClient((url, init) => mock.handler(new Request(url, init)));
        const engineA = createCloudSyncEngine({ client });
        await createVaultKeySetup(engineA.activateVaultKeyring)(await prepareOneTimeVaultKey(), 'generated', null);
        const { session } = await engineA.connectCloudVault(SERVER_URL, undefined, 'create');
        const account = await getOrCreateAccount('gemini', 'gaia-reset');
        const key = { accountId: account.id, conversationId: 'c_reset' };
        await updateSettings({ cloudSyncEnabled: true });
        await ingestIndexes(account.id, [{ conversationId: key.conversationId, fields: {
            title: 'Offline copy', titleSource: 'provider', updatedAt: 1700000000000,
        } }]);
        await enqueueCloudOutboxKeys([key]);
        assert.equal((await engineA.flushOutbox()).uploaded, 1);
        const pairedRecord = await getSyncedCloudRecord(session.ownerSubject, key);
        assert.ok(pairedRecord);

        await engineA.resetVaultWithCurrentKey();
        assert.equal((await getSettings()).cloudSyncEnabled, false);
        assert.equal((await getCloudSyncSession())?.generation, 1);

        // Simulate the offline device reconnecting with its old cursor, record state and queued upload.
        await putSyncedCloudRecord(pairedRecord);
        await putCloudSyncSession({ ...session, generation: 0, pulledSeq: 1 });
        await enqueueCloudOutboxKeys([key]);
        await updateSettings({ cloudSyncEnabled: true });
        const engineB = createCloudSyncEngine({ client });
        await assert.rejects(engineB.flushOutbox(), { code: 'CLOUD_VAULT_RESET' });
        assert.equal((await getSettings()).cloudSyncEnabled, false);
        assert.equal((await getCloudSyncSession())?.pulledSeq, 0);
        assert.equal((await getCloudSyncSession())?.generation, 1);
        assert.equal(await getSyncedCloudRecord(session.ownerSubject, key), null);
        assert.equal((await listDueCloudOutbox(Date.now(), 10)).length, 0);
        await enqueueCloudOutboxKeys([key], Date.now(), { ...session, generation: 0 });
        assert.equal((await listDueCloudOutbox(Date.now(), 10)).length, 0);
        assert.equal((await getIndex(key))?.title, 'Offline copy');
        assert.equal(mock.inspectRawBlobs().size, 0);
    } finally { env.restore(); }
});

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

test('vaultClient enforces redirect: error on all endpoints and rejects malformed blindRecordId before fetch', async () => {
    const redirects: Array<RequestRedirect | undefined> = [];
    let fetchCalls = 0;
    const validId = 'a'.repeat(64);
    const client = createCloudVaultClient(async (url, init) => {
        fetchCalls++;
        redirects.push(init?.redirect);
        const path = new URL(url).pathname;
        if (path === '/v2/vault/status') {
            return Response.json({
                ownerSubject: 'vault:' + '0'.repeat(32),
                recordCount: 0,
                usedBytes: 0,
                quotaBytes: 100,
                headSeq: 0,
                keyFingerprint: '0'.repeat(32),
            });
        }
        if (path === '/v2/vault/changes') {
            return Response.json({ items: [], nextSince: 0, headSeq: 0, hasMore: false });
        }
        if (path === `/v2/vault/records/${validId}` && init?.method === 'PUT') {
            return Response.json({
                blindRecordId: validId,
                revision: 1,
                changeSeq: 1,
                byteLength: 32,
                sha256: 'b'.repeat(64),
                updatedAt: 1,
            });
        }
        if (path === `/v2/vault/records/${validId}`) {
            return new Response(null, { status: 404 });
        }
        if (path === '/v2/vault/purge-authorization') return Response.json({ purgeToken: 'gep2.mock.grant' });
        if (path === '/v2/vault') return Response.json({ ok: true, generation: 1 });
        return new Response(null, { status: 204 });
    });

    for (const badId of ['../vault', 'short', 'A'.repeat(64), `${validId}?x=1`]) {
        await assert.rejects(
            client.getEncryptedRecord({ serverUrl: SERVER_URL, sessionToken: 't', blindRecordId: badId }),
            { code: 'CLOUD_ENVELOPE_INVALID' },
        );
        await assert.rejects(
            client.putEncryptedRecord({
                serverUrl: SERVER_URL,
                sessionToken: 't',
                blindRecordId: badId,
                expectedRevision: 0,
                envelope: new Uint8Array(32),
                sha256: 'b'.repeat(64),
                keyFingerprint: '0'.repeat(32),
            }),
            { code: 'CLOUD_ENVELOPE_INVALID' },
        );
    }
    assert.equal(fetchCalls, 0, 'malformed blindRecordId must be rejected before calling fetch');

    await client.getVaultStatus(SERVER_URL, 't');
    await client.putEncryptedRecord({
        serverUrl: SERVER_URL,
        sessionToken: 't',
        blindRecordId: validId,
        expectedRevision: 0,
        envelope: new Uint8Array(32),
        sha256: 'b'.repeat(64),
        keyFingerprint: '0'.repeat(32),
    });
    await client.getEncryptedRecord({ serverUrl: SERVER_URL, sessionToken: 't', blindRecordId: validId });
    await client.listChanges({ serverUrl: SERVER_URL, sessionToken: 't', sinceSeq: 0 });
    assert.equal(await client.purgeVault(SERVER_URL, 't', undefined, { generation: 0, proof: 'a'.repeat(64) }), 1);

    assert.equal(redirects.length, 6);
    assert.ok(redirects.every(mode => mode === 'error'), `expected redirect: error on all endpoints, got ${JSON.stringify(redirects)}`);
});
});

__suiteDescribe("cloud_e2ee_integration", () => {
test('E2EE cross-device lifecycle: Device A seals zero-knowledge ciphertext -> Device B restores via GEK1 recovery key onto its own local Account UUID and exports lossless Markdown/HTML', async t => {
    const secretPhrase = 'Ultra-Secret-Proprietary-Derivation-99481';

    // --- Device A: generate Vault Master Key, ingest multi-platform conversations, and seal ---
    let recoveryCode = '';
    const blindServerStore = new Map<string, { revision: number; ciphertext: Uint8Array }>();
    let deviceAGeminiUuid = '';

    const deviceA = indexStorage();
    try {
        await deviceA.ready;
        const geminiAccA = await getOrCreateAccount('gemini', 'gaia-778899', 'researcher@example.com', 'Dr. Researcher');
        const chatgptAccA = await getOrCreateAccount('chatgpt', JSON.stringify(['user-xyz', 'ws-team-42']), 'researcher@example.com', 'Team Workspace');
        deviceAGeminiUuid = geminiAccA.id;

        await ingestDetail(geminiAccA.id, 'c_quantum_secret', {
            savedAt: 1710000100000,
            quality: { status: 'complete', sourceTurn: 'finished' },
            assets: [{
                id: 'canvas-1',
                kind: 'file',
                name: 'proof.md',
                mediaType: 'text/markdown',
                document: { id: 'doc-proof', contentMarkdown: `# Canvas Proof\n${secretPhrase}` },
            }],
            messages: [
                { role: 'user', timestamp: 1710000000000, content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Prove the theorem.' }] }] },
                {
                    role: 'assistant',
                    model: 'gemini-2.5-pro',
                    timestamp: 1710000100000,
                    attachmentIds: ['canvas-1'],
                    content: [
                        { type: 'paragraph', children: [{ type: 'text', text: `Key result: ${secretPhrase}` }, { type: 'inlineMath', source: '\\nabla \\cdot \\mathbf{B} = 0' }] },
                        { type: 'file', assetId: 'canvas-1', label: 'proof.md' },
                    ],
                },
            ],
        }, { title: 'Confidential Theorem', titleSource: 'provider', updatedAt: 1710000100000 });

        await ingestDetail(chatgptAccA.id, '68000000-0000-4000-8000-000000000099', {
            savedAt: 1710000200000,
            quality: { status: 'complete', sourceTurn: 'finished' },
            assets: [],
            messages: [
                { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Workspace strategy?' }] }] },
                { role: 'assistant', content: [{ type: 'code', language: 'ts', code: 'export const plan = 42;' }] },
            ],
        }, { title: 'Workspace Architecture', titleSource: 'provider', updatedAt: 1710000200000 });

        const masterKey = generateMasterKeyBytes();
        recoveryCode = await formatRecoveryKey(masterKey);
        const keyringA = await deriveVaultKeyring(masterKey);

        for (const [acc, cid] of [
            [geminiAccA, 'c_quantum_secret'],
            [chatgptAccA, '68000000-0000-4000-8000-000000000099'],
        ] as const) {
            const snap = await readConversation({ accountId: acc.id, conversationId: cid });
            assert.ok(snap);
            const sealed = await sealCloudConversation({
                keyring: keyringA,
                revision: 1,
                account: acc,
                conversation: snap,
            });
            // Zero-knowledge ciphertext audit: raw wire bytes must leak zero metadata or plaintext
            const rawLatin1 = new TextDecoder('latin1').decode(sealed.envelope);
            for (const sensitive of [secretPhrase, 'Confidential Theorem', 'researcher@example.com', 'gaia-778899', 'c_quantum_secret', 'gemini', 'chatgpt']) {
                assert.equal(rawLatin1.includes(sensitive), false, `ciphertext must not leak "${sensitive}"`);
                assert.equal(sealed.blindRecordId.includes(sensitive), false);
            }
            blindServerStore.set(sealed.blindRecordId, { revision: 1, ciphertext: sealed.envelope });
        }

        // Defense-in-depth intra-vault slot-poisoning check:
        // Even if a compromised client encrypts Conversation 1's JSON with Conversation 2's blindRecordId in AAD,
        // openCloudConversation must reject the inner/outer identity mismatch!
        const snap1 = await readConversation({ accountId: geminiAccA.id, conversationId: 'c_quantum_secret' });
        assert.ok(snap1);
        const poisonedJson = encodePortableCloudConversation(geminiAccA, snap1);
        const wrongSlotId = await deriveBlindRecordId(keyringA, 'gemini', 'gaia-778899', 'c_different_target');
        const poisonedEnvelope = await sealUtf8Record(keyringA, poisonedJson, {
            ownerSubject: portableVaultSubject(keyringA),
            blindRecordId: wrongSlotId,
            revision: 1,
        });
        await assert.rejects(
            openCloudConversation({
                keyring: keyringA,
                blindRecordId: wrongSlotId,
                revision: 1,
                envelope: poisonedEnvelope,
            }),
            (err: unknown) => err instanceof OperationError && err.code === 'CLOUD_DECRYPT_AUTH_FAILED',
        );
    } finally {
        deviceA.restore();
    }

    // --- Device B: independent fresh database where the same Google account already has a DIFFERENT local UUID ---
    const hostB = v2ExportHost(t);
    const preExistingGeminiB = await getOrCreateAccount('gemini', 'gaia-778899', 'researcher@example.com', 'Dr. Researcher');
    assert.notEqual(preExistingGeminiB.id, deviceAGeminiUuid, 'Device B owns an independent local Account UUID');

    // Seed a newer user-renamed title on Device B to verify L2 conflict merge (user > provider)
    await ingestDetail(preExistingGeminiB.id, 'c_quantum_secret', {
        savedAt: 1710000050000, // older body than cloud (1710000100000)
        quality: { status: 'partial' },
        assets: [],
        messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Draft' }] }] }],
    }, { title: 'My Pinned Custom Title', titleSource: 'user', updatedAt: 1710000050000 });

    const keyringB = await deriveVaultKeyring(await parseRecoveryKey(recoveryCode));
    const openedItems = [];
    for (const [blindRecordId, row] of blindServerStore) {
        openedItems.push(await openCloudConversation({
            keyring: keyringB,
            blindRecordId,
            revision: row.revision,
            envelope: row.ciphertext,
        }));
    }

    const summary = await restoreCloudConversationsToLocal(openedItems);
    assert.equal(summary.accepted, 2);
    assert.equal(summary.changed, 2);
    assert.equal(summary.rejected, 0);

    // Verify no duplicate Gemini account was created on Device B
    const geminiAccountsOnB = (await listAccounts()).filter(a => a.providerId === 'gemini' && a.providerAccountId === 'gaia-778899');
    assert.equal(geminiAccountsOnB.length, 1);
    assert.equal(geminiAccountsOnB[0]?.id, preExistingGeminiB.id);

    // Verify L2 merged higher-authority user title with newer complete cloud body
    const restoredGemini = await readConversation({ accountId: preExistingGeminiB.id, conversationId: 'c_quantum_secret' });
    assert.ok(restoredGemini);
    assert.equal(restoredGemini.index.title, 'My Pinned Custom Title', 'user-authority title on Device B is preserved');
    assert.equal(restoredGemini.detail.quality.status, 'complete', 'complete cloud body upgrades older partial local body');

    // Verify restored conversation exports cleanly to Markdown (+ Canvas file!) and HTML on Device B
    const savedZip = __getZipConstructor();
    __setZipConstructor(require('../lib/jszip.min.js'));
    t.after(() => __setZipConstructor(savedZip));

    const mdExport = await runExport({
        keys: [{ accountId: preExistingGeminiB.id, conversationId: 'c_quantum_secret' }],
        format: 'markdown',
        delivery: 'browserDownload',
        includeAssets: true,
        skipUnchanged: false,
    });
    assert.equal(mdExport.exported, 1);
    const delivered = await readDeliveredFiles(hostB);
    assert.equal(delivered.length, 2, 'restored conversation delivers both main Markdown and inline Canvas file');
    const combinedText = (await Promise.all(delivered.map(f => f.async('string')))).join('\n');
    assert.ok(combinedText.includes(secretPhrase));
    assert.ok(combinedText.includes('\\nabla \\cdot \\mathbf{B} = 0'));
    assert.ok(combinedText.includes('# Canvas Proof'));

    const htmlExport = await runExport({
        keys: [{ accountId: preExistingGeminiB.id, conversationId: 'c_quantum_secret' }],
        format: 'html',
        delivery: 'browserDownload',
        includeAssets: false,
        skipUnchanged: false,
    });
    assert.equal(htmlExport.exported, 1);
    const htmlBlob = hostB.blobs.at(-1);
    assert.ok(htmlBlob);
    const htmlText = await htmlBlob.text();
    assert.ok(htmlText.includes('My Pinned Custom Title'));
    assert.ok(htmlText.includes(secretPhrase));
});
});

__suiteDescribe("local_encrypted_vault", () => {
interface MemoryDirNode {
    handle: DirectoryHandle;
    files: Map<string, Uint8Array<ArrayBuffer>>;
    subdirs: Map<string, MemoryDirNode>;
}

const memoryDirectoryHandles = new WeakSet<object>();
const clone = globalThis.structuredClone;

test.before(() => {
    // fake-indexeddb uses Node's structuredClone, which cannot clone browser file-system capabilities.
    globalThis.structuredClone = (value, options) => (
        typeof value === 'object' && value !== null && memoryDirectoryHandles.has(value)
            ? value : clone(value, options)
    );
});
test.after(() => { globalThis.structuredClone = clone; });

function createMemoryDirectoryHandle(name = 'MockEncryptedFolder', initialPerm: PermissionState = 'granted') {
    let permission: PermissionState = initialPerm;
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    const subdirs = new Map<string, MemoryDirNode>();
    let failManifestClose = false;
    let failRecordClose = false;
    let failRemove = false;

    function makeFileHandle(fileName: string, store: Map<string, Uint8Array<ArrayBuffer>>): FileSystemFileHandle {
        return {
            kind: 'file',
            name: fileName,
            isSameEntry: async () => false,
            async getFile() {
                const bytes = store.get(fileName);
                if (!bytes) {
                    const err = new Error(`File not found: ${fileName}`);
                    err.name = 'NotFoundError';
                    throw err;
                }
                return new File([bytes], fileName);
            },
            async createWritable() {
                let staged = new Uint8Array(0);
                return {
                    async write(data: BufferSource | Blob | string) {
                        if (data instanceof Uint8Array) {
                            const copy = new Uint8Array(data.byteLength);
                            copy.set(data);
                            staged = copy;
                        } else if (typeof data === 'string') {
                            staged = new Uint8Array(new TextEncoder().encode(data));
                        }
                    },
                    async close() {
                        if (failManifestClose && fileName === 'vault-manifest.json') throw new Error('Injected manifest close failure');
                        if (failRecordClose && fileName.endsWith('.gee1')) throw new Error('Injected record close failure');
                        store.set(fileName, staged);
                    },
                    async abort() {},
                    async seek() {},
                    async truncate() {},
                } as unknown as FileSystemWritableFileStream;
            },
        } as FileSystemFileHandle;
    }

    function makeDir(dirName: string, fileMap: Map<string, Uint8Array<ArrayBuffer>>, dirMap: Map<string, MemoryDirNode>): MemoryDirNode {
        const proto = {
            isSameEntry: async (other: FileSystemHandle) => other === handle,
            queryPermission: async () => permission,
            requestPermission: async () => permission,
            async getFileHandle(fileName: string, options?: FileSystemGetFileOptions) {
                if (!options?.create && !fileMap.has(fileName)) {
                    const err = new Error(`File not found: ${fileName}`);
                    err.name = 'NotFoundError';
                    throw err;
                }
                if (options?.create && !fileMap.has(fileName)) {
                    fileMap.set(fileName, new Uint8Array(0));
                }
                return makeFileHandle(fileName, fileMap);
            },
            async getDirectoryHandle(childName: string, options?: FileSystemGetDirectoryOptions) {
                let child = dirMap.get(childName);
                if (!child) {
                    if (!options?.create) {
                        const err = new Error(`Directory not found: ${childName}`);
                        err.name = 'NotFoundError';
                        throw err;
                    }
                    child = makeDir(childName, new Map(), new Map());
                    dirMap.set(childName, child);
                }
                return child.handle;
            },
            async removeEntry(entryName: string) {
                if (failRemove) throw new Error('Injected cleanup failure');
                fileMap.delete(entryName);
                dirMap.delete(entryName);
            },
        };
        const handle = Object.assign(Object.create(proto) as Record<string, unknown>, {
            kind: 'directory' as const,
            name: dirName,
        }) as unknown as DirectoryHandle;
        memoryDirectoryHandles.add(handle);
        return { handle, files: fileMap, subdirs: dirMap };
    }

    const root = makeDir(name, files, subdirs);
    return {
        handle: root.handle,
        files,
        subdirs,
        setManifestCloseFailure(fail: boolean) { failManifestClose = fail; },
        setRecordCloseFailure(fail: boolean) { failRecordClose = fail; },
        setRemoveFailure(fail: boolean) { failRemove = fail; },
        setPermission(next: PermissionState) { permission = next; },
    };
}

test('failed manifest update preserves the previous client backup', async () => {
    const folder = createMemoryDirectoryHandle();
    const client = createLocalFolderVaultClient(async () => folder.handle);
    const args = { serverUrl: '', sessionToken: '', blindRecordId: 'a'.repeat(64), keyFingerprint: 'b'.repeat(32) };
    const put = async (revision: number, value: number) => {
        const envelope = new Uint8Array(32).fill(value);
        envelope.set([0x47, 0x45, 0x45, 0x31]);
        const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', envelope)).toString('hex');
        return client.putEncryptedRecord({ ...args, expectedRevision: revision, envelope, sha256 });
    };
    await put(0, 1);
    const before = await client.getEncryptedRecord(args);
    folder.setRecordCloseFailure(true);
    await assert.rejects(put(1, 2), { code: 'FILE_WRITE_FAILED' });
    folder.setRecordCloseFailure(false);
    assert.deepEqual(await client.getEncryptedRecord(args), before);
    folder.setManifestCloseFailure(true);
    await assert.rejects(put(1, 2), { code: 'FILE_WRITE_FAILED' });
    folder.setManifestCloseFailure(false);
    assert.deepEqual(await client.getEncryptedRecord(args), before);
    assert.equal(folder.subdirs.get('records')!.files.size, 2);
    assert.equal((await put(1, 3)).status, 'committed');
    assert.equal(folder.subdirs.get('records')!.files.size, 1);
    const committed = await client.getEncryptedRecord(args);
    folder.setRemoveFailure(true);
    folder.setManifestCloseFailure(true);
    await assert.rejects(put(2, 4), { code: 'FILE_WRITE_FAILED' });
    folder.setManifestCloseFailure(false);
    assert.deepEqual(await client.getEncryptedRecord(args), committed);
    assert.equal((await put(2, 5)).status, 'committed', 'cleanup failure must not reject a committed update');
    assert.equal((await client.getEncryptedRecord(args))?.revision, 3);
});

test('failed manifest update recovery keeps the mixed-version manifest and record layout', async () => {
    const folder = createMemoryDirectoryHandle();
    const client = createLocalFolderVaultClient(async () => folder.handle);
    const args = { serverUrl: '', sessionToken: '', blindRecordId: 'c'.repeat(64), keyFingerprint: 'd'.repeat(32) };
    const put = async (revision: number, value: number) => {
        const envelope = new Uint8Array(32).fill(value);
        envelope.set([0x47, 0x45, 0x45, 0x31]);
        const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', envelope)).toString('hex');
        return client.putEncryptedRecord({ ...args, expectedRevision: revision, envelope, sha256 });
    };
    const assertLegacyLayout = async (revision: number) => {
        const manifest = JSON.parse(new TextDecoder().decode(folder.files.get('vault-manifest.json'))) as {
            records: Record<string, Record<string, unknown>>;
        };
        assert.deepEqual(Object.keys(manifest).sort(), ['schema', 'version', 'ownerSubject', 'keyFingerprint', 'nextSeq', 'usedBytes', 'records'].sort());
        assert.deepEqual(Object.keys(manifest.records[args.blindRecordId]).sort(), ['blindRecordId', 'revision', 'changeSeq', 'byteLength', 'sha256', 'updatedAt'].sort());
        const record = await client.getEncryptedRecord(args);
        assert.equal(record?.revision, revision);
        assert.deepEqual(folder.subdirs.get('records')!.files.get(`${args.blindRecordId}.gee1`), record?.envelope);
        assert.deepEqual([...folder.subdirs.get('records')!.files.keys()], [`${args.blindRecordId}.gee1`]);
    };
    await put(0, 1);
    const original = await client.getEncryptedRecord(args);
    folder.setManifestCloseFailure(true);
    await assert.rejects(put(1, 2), { code: 'FILE_WRITE_FAILED' });
    await assert.rejects(put(1, 3), { code: 'FILE_WRITE_FAILED' });
    assert.deepEqual(await client.getEncryptedRecord(args), original, 'a retry must not overwrite the valid backup with uncommitted bytes');
    const files = folder.subdirs.get('records')!.files;
    const backupName = `${args.blindRecordId}.prev.gee1`;
    const preserved = files.get(backupName)!;
    files.set(backupName, preserved.slice(0, -1));
    await assert.rejects(client.getEncryptedRecord(args), { code: 'CLOUD_DECRYPT_AUTH_FAILED' });
    await assert.rejects(put(1, 4), { code: 'FILE_WRITE_FAILED' }, 'with no valid committed copy left, an update still overwrites instead of blocking repair');
    files.set(backupName, preserved);
    folder.setManifestCloseFailure(false);
    await put(1, 4);
    await assertLegacyLayout(2);
    await put(2, 5);
    await assertLegacyLayout(3);
});

test('failed manifest update preserves the previous backup through real sync and index-only updates', async () => {
    const folder = createMemoryDirectoryHandle();
    const recoveryKey = await prepareOneTimeVaultKey();
    const source = indexStorage();
    try {
        await source.ready;
        const engine = createCloudSyncEngine();
        await createVaultKeySetup(engine.activateVaultKeyring)(recoveryKey, 'imported', null);
        await engine.connectLocalFolderVault(folder.handle);
        const account = await getOrCreateAccount('gemini', 'gaia-failed-update');
        const save = (text: string, updatedAt: number) => ingestDetail(account.id, 'backup', {
            savedAt: updatedAt, quality: { status: 'complete' }, assets: [],
            messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text }] }] }],
        }, { title: text, titleSource: 'provider', updatedAt });
        await save('Revision one', 10_000);
        await engine.setIncludeDetail(true);
        await engine.setAutoSyncEnabled(true);
        await engine.waitForIdle();
        await save('Revision two', 20_000);
        folder.setManifestCloseFailure(true);
        assert.equal((await engine.syncNow()).push.retriedLater, 1);
        folder.setManifestCloseFailure(false);
    } finally {
        source.restore();
    }
    const target = indexStorage();
    try {
        await target.ready;
        const engine = createCloudSyncEngine();
        await createVaultKeySetup(engine.activateVaultKeyring)(recoveryKey, 'imported', null);
        await engine.connectLocalFolderVault(folder.handle);
        assert.equal((await engine.pullChanges()).accepted, 1);
        const account = await getOrCreateAccount('gemini', 'gaia-failed-update');
        const key = { accountId: account.id, conversationId: 'backup' };
        assert.match(JSON.stringify(await readConversation(key)), /Revision one/);
        assert.doesNotMatch(JSON.stringify(await readConversation(key)), /Revision two/);
        await ingestIndexes(account.id, [{ conversationId: 'backup', fields: { title: 'Index rename', titleSource: 'provider', updatedAt: 30_000 } }]);
        await engine.setAutoSyncEnabled(true);
        await engine.waitForIdle();
        const client = createLocalFolderVaultClient(async () => folder.handle);
        const args = { serverUrl: '', sessionToken: '' };
        const [meta] = (await client.listChanges({ ...args, sinceSeq: 0 })).items;
        assert.equal(meta.revision, 2);
        const backup = await client.getEncryptedRecord({ ...args, blindRecordId: meta.blindRecordId });
        assert.ok(backup);
        const keyring = await deriveVaultKeyring(await parseRecoveryKey(recoveryKey));
        const opened = await openCloudConversation({ keyring, blindRecordId: meta.blindRecordId, ...backup });
        assert.equal(opened.index.title, 'Index rename');
        assert.match(JSON.stringify(opened.detail), /Revision one/);
    } finally {
        target.restore();
    }
});

test('LocalFolderVaultClient enforces GEE1 ciphertext header, detects disk bit-rot via SHA-256, and queues cleanly when directory permission reverts to prompt', async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const folder = createMemoryDirectoryHandle('MyLocalVault');
        const localClient = createLocalFolderVaultClient(async () => folder.handle);

        // Plaintext bytes without GEE1 header are rejected before touching disk
        await assert.rejects(
            localClient.putEncryptedRecord({
                serverUrl: 'local-vault://directory',
                sessionToken: 'local',
                blindRecordId: 'a'.repeat(64),
                expectedRevision: 0,
                envelope: new Uint8Array(new TextEncoder().encode('{"plaintext":true,"padding":"12345678901234567890"}')),
                sha256: '0'.repeat(64),
                keyFingerprint: '0'.repeat(32),
            }),
            (err: unknown) => err instanceof OperationError && err.code === 'CLOUD_ENVELOPE_INVALID',
        );
        assert.equal(folder.files.size, 0);

        // Connect CloudSyncEngine in default local-folder mode!
        const engine = createCloudSyncEngine();
        const unsubscribe = engine.installAutoEnqueueListener();
        try {
            const acc = await getOrCreateAccount('gemini', 'gaia-local-test', 'local@example.com');
            await assert.rejects(engine.connectLocalFolderVault(folder.handle), { code: 'CLOUD_KEY_NOT_INITIALIZED' });
            const recoveryKey = await prepareOneTimeVaultKey();
            await createVaultKeySetup(engine.activateVaultKeyring)(recoveryKey, 'generated', null);
            const connected = await engine.connectLocalFolderVault(folder.handle);
            assert.equal(connected.session.backend, 'local-folder');
            assert.equal(connected.session.ownerSubject, LOCAL_VAULT_OWNER_SUBJECT);
            assert.equal((await engine.getStatusSnapshot()).includeDetail, false, 'Index-only privacy mode is default');
            await engine.setAutoSyncEnabled(true);

            // 1. Mobile/other-platform chat scanned ONLY as an Index row (zero local Detail!) -> automatically backed up!
            await ingestIndexes(acc.id, [{
                conversationId: 'c_mobile_only_index',
                fields: { title: 'Mobile Chat From Phone App', titleSource: 'provider', updatedAt: 4000 },
            }]);
            await engine.waitForIdle();
            const recordsSubdir = folder.subdirs.get('records');
            assert.ok(recordsSubdir);
            assert.equal(recordsSubdir.files.size, 1, 'Index-only conversation from mobile scan was immediately saved as .gee1!');

            // 2. Simulate browser restart revoking directory permission -> conversation WITH sensitive body stays queued,
            //    and once flushed in default Index-only mode, its decrypted payload contains ZERO message bodies!
            folder.setPermission('prompt');
            const ultraPrivateBody = 'NEVER_LEAVE_THIS_DEVICE_BODY_99182';
            await ingestDetail(acc.id, 'c_local_1', {
                savedAt: 5000,
                quality: { status: 'complete' },
                assets: [],
                messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: ultraPrivateBody }] }] }],
            }, { title: 'Locked Folder Test', titleSource: 'provider', updatedAt: 5000 });
            await engine.waitForIdle();
            assert.equal((await engine.getStatusSnapshot()).pendingOutbox, 1);

            // User clicks Re-authorize -> flushOutbox writes .gee1 file and vault-manifest.json!
            folder.setPermission('granted');
            const flushed = await engine.flushOutbox();
            assert.equal(flushed.uploaded, 1);
            assert.equal((await engine.getStatusSnapshot()).pendingOutbox, 0);
            assert.equal(recordsSubdir.files.size, 2);

            // Verify even with the real Master Key, decrypted .gee1 files hold ONLY Index metadata (detail === undefined)!
            const keyring = await deriveVaultKeyring(await parseRecoveryKey(recoveryKey));
            for (const [fileName, bytes] of recordsSubdir.files) {
                const blindId = fileName.replace(/\.gee1$/, '');
                const opened = await openCloudConversation({
                    keyring,
                    blindRecordId: blindId,
                    revision: 1,
                    envelope: bytes,
                });
                assert.equal(opened.detail, undefined, 'default Index-only mode never serializes message bodies');
                assert.equal(JSON.stringify(opened).includes(ultraPrivateBody), false);
            }

            // 3. Wipe local DB and verify pullChanges restores BOTH Index entries cleanly from the local encrypted folder
            await clearLocalScanRecords(acc.id);
            assert.equal(await getIndex({ accountId: acc.id, conversationId: 'c_mobile_only_index' }), null);
            assert.equal(await readConversation({ accountId: acc.id, conversationId: 'c_local_1' }), null);

            const pulled = await engine.pullChanges();
            assert.equal(pulled.accepted, 2);
            const restoredMobileIdx = await getIndex({ accountId: acc.id, conversationId: 'c_mobile_only_index' });
            const restoredLocalIdx = await getIndex({ accountId: acc.id, conversationId: 'c_local_1' });
            assert.equal(restoredMobileIdx?.title, 'Mobile Chat From Phone App');
            assert.equal(restoredLocalIdx?.title, 'Locked Folder Test');
            assert.equal(await getDetail({ accountId: acc.id, conversationId: 'c_local_1' }), null, 'no body stored or restored in Index-only mode');

            // 4. Zero-reencryption Local-to-Cloud portability proof:
            //    Copy raw .gee1 files verbatim from local folder into Cloud Vault Server and pull from Cloud!
            const mockCloud = createMockCloudVaultHttp();
            const cloudEngine = createCloudSyncEngine({
                client: createCloudVaultClient((url, init) => mockCloud.handler(new Request(url, init))),
            });
            const cloudConn = await cloudEngine.connectCloudVault('https://cloud.port.test', undefined, 'create');
            assert.equal(cloudConn.keyFingerprint, connected.keyFingerprint, 'one installed key works with both backends');
            for (const [fileName, bytes] of recordsSubdir.files) {
                const blindId = fileName.replace(/\.gee1$/, '');
                await mockCloud.seedRawRecord(`vault:${keyring.keyFingerprint}`, blindId, bytes);
            }

            await clearLocalScanRecords(acc.id);
            const cloudPull = await cloudEngine.pullChanges();
            assert.equal(cloudPull.accepted, 2, 'Untouched local .gee1 files decrypted seamlessly from Cloud Vault!');
            assert.equal((await getIndex({ accountId: acc.id, conversationId: 'c_mobile_only_index' }))?.title, 'Mobile Chat From Phone App');

            // 5. Tamper 1 byte in the on-disk .gee1 file -> LocalFolderVaultClient detects SHA-256 corruption immediately!
            await engine.connectLocalFolderVault(folder.handle);
            const [gee1Name, gee1Bytes] = [...recordsSubdir.files.entries()][0]!;
            const corrupted = new Uint8Array(gee1Bytes);
            corrupted[10] ^= 0xff;
            recordsSubdir.files.set(gee1Name, corrupted);
            await clearLocalScanRecords(acc.id);
            await assert.rejects(
                engine.pullChanges(),
                (err: unknown) => err instanceof OperationError && err.code === 'CLOUD_DECRYPT_AUTH_FAILED',
            );
        } finally {
            unsubscribe();
            await engine.waitForIdle();
        }
    } finally {
        env.restore();
    }
});

test('switching to a different same-named vault restores and saves against the new directory', async () => {
    const oldFolder = createMemoryDirectoryHandle('Vault');
    const newFolder = createMemoryDirectoryHandle('Vault');
    const recoveryKey = await prepareOneTimeVaultKey();
    const addIndex = (accountId: string, conversationId: string, title: string, updatedAt: number) =>
        ingestIndexes(accountId, [{ conversationId, fields: { title, titleSource: 'provider', updatedAt } }]);

    const source = indexStorage();
    try {
        const writer = createCloudSyncEngine();
        await createVaultKeySetup(writer.activateVaultKeyring)(recoveryKey, 'imported', null);
        await writer.connectLocalFolderVault(newFolder.handle);
        const account = await getOrCreateAccount('gemini', 'gaia-vault-switch');
        await ingestDetail(account.id, 'shared', {
            savedAt: 20_000,
            quality: { status: 'complete' },
            assets: [],
            messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Backed-up body' }] }] }],
        }, { title: 'Newer title', titleSource: 'provider', updatedAt: 20_000 });
        await addIndex(account.id, 'new-folder-only', 'Restore from new folder', 20_000);
        await writer.setIncludeDetail(true);
        await writer.setAutoSyncEnabled(true);
        await writer.waitForIdle();
        assert.equal(newFolder.subdirs.get('records')?.files.size, 2);
    } finally {
        source.restore();
    }

    const target = indexStorage();
    try {
        const syncer = createCloudSyncEngine();
        await createVaultKeySetup(syncer.activateVaultKeyring)(recoveryKey, 'imported', null);
        await syncer.connectLocalFolderVault(oldFolder.handle);
        const account = await getOrCreateAccount('gemini', 'gaia-vault-switch');
        await addIndex(account.id, 'shared', 'Older title', 10_000);
        await addIndex(account.id, 'old-folder-only', 'Save into new folder', 10_000);
        await syncer.setAutoSyncEnabled(true);
        await syncer.waitForIdle();
        const syncedBefore = await syncer.pullChanges();
        assert.equal(syncedBefore.pulledSeq, 2);
        const connector = createCloudSyncEngine();
        assert.equal((await connector.connectLocalFolderVault(oldFolder.handle)).session.pulledSeq, 2);
        assert.equal((await connector.connectLocalFolderVault(newFolder.handle)).session.pulledSeq, 0);

        const result = await syncer.syncNow();
        assert.equal(result.pull.downloaded, 2, 'old revisions must not suppress records from the new folder');
        assert.equal((await getIndex({ accountId: account.id, conversationId: 'new-folder-only' }))?.title, 'Restore from new folder');
        assert.equal((await getIndex({ accountId: account.id, conversationId: 'shared' }))?.title, 'Newer title');
        assert.equal(result.push.uploaded, 1, 'the old folder acknowledgement must not suppress saving to the new folder');
        assert.equal(newFolder.subdirs.get('records')?.files.size, 3);
        assert.equal(oldFolder.subdirs.get('records')?.files.size, 2);

        await ingestDetail(account.id, 'shared', {
            savedAt: 30_000,
            quality: { status: 'complete' },
            assets: [],
            messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Private local body' }] }] }],
        }, { title: 'Renamed on index-only browser', titleSource: 'provider', updatedAt: 30_000 });
        assert.equal((await syncer.syncNow()).push.uploaded, 1);
        const keyring = await deriveVaultKeyring(await parseRecoveryKey(recoveryKey));
        const localClient = createLocalFolderVaultClient(async () => newFolder.handle);
        const recordArgs = { serverUrl: '', sessionToken: '' };
        const feed = await localClient.listChanges({ ...recordArgs, sinceSeq: 0, limit: 50 });
        const latest = feed.items.find(item => item.revision === 2);
        assert.ok(latest, 'the title change reaches the destination vault');
        const backup = await localClient.getEncryptedRecord({ ...recordArgs, blindRecordId: latest.blindRecordId });
        assert.ok(backup);
        const opened = await openCloudConversation({ keyring, blindRecordId: latest.blindRecordId, ...backup });
        assert.equal(opened.index.title, 'Renamed on index-only browser');
        assert.match(JSON.stringify(opened.detail), /Backed-up body/);
        assert.doesNotMatch(JSON.stringify(opened.detail), /Private local body/);

        const records = newFolder.subdirs.get('records')?.files;
        assert.ok(records);
        const fileName = `${latest.blindRecordId}.gee1`;
        const corrupted = new Uint8Array(backup.envelope);
        corrupted[corrupted.length - 1] ^= 0xff;
        records.set(fileName, corrupted);

        assert.equal(await syncer.enqueueAllExistingHistory(), 0, 'unchanged Index-only sync does not queue the full backup');
        assert.equal((await syncer.syncNow()).push.retriedLater, 0, 'no-op sync does not reopen acknowledged ciphertext');
        await addIndex(account.id, 'shared', 'Another rename', 40_000);
        await addIndex(account.id, 'healthy-record', 'Independent backup', 40_000);
        const withCorruptRecord = await syncer.syncNow();
        assert.equal(withCorruptRecord.push.retriedLater, 1, 'an unreadable backup is retried instead of overwritten');
        assert.equal(withCorruptRecord.push.uploaded, 1, 'an unreadable backup does not block the rest of the queue');
        assert.equal(records.get(fileName), corrupted);
    } finally {
        target.restore();
    }
});

test('Local folder rejects unrelated keys without purging and merges after importing the original key', async () => {
    const sharedFolder = createMemoryDirectoryHandle('SharedSyncedFolder');
    let keyARecovery = '';

    // 1. Browser 1 initializes SharedSyncedFolder with Key A and backs up "Chat From Browser 1"
    const env1 = indexStorage();
    try {
        await env1.ready;
        const engine1 = createCloudSyncEngine();
        keyARecovery = await prepareOneTimeVaultKey();
        await createVaultKeySetup(engine1.activateVaultKeyring)(keyARecovery, 'generated', null);
        await engine1.connectLocalFolderVault(sharedFolder.handle);
        const acc1 = await getOrCreateAccount('gemini', 'gaia-user-conflict');
        await ingestIndexes(acc1.id, [{
            conversationId: 'c_from_browser_1',
            fields: { title: 'Chat From Browser 1', titleSource: 'provider', updatedAt: 10_000 },
        }]);
        await engine1.setAutoSyncEnabled(true);
        await engine1.waitForIdle();
        assert.equal(sharedFolder.subdirs.get('records')?.files.size, 1);
    } finally {
        env1.restore();
    }

    // 2. Browser 2 (separate browser without Chrome Sync) generates its own Key B first,
    //    has a local conversation "Chat From Browser 2", and then connects to SharedSyncedFolder!
    const env2 = indexStorage();
    try {
        await env2.ready;
        const engine2 = createCloudSyncEngine();
        const setup = createVaultKeySetup(engine2.activateVaultKeyring);
        const acc2 = await getOrCreateAccount('gemini', 'gaia-user-conflict');
        await ingestIndexes(acc2.id, [{
            conversationId: 'c_from_browser_2',
            fields: { title: 'Chat From Browser 2', titleSource: 'provider', updatedAt: 20_000 },
        }]);

        const keyB = await setup(await prepareOneTimeVaultKey(), 'generated', null);
        const conn2 = await engine2.connectLocalFolderVault(sharedFolder.handle);
        assert.equal(conn2.keyFingerprint, keyB.keyFingerprint);
        await engine2.setAutoSyncEnabled(true);
        await engine2.waitForIdle();

        // Sync must halt with CLOUD_KEY_MISMATCH and NEVER pollute SharedSyncedFolder with Key B ciphertexts!
        await assert.rejects(
            engine2.syncNow(),
            (err: unknown) => err instanceof OperationError && err.code === 'CLOUD_KEY_MISMATCH',
        );
        assert.equal((await engine2.getStatusSnapshot()).keyMismatch, true);
        assert.equal(sharedFolder.subdirs.get('records')?.files.size, 1, 'Split-brain prevented: zero Key B files written into Key A vault');

        // Pasting an unrelated 3rd Key C must be rejected without mutating Browser 2's state
        const unrelatedKeyC = await prepareOneTimeVaultKey();
        await assert.rejects(
            setup(unrelatedKeyC, 'imported', keyB.keyFingerprint),
            (err: unknown) => err instanceof OperationError && err.code === 'CLOUD_KEY_MISMATCH',
        );

        // Importing the true Key A unlocks the vault, pulls Browser 1's chat, AND pushes Browser 2's chat encrypted under Key A!
        const unlockRes = await setup(keyARecovery, 'imported', keyB.keyFingerprint);
        assert.equal(unlockRes.resolution, 'unlocked');
        const mergedSync = await engine2.syncNow();
        assert.equal(mergedSync.pull.accepted, 1);
        assert.equal(mergedSync.push.uploaded, 1);
        assert.equal((await engine2.getStatusSnapshot()).keyMismatch, undefined);
        assert.equal(sharedFolder.subdirs.get('records')?.files.size, 2, 'Both conversations now cleanly stored under Key A');
        assert.equal((await getIndex({ accountId: acc2.id, conversationId: 'c_from_browser_1' }))?.title, 'Chat From Browser 1');
        assert.equal((await getIndex({ accountId: acc2.id, conversationId: 'c_from_browser_2' }))?.title, 'Chat From Browser 2');

        // Even an unlocked folder must not be overwritten when another valid key is pasted.
        const manifest = sharedFolder.files.get('vault-manifest.json');
        const ciphertext = [...sharedFolder.subdirs.get('records')!.files];
        await assert.rejects(setup(unrelatedKeyC, 'imported', unlockRes.keyFingerprint), { code: 'CLOUD_KEY_MISMATCH' });
        assert.equal((await engine2.getStatusSnapshot()).keyFingerprint, unlockRes.keyFingerprint);
        assert.deepEqual(sharedFolder.files.get('vault-manifest.json'), manifest);
        assert.deepEqual([...sharedFolder.subdirs.get('records')!.files], ciphertext);

        // Connected key rotation (`origin === 'generated'`): generating a new key on an unlocked folder losslessly re-encrypts all records
        const rotatedKey = await prepareOneTimeVaultKey();
        const rotated = await setup(rotatedKey, 'generated', unlockRes.keyFingerprint);
        assert.equal(rotated.resolution, 'rekeyed');
        const rekeySync = await engine2.syncNow();
        assert.equal(rekeySync.push.uploaded, 2);
        const manifestAfterRotate = JSON.parse(new TextDecoder().decode(sharedFolder.files.get('vault-manifest.json')!)) as {
            keyFingerprint: string;
            records: Record<string, unknown>;
        };
        assert.equal(manifestAfterRotate.keyFingerprint, rotated.keyFingerprint);
        assert.equal(Object.keys(manifestAfterRotate.records).length, 2);
    } finally {
        env2.restore();
    }
});
});

__suiteDescribe("vault_key_setup", () => {
test('Vault key setup clears owned recovery buffers on success and failure', async t => {
    const valid = await formatRecoveryKey(new Uint8Array(MASTER_KEY_BYTES).fill(42));
    const incorrectChecksum = 'GEK1-B' + valid.slice(6);
    const invalidAlphabet = valid.slice(0, -1) + 'U';
    const invalidPadding = valid.slice(0, -1) + '1';
    const activate = t.mock.fn(async () => ({ keyFingerprint: '', resolution: 'initialized' as const }));
    const setup = createVaultKeySetup(activate);
    const simulatedFailure = new Error('digest unavailable');
    const generate = () => prepareOneTimeVaultKey();
    const importValid = () => setup(valid, 'imported', null);
    const rejectInvalid = (value: string) => assert.rejects(setup(value, 'imported', null), { code: 'CLOUD_KEY_INVALID' });

    for (const [label, action, digestFails, expectedDigests] of [
        ['generate', generate, false, 1],
        ['import', importValid, false, 1],
        ['bad checksum', () => rejectInvalid(incorrectChecksum), false, 1],
        ['invalid alphabet', () => rejectInvalid(invalidAlphabet), false, 0],
        ['invalid padding', () => rejectInvalid(invalidPadding), false, 0],
        ['generate with failed digest', () => assert.rejects(generate(), simulatedFailure), true, 1],
        ['import with failed digest', () => assert.rejects(importValid(), simulatedFailure), true, 1],
    ] as const) {
        await t.test(label, async subtest => {
            const ownedBuffers: Uint8Array[] = [];
            const digestInputs: ArrayBufferView[] = [];
            const digest = crypto.subtle.digest.bind(crypto.subtle);
            subtest.mock.method(crypto.subtle, 'digest', async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
                if (ArrayBuffer.isView(data)) digestInputs.push(data);
                if (digestFails) throw simulatedFailure;
                return digest(algorithm, data);
            });
            const Bytes = Uint8Array;
            globalThis.Uint8Array = new Proxy(Bytes, {
                construct(target, args, newTarget) {
                    const buffer = Reflect.construct(target, args, newTarget) as Uint8Array;
                    if (args[0] === MASTER_KEY_BYTES + 2) ownedBuffers.push(buffer);
                    return buffer;
                },
            });
            try {
                await action();
            } finally {
                globalThis.Uint8Array = Bytes;
            }
            assert.equal(digestInputs.length, expectedDigests);
            assert.equal(
                digestInputs.every(view => new Bytes(view.buffer, view.byteOffset, view.byteLength).every(byte => byte === 0)),
                true,
                'checksum input is cleared',
            );
            assert.equal(ownedBuffers.every(buffer => buffer.every(byte => byte === 0)), true, 'recovery buffer is cleared');
        });
    }
    assert.equal(activate.mock.callCount(), 1, 'only the valid import reaches activation');
});
});

__suiteDescribe("cloud_archive_codec", () => {
test("index-only cloud restore counts partial updates and equal facts while rejecting unchanged stale rows", async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const account = await getOrCreateAccount("gemini", "restore-index-account");
        const entry = (conversationId: string, updatedAt: number): PortableCloudConversation => ({
            schema: CLOUD_CONVERSATION_SCHEMA, version: 1,
            account: { providerId: account.providerId, providerAccountId: account.providerAccountId },
            conversationId, index: { title: "Same title", titleSource: "provider", updatedAt },
        });
        await ingestIndexes(account.id, ["stale", "equal", "newer", "partial-title", "partial-time", "sparse"].map(conversationId => ({
            conversationId, fields: entry(conversationId, 200).index,
        })));
        const summary = await restoreCloudConversationsToLocal([
            entry("stale", 100), entry("equal", 200), entry("newer", 300), entry("new", 100),
            { ...entry("partial-title", 100), index: { ...entry("partial-title", 100).index, title: "Incoming title" } },
            { ...entry("partial-time", 300), index: { title: "Derived title", titleSource: "derived", updatedAt: 300 } },
            { ...entry("sparse", 200), index: { updatedAt: 200 } },
        ]);
        assert.deepEqual(summary, { accepted: 6, rejected: 1, changed: 4, touchedAccountIds: [account.id] });
        const partialTime = await getIndex({ accountId: account.id, conversationId: "partial-time" });
        assert.equal(partialTime?.title, "Same title");
        assert.equal(partialTime?.updatedAt, 300);
        assert.equal((await getIndex({ accountId: account.id, conversationId: "stale" }))?.updatedAt, 200);
        assert.deepEqual(await restoreCloudConversationsToLocal([]), { accepted: 0, rejected: 0, changed: 0, touchedAccountIds: [] });
        await assert.rejects(restoreCloudConversationsToLocal([
            { ...entry("invalid", 100), index: { updatedAt: NaN } },
        ]), /Invalid conversation index schema/);
    } finally { env.restore(); }
});
});
