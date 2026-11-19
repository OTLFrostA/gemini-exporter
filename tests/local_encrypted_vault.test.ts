import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationError } from '../src/shared/errors/operationError.js';
import { IDBObjectStore } from 'fake-indexeddb';
import { createLocalFolderVaultClient, LOCAL_VAULT_OWNER_SUBJECT } from '../src/l1/cloud/localFolderVaultClient.js';
import { createCloudSyncEngine } from '../src/application/cloud/cloudSyncEngine.js';
import { openCloudConversation } from '../src/application/cloud/cloudArchiveCodec.js';
import { createCloudVaultClient } from '../src/l1/cloud/vaultClient.js';
import { ingestDetail, ingestIndexes } from '../src/l2/ingestion.js';
import { readConversation } from '../src/l2/readConversation.js';
import { getDetail, getIndex } from '../src/l3a/storageService.js';
import { deriveVaultKeyring, parseRecoveryKey } from '../src/shared/crypto/index.js';
import { createVaultKeySetup, prepareOneTimeVaultKey } from '../src/application/cloud/vaultKeySetup.js';
import { getOrCreateAccount } from '../src/runtime/api/accountRegistry.js';
import { clearLocalScanRecords } from '../src/application/localCleanup.js';
import { indexStorage } from './helpers/indexStorage.js';
import { createMockCloudVaultHttp } from './helpers/mockCloudVaultHttp.js';
import { getCloudSyncSession, getStoredLocalVaultHandle, getSyncedCloudRecord, putSyncedCloudRecord, enqueueCloudOutboxKeys, countCloudOutbox } from '../src/l3a/cloudSyncStore.js';
import { pickVaultDirectoryHandle } from '../src/runtime/capabilities/vaultFolderAuth.js';
import { createMemoryDirectoryHandle } from './helpers/memoryVaultDirectory.js';


test('vault target switch resync: local-folder', async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const folders = [createMemoryDirectoryHandle('Vault'), createMemoryDirectoryHandle('Vault')];
        const engine = createCloudSyncEngine();
        await createVaultKeySetup(engine.activateVaultKeyring)(await prepareOneTimeVaultKey(), 'generated', null);
        const connect = (target: number) => engine.connectLocalFolderVault(folders[target].handle);
        const count = (target: number) => folders[target].subdirs.get('records')?.files.size ?? 0;
        const account = await getOrCreateAccount('gemini', 'target-switch');
        await connect(0);
        await engine.setAutoSyncEnabled(true);
        await engine.waitForIdle();
        assert.equal(count(0), 0, 'empty history stays empty');
        await ingestIndexes(account.id, [{ conversationId: 'existing', fields: { title: 'Existing', titleSource: 'provider', updatedAt: 1000 } }]);
        assert.equal((await engine.syncNow()).push.uploaded, 1);
        await connect(0);
        assert.equal((await engine.syncNow()).push.uploaded, 0, 'same target re-save is unchanged');
        await connect(1);
        assert.equal((await engine.syncNow()).push.uploaded, 1, 'existing history must upload to target B');
        assert.equal(count(1), 1);
        await connect(0);
        assert.equal((await engine.syncNow()).push.uploaded, 0, 'returning to A pulls its ledger without re-upload');
        assert.equal(count(0), 1);
    } finally {
        env.restore();
    }
});

test('vault target switch resync: shared folder identity overrides another engine cached handle', async () => {
    const env = indexStorage();
    const folders = [createMemoryDirectoryHandle('Vault'), createMemoryDirectoryHandle('Vault')];
    try {
        await env.ready;
        const first = createCloudSyncEngine();
        const second = createCloudSyncEngine();
        await createVaultKeySetup(first.activateVaultKeyring)(await prepareOneTimeVaultKey(), 'generated', null);
        await first.connectLocalFolderVault(folders[0].handle);
        await second.connectLocalFolderVault(folders[1].handle);
        assert.equal(await getStoredLocalVaultHandle(), folders[1].handle);
        const account = await getOrCreateAccount('gemini', 'shared-target-switch');
        await ingestIndexes(account.id, [{ conversationId: 'existing', fields: { title: 'Existing', titleSource: 'provider', updatedAt: 1000 } }]);
        await second.setAutoSyncEnabled(true);
        await second.waitForIdle();
        assert.equal(folders[1].subdirs.get('records')?.files.size, 1);
        const connected = await first.connectLocalFolderVault(folders[0].handle);
        assert.equal((await first.syncNow()).push.uploaded, 1, 'B ledger must not suppress uploads to cached A');
        assert.equal(connected.session.pulledSeq, 0);
        assert.equal(folders[0].subdirs.get('records')?.files.size, 1);
        await first.connectLocalFolderVault(folders[0].handle);
        assert.equal((await first.syncNow()).push.uploaded, 0);
    } finally {
        env.restore();
    }
});

