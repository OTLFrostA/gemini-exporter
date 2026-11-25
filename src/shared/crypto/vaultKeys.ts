import { OperationError } from '../errors/operationError.js';
import { MASTER_KEY_BYTES, toOwnedBytes } from './recoveryKey.js';

const encoder = new TextEncoder();
const HKDF_SALT = encoder.encode('gemini-exporter/cloud-e2ee/hkdf-salt/v1');
const INFO_RECORD_ID = encoder.encode('gemini-exporter/cloud-e2ee/v1/record-id-hmac');
const INFO_PAYLOAD_AEAD = encoder.encode('gemini-exporter/cloud-e2ee/v1/payload-aes-256-gcm');
const INFO_FINGERPRINT = encoder.encode('gemini-exporter/cloud-e2ee/v1/keyring-fingerprint');
const INFO_SERVER_AUTH = encoder.encode('gemini-exporter/cloud-e2ee/v2/server-auth-hmac');

/**
 * Browser-managed, non-extractable handles. Code with access to the handles can still use them.
 */
export interface VaultKeyring {
    readonly keyFingerprint: string;
    readonly recordIdKey: CryptoKey;
    readonly payloadKey: CryptoKey;
    readonly authKey: CryptoKey;
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
        const derivationKey = await crypto.subtle.importKey('raw', ownedKey, 'HKDF', false, ['deriveKey', 'deriveBits']);
        const salt = toOwnedBytes(HKDF_SALT);
        const [recordIdKey, payloadKey, fingerprintBits, authKey] = await Promise.all([
            crypto.subtle.deriveKey(
                { name: 'HKDF', hash: 'SHA-256', salt, info: toOwnedBytes(INFO_RECORD_ID) },
                derivationKey,
                { name: 'HMAC', hash: 'SHA-256', length: 256 },
                false,
                ['sign'],
            ),
            crypto.subtle.deriveKey(
                { name: 'HKDF', hash: 'SHA-256', salt, info: toOwnedBytes(INFO_PAYLOAD_AEAD) },
                derivationKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt'],
            ),
            crypto.subtle.deriveBits(
                { name: 'HKDF', hash: 'SHA-256', salt, info: toOwnedBytes(INFO_FINGERPRINT) },
                derivationKey,
                128,
            ),
            crypto.subtle.deriveKey(
                { name: 'HKDF', hash: 'SHA-256', salt, info: INFO_SERVER_AUTH },
                derivationKey,
                { name: 'HMAC', hash: 'SHA-256', length: 256 },
                false,
                ['sign'],
            ),
        ]);
        return {
            keyFingerprint: bytesToHex(new Uint8Array(fingerprintBits)),
            recordIdKey,
            payloadKey,
            authKey,
        };
    } finally {
        ownedKey.fill(0);
    }
}

/**
 * The proof is a replayable credential, independent of the encryption and blind-index keys.
 */
export async function deriveServerAuthToken(keyring: Pick<VaultKeyring, 'keyFingerprint' | 'authKey'>): Promise<string> {
    const proof = encodeLengthPrefixedTuple(['ge-server-auth-proof-v2', keyring.keyFingerprint]);
    return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', keyring.authKey, proof)));
}

/** Separate credential for destructive operations. Hand out the verifier at vault creation. */
export async function deriveVaultPurgeProof(keyring: Pick<VaultKeyring, 'keyFingerprint' | 'authKey'>): Promise<string> {
    const context = encodeLengthPrefixedTuple(['ge-vault-purge-proof-v2', keyring.keyFingerprint]);
    return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', keyring.authKey, context)));
}

/**
 * Compute the deterministic 64-char hex blind record identifier for a conversation.
 * Does not expose the underlying provider, account or conversation identifiers.
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
