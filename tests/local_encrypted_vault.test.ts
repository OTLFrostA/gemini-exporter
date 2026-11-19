import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationError } from '../src/shared/errors/operationError.js';
import type { DirectoryHandle } from '../src/shared/types/directoryHandle.js';
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
