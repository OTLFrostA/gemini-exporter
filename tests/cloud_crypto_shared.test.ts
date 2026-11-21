import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationError } from '../src/shared/errors/operationError.js';
import {
    MASTER_KEY_BYTES,
    MAX_ENCRYPTED_RECORD_BYTES,
    compressUtf8Gzip,
    decompressUtf8GzipBounded,
    deriveBlindRecordId,
    deriveVaultKeyring,
    encodeLengthPrefixedTuple,
    formatRecoveryKey,
    generateMasterKeyBytes,
    openUtf8Record,
    parseRecoveryKey,
    sealUtf8Record,
} from '../src/shared/crypto/index.js';

test('recoveryKey - generates 256-bit random keys, round-trips GEK1 Crockford Base32, tolerates human formatting, and rejects single-char typos', async () => {
    const k1 = generateMasterKeyBytes();
    const k2 = generateMasterKeyBytes();
    assert.equal(k1.byteLength, MASTER_KEY_BYTES);
    assert.notDeepEqual(k1, k2);

    const formatted = await formatRecoveryKey(k1);
    assert.match(formatted, /^GEK1(?:-[0-9A-Z]{5}){11}$/);

    // Case-insensitive, whitespace/hyphen tolerant
    const messy = '  ' + formatted.toLowerCase().replace(/-/g, ' ') + '\n';
    const parsed = await parseRecoveryKey(messy);
    assert.deepEqual(parsed, k1);

    // Crockford transcription tolerance: 0 -> o, 1 -> i/l when present
    if (formatted.includes('0') || formatted.includes('1')) {
        const aliased = 'GEK1-' + formatted.slice(5).replace(/0/g, 'O').replace(/1/g, 'l');
        assert.deepEqual(await parseRecoveryKey(aliased), k1);
    }

    // Single-character mutation must fail the 16-bit SHA-256 checksum
    const bodyChars = formatted.split('');
    const lastIdx = bodyChars.length - 1;
    bodyChars[lastIdx] = bodyChars[lastIdx] === 'A' ? 'B' : 'A';
    await assert.rejects(
        parseRecoveryKey(bodyChars.join('')),
        (err: unknown) => err instanceof OperationError && err.code === 'CLOUD_KEY_INVALID',
    );

    // Wrong prefix, wrong length, invalid alphabet char ('U')
    await assert.rejects(parseRecoveryKey('GEK2' + formatted.slice(4)), { code: 'CLOUD_KEY_INVALID' });
    await assert.rejects(parseRecoveryKey(formatted.slice(0, -2)), { code: 'CLOUD_KEY_INVALID' });
    await assert.rejects(parseRecoveryKey(formatted.slice(0, -1) + 'U'), { code: 'CLOUD_KEY_INVALID' });
    await assert.rejects(formatRecoveryKey(new Uint8Array(16)), { code: 'CLOUD_KEY_INVALID' });
});

test('vaultKeys - derives non-extractable subkeys and collision-resistant blind record IDs', async () => {
    const master = generateMasterKeyBytes();
    const copy = new Uint8Array(master);
    const keyringA = await deriveVaultKeyring(copy);
    assert.deepEqual(copy, master, 'deriveVaultKeyring leaves caller buffer intact while zeroing its internal copy');
    const keyringA2 = await deriveVaultKeyring(master);
    const keyringB = await deriveVaultKeyring(generateMasterKeyBytes());

    assert.equal(keyringA.keyFingerprint, keyringA2.keyFingerprint);
    assert.match(keyringA.keyFingerprint, /^[0-9a-f]{32}$/);
    assert.notEqual(keyringA.keyFingerprint, keyringB.keyFingerprint);

    // CryptoKeys must be strictly non-extractable
    assert.equal(keyringA.payloadKey.extractable, false);
    assert.equal(keyringA.recordIdKey.extractable, false);
    await assert.rejects(crypto.subtle.exportKey('raw', keyringA.payloadKey));
    await assert.rejects(crypto.subtle.exportKey('raw', keyringA.recordIdKey));

    // Deterministic blind ID per (provider, account, conversation), distinct across keys & tuple boundaries
    const id1 = await deriveBlindRecordId(keyringA, 'gemini', '10001', 'c_abc');
    const id2 = await deriveBlindRecordId(keyringA2, 'gemini', '10001', 'c_abc');
    const idOtherKey = await deriveBlindRecordId(keyringB, 'gemini', '10001', 'c_abc');
    assert.equal(id1, id2);
    assert.match(id1, /^[0-9a-f]{64}$/);
    assert.notEqual(id1, idOtherKey);

    // Delimiter-injection / boundary shift resistance via length-prefixed tuples
    const left = await deriveBlindRecordId(keyringA, 'gemini:10', '001', 'chat');
    const right = await deriveBlindRecordId(keyringA, 'gemini', '10:001', 'chat');
    assert.notEqual(left, right, 'length-prefixed tuple encoding must prevent boundary-shift collisions');
});

test('boundedGzip - compresses repetitive JSON effectively and aborts streaming decompression on Gzip bombs', async () => {
    const sample = JSON.stringify({
        messages: Array.from({ length: 200 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            text: `Repeated analytical derivation step ${i}: $$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$`,
        })),
    });
    const compressed = await compressUtf8Gzip(sample);
    assert.ok(compressed.byteLength < sample.length * 0.25, 'expected >75% compression on structured conversation text');
    assert.equal(await decompressUtf8GzipBounded(compressed), sample);

    // Simulated bomb against a 4 KiB ceiling: must abort mid-stream with CLOUD_DECOMPRESSION_LIMIT
    await assert.rejects(
        decompressUtf8GzipBounded(compressed, 4096),
        (err: unknown) => err instanceof OperationError && err.code === 'CLOUD_DECOMPRESSION_LIMIT',
    );
    await assert.rejects(
        decompressUtf8GzipBounded(new Uint8Array([1, 2, 3, 4])),
        (err: unknown) => err instanceof OperationError && err.code === 'CLOUD_DECOMPRESSION_LIMIT',
    );
});

