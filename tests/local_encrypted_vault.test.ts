import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationError } from '../src/shared/errors/operationError.js';
import type { DirectoryHandle } from '../src/shared/types/directoryHandle.js';
import { createLocalFolderVaultClient, LOCAL_VAULT_OWNER_SUBJECT } from '../src/l1/cloud/localFolderVaultClient.js';
import { createCloudSyncEngine } from '../src/application/cloud/cloudSyncEngine.js';
import { ingestDetail } from '../src/l2/ingestion.js';
import { readConversation } from '../src/l2/readConversation.js';
import { getOrCreateAccount } from '../src/runtime/api/accountRegistry.js';
import { clearLocalScanRecords } from '../src/application/localCleanup.js';
import { indexStorage } from './helpers/indexStorage.js';

interface MemoryDirNode {
    handle: DirectoryHandle;
    files: Map<string, Uint8Array<ArrayBuffer>>;
    subdirs: Map<string, MemoryDirNode>;
}

function createMemoryDirectoryHandle(name = 'MockEncryptedFolder', initialPerm: PermissionState = 'granted') {
    let permission: PermissionState = initialPerm;
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    const subdirs = new Map<string, MemoryDirNode>();

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
            isSameEntry: async () => false,
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
                fileMap.delete(entryName);
                dirMap.delete(entryName);
            },
        };
        const handle = Object.assign(Object.create(proto) as Record<string, unknown>, {
            kind: 'directory' as const,
            name: dirName,
        });
        return { handle: handle as unknown as DirectoryHandle, files: fileMap, subdirs: dirMap };
    }

    const root = makeDir(name, files, subdirs);
    return {
        handle: root.handle,
        files,
        subdirs,
        setPermission(next: PermissionState) { permission = next; },
    };
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
            const connected = await engine.connectLocalFolderVault(folder.handle);
            assert.equal(connected.session.backend, 'local-folder');
            assert.equal(connected.session.ownerSubject, LOCAL_VAULT_OWNER_SUBJECT);
            await engine.setAutoSyncEnabled(true);

            // Simulate browser restart revoking directory permission -> conversation stays safely queued in Outbox!
            folder.setPermission('prompt');
            await ingestDetail(acc.id, 'c_local_1', {
                savedAt: 5000,
                quality: { status: 'complete' },
                assets: [],
                messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Queued while locked' }] }] }],
            }, { title: 'Locked Folder Test', titleSource: 'provider', updatedAt: 5000 });
            await engine.waitForIdle();
            assert.equal((await engine.getStatusSnapshot()).pendingOutbox, 1);

            // User clicks Re-authorize -> flushOutbox writes .gee1 file and vault-manifest.json!
            folder.setPermission('granted');
            const flushed = await engine.flushOutbox();
            assert.equal(flushed.uploaded, 1);
            assert.equal((await engine.getStatusSnapshot()).pendingOutbox, 0);
            assert.equal(folder.files.has('vault-manifest.json'), true);
            const recordsSubdir = folder.subdirs.get('records');
            assert.ok(recordsSubdir);
            assert.equal(recordsSubdir.files.size, 1);

            // Wipe local DB and verify pullChanges restores 100% from the local encrypted folder
            await clearLocalScanRecords(acc.id);
            assert.equal(await readConversation({ accountId: acc.id, conversationId: 'c_local_1' }), null);

            const pulled = await engine.pullChanges();
            assert.equal(pulled.accepted, 1);
            const restored = await readConversation({ accountId: acc.id, conversationId: 'c_local_1' });
            assert.ok(restored);
            assert.equal(restored.index.title, 'Locked Folder Test');

            // Tamper 1 byte in the on-disk .gee1 file -> getEncryptedRecord detects SHA-256 corruption immediately!
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
