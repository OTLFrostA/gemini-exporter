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
import {
    createGoogleOidcVerifier,
    encodeBase64UrlBytes,
    type JsonWebKeyWithKid,
} from '../cloud-server/src/auth/googleOidc.js';
import { createCloudServerHandler } from '../cloud-server/src/router.js';
import { createInMemoryVaultStore, sha256Hex } from '../cloud-server/src/storage/vaultStore.js';
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
            const keyring = await deriveVaultKeyring(await parseRecoveryKey(connected.recoveryKey));
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
            const keyPair = await crypto.subtle.generateKey(
                { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
                true,
                ['sign', 'verify'],
            );
            const pubJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
            const jwk: JsonWebKeyWithKid = { ...pubJwk, kid: 'port-1', alg: 'RS256', use: 'sig' };
            const cloudStore = createInMemoryVaultStore();
            const cloudHandler = createCloudServerHandler({
                store: cloudStore,
                oidcVerifier: createGoogleOidcVerifier(async () => ({ keys: [jwk] })),
                config: { sessionHmacSecret: 'portability-hmac-secret-at-least-32-bytes!!', googleClientIds: ['cid'], allowedOrigins: ['*'] },
            });
            await cloudStore.ensureUser('google:migrated_user', 10_000_000);
            for (const [fileName, bytes] of recordsSubdir.files) {
                const blindId = fileName.replace(/\.gee1$/, '');
                const putRes = await cloudStore.putRecord({
                    ownerSubject: 'google:migrated_user',
                    blindRecordId: blindId,
                    expectedRevision: 0,
                    ciphertext: bytes, // Exact untouched bytes from local disk!
                    sha256: await sha256Hex(bytes),
                });
                assert.equal(putRes.status, 'committed');
            }

            await clearLocalScanRecords(acc.id);
            const nowSec = Math.floor(Date.now() / 1000);
            const h = encodeBase64UrlBytes(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'port-1' })));
            const p = encodeBase64UrlBytes(new TextEncoder().encode(JSON.stringify({
                iss: 'https://accounts.google.com', aud: 'cid', sub: 'migrated_user', iat: nowSec - 5, exp: nowSec + 3600,
            })));
            const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new Uint8Array(new TextEncoder().encode(`${h}.${p}`))));
            const cloudEngine = createCloudSyncEngine({
                client: createCloudVaultClient((url, init) => cloudHandler(new Request(url, init))),
            });
            const cloudConn = await cloudEngine.connectWithGoogleIdToken('https://cloud.port.test', `${h}.${p}.${encodeBase64UrlBytes(sig)}`);
            assert.equal(cloudConn.recoveryKey, connected.recoveryKey, 'Local vault key automatically promoted to Cloud account!');
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
