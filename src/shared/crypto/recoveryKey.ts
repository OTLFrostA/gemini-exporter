import { OperationError } from '../errors/operationError.js';

export const MASTER_KEY_BYTES = 32;
const CHECKSUM_BYTES = 2;
const RECOVERY_KEY_PREFIX = 'GEK1';
const CHECKSUM_DOMAIN = new TextEncoder().encode('gemini-exporter/recovery-key-checksum/v1:');

/** Unambiguous Crockford Base32 alphabet (excludes I, L, O, U). */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_LOOKUP: Readonly<Record<string, number>> = (() => {
    const table: Record<string, number> = {};
    for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
        const ch = CROCKFORD_ALPHABET[i];
        table[ch] = i;
        table[ch.toLowerCase()] = i;
    }
    // Standard Crockford aliases for human transcription tolerance
    table.O = 0; table.o = 0;
    table.I = 1; table.i = 1;
    table.L = 1; table.l = 1;
    return table;
})();

/** Allocate a fresh ArrayBuffer-backed Uint8Array compatible with Web Crypto BufferSource. */
export function toOwnedBytes(source: Uint8Array): Uint8Array<ArrayBuffer> {
    const copy = new Uint8Array(source.byteLength);
    copy.set(source);
    return copy;
}

/** Generate a fresh 256-bit (32-byte) cryptographically random Vault Master Key. */
export function generateMasterKeyBytes(): Uint8Array<ArrayBuffer> {
    const key = new Uint8Array(MASTER_KEY_BYTES);
    crypto.getRandomValues(key);
    return key;
}

function encodeCrockfordBase32(bytes: Uint8Array): string {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            out += CROCKFORD_ALPHABET[(value >>> bits) & 0x1f];
        }
    }
    if (bits > 0) {
        out += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f];
    }
    return out;
}

function decodeCrockfordBase32(encoded: string, out: Uint8Array): void {
    const expectedByteLength = out.byteLength;
    const expectedChars = Math.ceil((expectedByteLength * 8) / 5);
    if (encoded.length !== expectedChars) {
        throw new OperationError('CLOUD_KEY_INVALID', 'Invalid recovery key length');
    }
    let bits = 0;
    let value = 0;
    let offset = 0;
    for (let i = 0; i < encoded.length; i++) {
        const digit = CROCKFORD_LOOKUP[encoded[i]];
        if (digit === undefined) {
            throw new OperationError('CLOUD_KEY_INVALID', 'Invalid character in recovery key');
        }
        value = (value << 5) | digit;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            if (offset < expectedByteLength) {
                out[offset++] = (value >>> bits) & 0xff;
            }
        }
    }
    const trailingMask = (1 << bits) - 1;
    if (offset !== expectedByteLength || (value & trailingMask) !== 0) {
        throw new OperationError('CLOUD_KEY_INVALID', 'Non-canonical recovery key padding bits');
    }
}

async function computeChecksum(masterKey: Uint8Array): Promise<number> {
    const input = new Uint8Array(CHECKSUM_DOMAIN.byteLength + masterKey.byteLength);
    try {
        input.set(CHECKSUM_DOMAIN);
        input.set(masterKey, CHECKSUM_DOMAIN.byteLength);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
        const checksum = (digest[0] << 8) | digest[1];
        digest.fill(0);
        return checksum;
    } finally {
        input.fill(0);
    }
}

/**
 * Format a 32-byte Master Key as a human-transcribable `GEK1-XXXXX-...` recovery key
 * with a 16-bit SHA-256 domain-separated checksum.
 */
export async function formatRecoveryKey(masterKey: Uint8Array): Promise<string> {
    if (masterKey.byteLength !== MASTER_KEY_BYTES) {
        throw new OperationError('CLOUD_KEY_INVALID', `Master key must be exactly ${MASTER_KEY_BYTES} bytes`);
    }
    const checksum = await computeChecksum(masterKey);
    const combined = new Uint8Array(MASTER_KEY_BYTES + CHECKSUM_BYTES);
    let raw32: string;
    try {
        combined.set(masterKey);
        combined[MASTER_KEY_BYTES] = checksum >>> 8;
        combined[MASTER_KEY_BYTES + 1] = checksum & 0xff;
        raw32 = encodeCrockfordBase32(combined); // 34 bytes = 272 bits -> 55 Base32 chars (11 groups of 5)
    } finally {
        combined.fill(0);
    }
    const groups: string[] = [RECOVERY_KEY_PREFIX];
    for (let i = 0; i < raw32.length; i += 5) {
        groups.push(raw32.slice(i, i + 5));
    }
    return groups.join('-');
}

/**
 * Parse and checksum-verify a `GEK1-...` recovery key back into its 32-byte Master Key.
 */
export async function parseRecoveryKey(input: string): Promise<Uint8Array<ArrayBuffer>> {
    if (typeof input !== 'string') {
        throw new OperationError('CLOUD_KEY_INVALID', 'Recovery key must be a string');
    }
    const compact = input.replace(/[\s-]+/g, '').toUpperCase();
    if (!compact.startsWith(RECOVERY_KEY_PREFIX)) {
        throw new OperationError('CLOUD_KEY_INVALID', 'Unsupported or missing recovery key version prefix');
    }
    const body = compact.slice(RECOVERY_KEY_PREFIX.length);
    const combined = new Uint8Array(MASTER_KEY_BYTES + CHECKSUM_BYTES);
    try {
        decodeCrockfordBase32(body, combined);
        const masterKey = combined.subarray(0, MASTER_KEY_BYTES);
        const actualChecksum = (combined[MASTER_KEY_BYTES] << 8) | combined[MASTER_KEY_BYTES + 1];
        if (actualChecksum !== await computeChecksum(masterKey)) {
            throw new OperationError('CLOUD_KEY_INVALID', 'Recovery key checksum verification failed');
        }
        return masterKey.slice();
    } finally {
        combined.fill(0);
    }
}