for (const scenario of ['picker', 'shared-writer', 'atomic-switch', 'other-owner'] as const) {
    test(`round3 local vault: ${scenario}`, async () => {
        const env = indexStorage();
        const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        const folders = [createMemoryDirectoryHandle('A'), createMemoryDirectoryHandle('B')];
        let picked = folders[0].handle;
        Object.defineProperty(globalThis, 'window', { configurable: true, value: { showDirectoryPicker: async () => picked } });
        try {
            await env.ready;
            const first = createCloudSyncEngine();
            const second = createCloudSyncEngine();
            await createVaultKeySetup(first.activateVaultKeyring)(await prepareOneTimeVaultKey(), 'generated', null);
            await first.connectLocalFolderVault(scenario === 'picker' ? await pickVaultDirectoryHandle() : picked);
            const account = await getOrCreateAccount('gemini', 'round3');
            const key = { accountId: account.id, conversationId: 'existing' };
            await ingestIndexes(account.id, [{ conversationId: key.conversationId, fields: { title: 'Existing', titleSource: 'provider', updatedAt: 1000 } }]);
            await first.setAutoSyncEnabled(true);
            await first.waitForIdle();
            assert.equal(folders[0].subdirs.get('records')?.files.size, 1);
            if (scenario === 'picker') {
                picked = folders[1].handle;
                await first.connectLocalFolderVault(await pickVaultDirectoryHandle());
                assert.equal((await first.syncNow()).push.uploaded, 1, 'picker must not overwrite the previous target before connection');
                assert.equal(folders[1].subdirs.get('records')?.files.size, 1);
            } else if (scenario === 'shared-writer') {
                await second.connectLocalFolderVault(folders[1].handle);
                await second.syncNow();
                await ingestIndexes(account.id, [{ conversationId: 'new', fields: { title: 'New', titleSource: 'provider', updatedAt: 2000 } }]);
                await first.syncNow();
                assert.equal(folders[1].subdirs.get('records')?.files.size, 2, 'background engine must write to shared target B');
                assert.equal(folders[0].subdirs.get('records')?.files.size, 1, 'old target A must stay unchanged');
                folders[1].setPermission('prompt');
                assert.equal((await first.getStatusSnapshot()).folderPermissionRequired, true);
            } else if (scenario === 'atomic-switch') {
                const session = await getCloudSyncSession();
                const ledger = await getSyncedCloudRecord(LOCAL_VAULT_OWNER_SUBJECT, key);
                await enqueueCloudOutboxKeys([key]);
                const put = IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
                    if (this.name === 'vaultHandles') throw new Error('injected handle write failure');
                    return arguments.length === 1 ? put.call(this, value) : put.call(this, value, key);
                };
                try {
                    await assert.rejects(first.connectLocalFolderVault(folders[1].handle), /injected handle write failure/);
                } finally {
                    IDBObjectStore.prototype.put = put;
                }
                assert.deepEqual(await getCloudSyncSession(), session, 'failed switch must preserve the old session');
                assert.equal(await getStoredLocalVaultHandle(), folders[0].handle);
                assert.deepEqual(await getSyncedCloudRecord(LOCAL_VAULT_OWNER_SUBJECT, key), ledger);
                assert.equal((await countCloudOutbox()).total, 1);
            } else {
                const other = { ownerSubject: 'cloud:other', accountId: key.accountId, conversationId: 'other', blindRecordId: 'b'.repeat(64), remoteRevision: 1, payloadSha256: 'c'.repeat(64), syncedAt: 1000 };
                await putSyncedCloudRecord(other);
                await first.connectLocalFolderVault(folders[1].handle);
                assert.deepEqual(await getSyncedCloudRecord(other.ownerSubject, { accountId: other.accountId, conversationId: other.conversationId }), other, 'local switch must preserve another owner ledger');
            }
        } finally {
            if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
            else Reflect.deleteProperty(globalThis, 'window');
            env.restore();
        }
    });
}

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
        // Temporarily stub setStoredLocalVaultHandle compatibility by storing a serializable marker on handle
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
