import { OperationError } from '../errors/operationError.js';
import { isRecord } from '../utils/typeGuards.js';
import { toOwnedBytes } from './recoveryKey.js';
import { encodeLengthPrefixedTuple, type VaultKeyring } from './vaultKeys.js';

/** Wire Magic "GES1" (Gemini Exporter Session Secrets v1) — domain-separated from "GEE1". */
const SESSION_MAGIC = new Uint8Array([0x47, 0x45, 0x53, 0x31]);
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
export const MIN_SEALED_SESSION_BYTES = SESSION_MAGIC.byteLength + IV_BYTES + GCM_TAG_BYTES;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface CloudSessionSecrets {
    readonly sessionToken: string;
    readonly accessCode?: string;
}

export interface SessionSecretsAuthContext {
    readonly serverUrl: string;
    readonly ownerSubject: string;
}

function buildSessionAad(context: SessionSecretsAuthContext): Uint8Array<ArrayBuffer> {
    if (!context.serverUrl.trim() || !context.ownerSubject.trim()) {
        throw new OperationError('CLOUD_ENVELOPE_INVALID', 'Session secret AAD requires non-empty serverUrl and ownerSubject');
    }
    return encodeLengthPrefixedTuple(['GES1-SESSION-AAD', context.serverUrl, context.ownerSubject]);
}

/**
 * Encrypt cloud session credentials (`sessionToken` and optional `accessCode`) at rest
 * using the browser-managed non-extractable `payloadKey` with domain-separated AAD.
 */
export async function sealSessionSecrets(
    keyring: Pick<VaultKeyring, 'payloadKey'>,
    secrets: CloudSessionSecrets,
    context: SessionSecretsAuthContext,
): Promise<Uint8Array<ArrayBuffer>> {
    if (!secrets.sessionToken) {
        throw new OperationError('CLOUD_ENVELOPE_INVALID', 'Session token must be non-empty');
    }
    const additionalData = buildSessionAad(context);
    const payload: CloudSessionSecrets = {
        sessionToken: secrets.sessionToken,
        ...(secrets.accessCode ? { accessCode: secrets.accessCode } : {}),
    };
    const plaintext = toOwnedBytes(encoder.encode(JSON.stringify(payload)));
    const iv = new Uint8Array(IV_BYTES);
    crypto.getRandomValues(iv);
    try {
        const ciphertext = new Uint8Array(
            await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv, additionalData, tagLength: GCM_TAG_BYTES * 8 },
                keyring.payloadKey,
                plaintext,
            ),
        );
        const sealed = new Uint8Array(SESSION_MAGIC.byteLength + IV_BYTES + ciphertext.byteLength);
        sealed.set(SESSION_MAGIC, 0);
        sealed.set(iv, SESSION_MAGIC.byteLength);
        sealed.set(ciphertext, SESSION_MAGIC.byteLength + IV_BYTES);
        return sealed;
    } finally {
        plaintext.fill(0);
    }
}

/**
 * Authenticate and decrypt sealed cloud session credentials from IndexedDB.
 */
export async function openSessionSecrets(
    keyring: Pick<VaultKeyring, 'payloadKey'>,
    sealed: Uint8Array,
    context: SessionSecretsAuthContext,
): Promise<CloudSessionSecrets> {
    const additionalData = buildSessionAad(context);
    if (sealed.byteLength < MIN_SEALED_SESSION_BYTES) {
        throw new OperationError('CLOUD_AUTH_REQUIRED', 'Truncated sealed cloud session credentials');
    }
    for (let i = 0; i < SESSION_MAGIC.byteLength; i++) {
        if (sealed[i] !== SESSION_MAGIC[i]) {
            throw new OperationError('CLOUD_AUTH_REQUIRED', 'Unsupported sealed cloud session format');
        }
    }
    const iv = new Uint8Array(IV_BYTES);
    iv.set(sealed.subarray(SESSION_MAGIC.byteLength, SESSION_MAGIC.byteLength + IV_BYTES));
    const ciphertext = new Uint8Array(sealed.byteLength - SESSION_MAGIC.byteLength - IV_BYTES);
    ciphertext.set(sealed.subarray(SESSION_MAGIC.byteLength + IV_BYTES));

    let plaintextBytes: Uint8Array;
    try {
        const buffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData, tagLength: GCM_TAG_BYTES * 8 },
            keyring.payloadKey,
            ciphertext,
        );
        plaintextBytes = new Uint8Array(buffer);
    } catch (error) {
        throw new OperationError('CLOUD_AUTH_REQUIRED', 'Failed to decrypt stored cloud session credentials', undefined, { cause: error });
    }
    try {
        const parsed: unknown = JSON.parse(decoder.decode(plaintextBytes));
        if (!isRecord(parsed)
            || typeof parsed.sessionToken !== 'string' || !parsed.sessionToken
            || (parsed.accessCode !== undefined && typeof parsed.accessCode !== 'string')) {
            throw new OperationError('CLOUD_AUTH_REQUIRED', 'Malformed decrypted cloud session credentials');
        }
        return {
            sessionToken: parsed.sessionToken,
            ...(parsed.accessCode ? { accessCode: parsed.accessCode } : {}),
        };
    } catch (error) {
        if (error instanceof OperationError) throw error;
        throw new OperationError('CLOUD_AUTH_REQUIRED', 'Malformed decrypted cloud session credentials', undefined, { cause: error });
    } finally {
        plaintextBytes.fill(0);
    }
}
