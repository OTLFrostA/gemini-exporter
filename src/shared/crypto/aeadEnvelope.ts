import { OperationError } from '../errors/operationError.js';
import { compressUtf8Gzip, decompressUtf8GzipBounded, MAX_DECOMPRESSED_UTF8_BYTES } from './boundedGzip.js';
import { encodeLengthPrefixedTuple, type VaultKeyring } from './vaultKeys.js';

/** Wire Magic "GEE1" (Gemini Exporter Envelope v1). */
const ENVELOPE_MAGIC = new Uint8Array([0x47, 0x45, 0x45, 0x31]);
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const MIN_ENVELOPE_BYTES = ENVELOPE_MAGIC.byteLength + IV_BYTES + GCM_TAG_BYTES;

/** Simple, explicit per-conversation ciphertext ceiling (2 MiB). */
export const MAX_ENCRYPTED_RECORD_BYTES = 2 * 1024 * 1024;

const BLIND_RECORD_ID_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Authenticated context cryptographically bound into the AES-GCM tag via AAD.
 * Prevents cross-tenant splicing, cross-record swapping, and revision rollback.
 */
export interface EnvelopeAuthContext {
    readonly ownerSubject: string;
    readonly blindRecordId: string;
    readonly revision: number;
}

function validateAuthContext(context: EnvelopeAuthContext): void {
    if (typeof context.ownerSubject !== 'string' || !context.ownerSubject.trim()) {
        throw new OperationError('CLOUD_ENVELOPE_INVALID', 'Envelope AAD requires a non-empty ownerSubject');
    }
    if (typeof context.blindRecordId !== 'string' || !BLIND_RECORD_ID_PATTERN.test(context.blindRecordId)) {
        throw new OperationError('CLOUD_ENVELOPE_INVALID', 'Envelope AAD requires a canonical 64-hex blindRecordId');
    }
    if (typeof context.revision !== 'number' || !Number.isSafeInteger(context.revision) || context.revision < 1) {
        throw new OperationError('CLOUD_ENVELOPE_INVALID', 'Envelope AAD requires a positive safe-integer revision');
    }
}

function buildAdditionalData(context: EnvelopeAuthContext): Uint8Array<ArrayBuffer> {
    validateAuthContext(context);
    return encodeLengthPrefixedTuple([
        'GEE1-AAD',
        context.ownerSubject,
        context.blindRecordId,
        String(context.revision),
    ]);
}

export interface SealOptions {
    readonly maxEncryptedBytes?: number;
}

export interface OpenOptions {
    readonly maxEncryptedBytes?: number;
    readonly maxDecompressedBytes?: number;
}

/**
 * Compress UTF-8 plaintext with Gzip, seal with AES-256-GCM + AAD, and enforce the 2 MiB wire limit.
 */
export async function sealUtf8Record(
    keyring: VaultKeyring,
    plaintextUtf8: string,
    context: EnvelopeAuthContext,
    options: SealOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
    const additionalData = buildAdditionalData(context);
    const maxEncryptedBytes = options.maxEncryptedBytes ?? MAX_ENCRYPTED_RECORD_BYTES;
    const compressed = await compressUtf8Gzip(plaintextUtf8);
    if (ENVELOPE_MAGIC.byteLength + IV_BYTES + compressed.byteLength + GCM_TAG_BYTES > maxEncryptedBytes) {
        throw new OperationError(
            'CLOUD_RECORD_TOO_LARGE',
            `Encrypted conversation exceeds ${maxEncryptedBytes} byte limit`,
        );
    }
    const iv = new Uint8Array(IV_BYTES);
    crypto.getRandomValues(iv);
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData, tagLength: GCM_TAG_BYTES * 8 },
            keyring.payloadKey,
            compressed,
        ),
    );
    const envelope = new Uint8Array(ENVELOPE_MAGIC.byteLength + IV_BYTES + ciphertext.byteLength);
    envelope.set(ENVELOPE_MAGIC, 0);
    envelope.set(iv, ENVELOPE_MAGIC.byteLength);
    envelope.set(ciphertext, ENVELOPE_MAGIC.byteLength + IV_BYTES);
    if (envelope.byteLength > maxEncryptedBytes) {
        throw new OperationError(
            'CLOUD_RECORD_TOO_LARGE',
            `Encrypted conversation exceeds ${maxEncryptedBytes} byte limit`,
        );
    }
    return envelope;
}

/**
 * Authenticate and decrypt a `GEE1` binary envelope BEFORE running bounded Gzip decompression.
 * Rejects any header corruption, wrong key, tampered ciphertext, or mismatched AAD immediately.
 */
export async function openUtf8Record(
    keyring: VaultKeyring,
    envelope: Uint8Array,
    context: EnvelopeAuthContext,
    options: OpenOptions = {},
): Promise<string> {
    const additionalData = buildAdditionalData(context);
    const maxEncryptedBytes = options.maxEncryptedBytes ?? MAX_ENCRYPTED_RECORD_BYTES;
    if (envelope.byteLength > maxEncryptedBytes) {
        throw new OperationError('CLOUD_RECORD_TOO_LARGE', `Envelope exceeds ${maxEncryptedBytes} byte limit`);
    }
    if (envelope.byteLength < MIN_ENVELOPE_BYTES) {
        throw new OperationError('CLOUD_ENVELOPE_INVALID', 'Truncated cloud ciphertext envelope');
    }
    for (let i = 0; i < ENVELOPE_MAGIC.byteLength; i++) {
        if (envelope[i] !== ENVELOPE_MAGIC[i]) {
            throw new OperationError('CLOUD_ENVELOPE_INVALID', 'Unsupported cloud envelope header or version');
        }
    }
    const iv = new Uint8Array(IV_BYTES);
    iv.set(envelope.subarray(ENVELOPE_MAGIC.byteLength, ENVELOPE_MAGIC.byteLength + IV_BYTES));
    const ciphertextLen = envelope.byteLength - ENVELOPE_MAGIC.byteLength - IV_BYTES;
    const ciphertext = new Uint8Array(ciphertextLen);
    ciphertext.set(envelope.subarray(ENVELOPE_MAGIC.byteLength + IV_BYTES));

    let compressedPlaintext: Uint8Array;
    try {
        const buffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData, tagLength: GCM_TAG_BYTES * 8 },
            keyring.payloadKey,
            ciphertext,
        );
        compressedPlaintext = new Uint8Array(buffer);
    } catch (error) {
        throw new OperationError(
            'CLOUD_DECRYPT_AUTH_FAILED',
            'Cloud record authentication or decryption failed',
            undefined,
            { cause: error },
        );
    }
    return decompressUtf8GzipBounded(compressedPlaintext, options.maxDecompressedBytes ?? MAX_DECOMPRESSED_UTF8_BYTES);
}
