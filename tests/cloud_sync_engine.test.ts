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

test('CloudSyncEngine end-to-end: post-toggle auto-enqueue, network failure retry, Chrome Sync keyring sharing, and 409 optimistic conflict auto-heal across devices', async () => {
    const backend = createMockCloudVaultHttp();
    const sharedChromeSync: Record<string, unknown> = {};
    let networkOffline = false;
    let clockMs = Date.now();

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

            // Connect with derived key & flip the auto-sync switch ON -> automatically backs up existing history immediately!
            const connectedA = await engineA.connectCloudVault(SERVER_URL);
            assert.equal(connectedA.createdNewKey, true);
            assert.match(connectedA.recoveryKey, /^GEK1-/);
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

    // ================= DEVICE B (Fresh DB, same Chrome Sync bag!) =================
    const envB = indexStorage();
    try {
        await envB.ready;
        attachSharedChromeSync(sharedChromeSync);
        const engineB = createCloudSyncEngine({
            client: createCloudVaultClient(transport),
            now: () => clockMs,
        });
        const unsubscribeB = engineB.installAutoEnqueueListener();
        try {
            const connectedB = await engineB.connectCloudVault(SERVER_URL);
            assert.equal(connectedB.createdNewKey, false, 'Device B automatically inherited Master Key from chrome.storage.sync!');
            await engineB.setIncludeDetail(true);
            await engineB.setAutoSyncEnabled(true);
            await engineB.waitForIdle();

            // Enabling sync on Device B already pulled both records automatically without manual pullChanges()!
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
        await engineC.connectCloudVault(SERVER_URL);
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
    } finally {
        envC.restore();
    }
});