async function gzipInvalidUtf8(): Promise<Uint8Array<ArrayBuffer>> {
    const stream = new Blob([new Uint8Array([0xff, 0xfe])]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

test('boundedGzip - maps invalid UTF-8 to a cloud OperationError with its cause', async () => {
    await assert.rejects(
        decompressUtf8GzipBounded(await gzipInvalidUtf8()),
        (err: unknown) => err instanceof OperationError
            && err.code === 'CLOUD_DECOMPRESSION_LIMIT'
            && err.cause instanceof TypeError,
    );
});

test('aeadEnvelope - maps authenticated invalid UTF-8 to a cloud OperationError with its cause', async () => {
    const keyring = await deriveVaultKeyring(generateMasterKeyBytes());
    const context = {
        ownerSubject: 'google-sub-12345',
        blindRecordId: await deriveBlindRecordId(keyring, 'gemini', 'acct-1', 'invalid-utf8'),
        revision: 1,
    };
    const additionalData = encodeLengthPrefixedTuple([
        'GEE1-AAD', context.ownerSubject, context.blindRecordId, String(context.revision),
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
        keyring.payloadKey,
        await gzipInvalidUtf8(),
    ));
    const envelope = new Uint8Array(4 + iv.byteLength + ciphertext.byteLength);
    envelope.set(new TextEncoder().encode('GEE1'));
    envelope.set(iv, 4);
    envelope.set(ciphertext, 4 + iv.byteLength);

    await assert.rejects(
        openUtf8Record(keyring, envelope, context),
        (err: unknown) => err instanceof OperationError
            && err.code === 'CLOUD_DECOMPRESSION_LIMIT'
            && err.cause instanceof TypeError,
    );
});

test('aeadEnvelope - enforces AES-256-GCM + AAD integrity against bit-flips, wrong keys, tenant/slot swaps, rollback, and size limits', async () => {
    const keyring = await deriveVaultKeyring(generateMasterKeyBytes());
    const wrongKeyring = await deriveVaultKeyring(generateMasterKeyBytes());
    const blindIdA = await deriveBlindRecordId(keyring, 'gemini', 'acct-1', 'conv-a');
    const blindIdB = await deriveBlindRecordId(keyring, 'gemini', 'acct-1', 'conv-b');
    const ctx = { ownerSubject: 'google-sub-12345', blindRecordId: blindIdA, revision: 3 };
    const plaintext = JSON.stringify({ hello: '世界 🌍', math: '$E=mc^2$' });

    const sealed1 = await sealUtf8Record(keyring, plaintext, ctx);
    const sealed2 = await sealUtf8Record(keyring, plaintext, ctx);
    assert.notDeepEqual(sealed1, sealed2, 'random 96-bit IV must produce distinct ciphertexts for identical plaintexts');
    assert.ok(sealed1.byteLength < MAX_ENCRYPTED_RECORD_BYTES);
    assert.equal(await openUtf8Record(keyring, sealed1, ctx), plaintext);

    // Wrong key
    await assert.rejects(openUtf8Record(wrongKeyring, sealed1, ctx), { code: 'CLOUD_DECRYPT_AUTH_FAILED' });

    // Cross-tenant replay (different ownerSubject)
    await assert.rejects(
        openUtf8Record(keyring, sealed1, { ...ctx, ownerSubject: 'google-sub-attacker' }),
        { code: 'CLOUD_DECRYPT_AUTH_FAILED' },
    );

    // Cross-record slot swap (different blindRecordId)
    await assert.rejects(
        openUtf8Record(keyring, sealed1, { ...ctx, blindRecordId: blindIdB }),
        { code: 'CLOUD_DECRYPT_AUTH_FAILED' },
    );

    // Revision rollback / downgrade attack
    await assert.rejects(
        openUtf8Record(keyring, sealed1, { ...ctx, revision: 2 }),
        { code: 'CLOUD_DECRYPT_AUTH_FAILED' },
    );

    // Header magic corruption
    const badMagic = new Uint8Array(sealed1);
    badMagic[3] = 0x32; // 'GEE2'
    await assert.rejects(openUtf8Record(keyring, badMagic, ctx), { code: 'CLOUD_ENVELOPE_INVALID' });

    // Truncated envelope
    await assert.rejects(openUtf8Record(keyring, sealed1.subarray(0, 20), ctx), { code: 'CLOUD_ENVELOPE_INVALID' });

    // 1-bit flip in IV, ciphertext body, and GCM auth tag
    for (const byteIndex of [4, Math.floor(sealed1.byteLength / 2), sealed1.byteLength - 1]) {
        const tampered = new Uint8Array(sealed1);
        tampered[byteIndex] ^= 0x01;
        await assert.rejects(openUtf8Record(keyring, tampered, ctx), { code: 'CLOUD_DECRYPT_AUTH_FAILED' });
    }

    // Tight encrypted byte ceiling enforcement
    await assert.rejects(
        sealUtf8Record(keyring, plaintext, ctx, { maxEncryptedBytes: 32 }),
        { code: 'CLOUD_RECORD_TOO_LARGE' },
    );
    await assert.rejects(
        openUtf8Record(keyring, sealed1, ctx, { maxEncryptedBytes: 32 }),
        { code: 'CLOUD_RECORD_TOO_LARGE' },
    );
});
