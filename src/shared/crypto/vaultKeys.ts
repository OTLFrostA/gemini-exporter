import { OperationError } from '../errors/operationError.js';
import { MASTER_KEY_BYTES, toOwnedBytes } from './recoveryKey.js';

const encoder = new TextEncoder();
const HKDF_SALT = encoder.encode('gemini-exporter/cloud-e2ee/hkdf-salt/v1');
const INFO_RECORD_ID = encoder.encode('gemini-exporter/cloud-e2ee/v1/record-id-hmac');
const INFO_PAYLOAD_AEAD = encoder.encode('gemini-exporter/cloud-e2ee/v1/payload-aes-256-gcm');
const INFO_FINGERPRINT = encoder.encode('gemini-exporter/cloud-e2ee/v1/keyring-fingerprint');

/**
 * Non-extractable derived subkeys isolated by cryptographic purpose.
 * Raw key bytes are never retained on this object.
 */
export interface VaultKeyring {
    readonly keyFingerprint: string;
    readonly recordIdKey: CryptoKey;
    readonly payloadKey: CryptoKey;
}

export function bytesToHex(bytes: Uint8Array): string {
    let hex = '';
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
}

/**
 * Canonical injective length-prefixed tuple encoding: `[u32be(len_0), bytes_0, u32be(len_1), bytes_1, ...]`.
 * Eliminates delimiter-collision attacks in HMAC and AEAD AAD inputs.
 */
export function encodeLengthPrefixedTuple(fields: readonly string[]): Uint8Array<ArrayBuffer> {
    const encodedFields = fields.map(field => encoder.encode(field));
    let totalLength = 0;
    for (const part of encodedFields) {
        totalLength += 4 + part.byteLength;
    }
    const buffer = new Uint8Array(totalLength);
    const view = new DataView(buffer.buffer);
    let offset = 0;
    for (const part of encodedFields) {
        view.setUint32(offset, part.byteLength, false);
        offset += 4;
        buffer.set(part, offset);
        offset += part.byteLength;
    }
    return buffer;
}

/**
 * Derive non-extractable HMAC and AES-256-GCM keys from a 32-byte Master Key via HKDF-SHA256.
 */
export async function deriveVaultKeyring(masterKeyBytes: Uint8Array): Promise<VaultKeyring> {
    if (masterKeyBytes.byteLength !== MASTER_KEY_BYTES) {
        throw new OperationError('CLOUD_KEY_INVALID', `Master key must be ${MASTER_KEY_BYTES} bytes`);
    }
    const ownedKey = toOwnedBytes(masterKeyBytes);
    try {
        const baseKey = await crypto.subtle.importKey('raw', ownedKey, 'HKDF', false, ['deriveKey', 'deriveBits']);
        const salt = toOwnedBytes(HKDF_SALT);
        const [recordIdKey, payloadKey, fingerprintBits] = await Promise.all([
            crypto.subtle.deriveKey(
                { name: 'HKDF', hash: 'SHA-256', salt, info: toOwnedBytes(INFO_RECORD_ID) },
                baseKey,
                { name: 'HMAC', hash: 'SHA-256', length: 256 },
                false,
                ['sign'],
            ),
            crypto.subtle.deriveKey(
                { name: 'HKDF', hash: 'SHA-256', salt, info: toOwnedBytes(INFO_PAYLOAD_AEAD) },
                baseKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt'],
            ),
            crypto.subtle.deriveBits(
                { name: 'HKDF', hash: 'SHA-256', salt, info: toOwnedBytes(INFO_FINGERPRINT) },
                baseKey,
                128,
            ),
        ]);
        return {
            keyFingerprint: bytesToHex(new Uint8Array(fingerprintBits)),
            recordIdKey,
            payloadKey,
        };
    } finally {
        ownedKey.fill(0);
    }
}

/**
 * Compute the deterministic 64-char hex blind record identifier for a conversation.
 * Reveals zero metadata (neither provider, account, nor conversation ID) to the server.
 */
export async function deriveBlindRecordId(
    keyring: VaultKeyring,
    providerId: string,
    providerAccountId: string,
    conversationId: string,
): Promise<string> {
    if (!providerId.trim() || !providerAccountId.trim() || !conversationId.trim()) {
        throw new OperationError('CLOUD_PAYLOAD_INVALID', 'Blind record ID requires non-empty provider, account, and conversation IDs');
    }
    const tuple = encodeLengthPrefixedTuple(['ge-blind-id-v1', providerId, providerAccountId, conversationId]);
    const signature = await crypto.subtle.sign('HMAC', keyring.recordIdKey, tuple);
    return bytesToHex(new Uint8Array(signature));
}
