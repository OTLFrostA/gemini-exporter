import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationError } from '../src/shared/errors/operationError.js';
import {
    deriveBlindRecordId,
    deriveVaultKeyring,
    formatRecoveryKey,
    generateMasterKeyBytes,
    parseRecoveryKey,
    sealUtf8Record,
} from '../src/shared/crypto/index.js';
import { encodePortableCloudConversation } from '../src/l2/cloudPayload.js';
import { ingestDetail } from '../src/l2/ingestion.js';
import { readConversation } from '../src/l2/readConversation.js';
import { getOrCreateAccount } from '../src/runtime/api/accountRegistry.js';
import { listAccounts } from '../src/l3a/storageService.js';
import {
    openCloudConversation,
    portableVaultSubject,
    restoreCloudConversationsToLocal,
    sealCloudConversation,
} from '../src/application/vault/cloudArchiveCodec.js';
import { runExport } from '../src/application/export/runExport.js';
import { __getZipConstructor, __setZipConstructor } from '../src/l4/packaging/writers/zipWriter.js';
import { indexStorage } from './helpers/indexStorage.js';
import { readDeliveredFiles, v2ExportHost } from './helpers/v2ExportHost.js';

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
