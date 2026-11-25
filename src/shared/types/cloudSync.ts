/**
 * Shared wire DTO contracts between the browser extension and the zero-knowledge Cloud Sync Worker.
 * No plaintext conversation titles, provider IDs, or conversation IDs ever appear in these types.
 */

export const CLOUD_WIRE_MAGIC = [0x47, 0x45, 0x45, 0x31] as const; // "GEE1"
export const CLOUD_MAX_RECORD_BYTES = 2 * 1024 * 1024; // 2 MiB
export const CLOUD_DEFAULT_USER_QUOTA_BYTES = 100 * 1024 * 1024; // 100 MiB

export type CloudVaultBackendType = 'local-folder' | 'cloud-server';

export type CloudAuthKeyMode = 'create' | 'unlock';

export interface CloudAuthKeyRequest {
    readonly keyFingerprint: string;
    readonly authToken: string;
    readonly mode: CloudAuthKeyMode;
    readonly accessCode?: string;
    readonly purgeVerifierHash?: string;
}

export interface CloudAuthSessionResponse {
    readonly sessionToken: string;
    readonly ownerSubject: string;
    readonly expiresAt: number;
}

export interface CloudVaultStatusResponse {
    readonly ownerSubject: string;
    readonly recordCount: number;
    readonly usedBytes: number;
    readonly quotaBytes: number;
    readonly headSeq: number;
    readonly generation?: number;
    /** 32-char hex HKDF fingerprint of the Master Key currently locking this vault, if initialized. */
    readonly keyFingerprint?: string;
}

export interface CloudRecordMeta {
    readonly blindRecordId: string;
    readonly revision: number;
    readonly changeSeq: number;
    readonly byteLength: number;
    readonly sha256: string;
    readonly updatedAt: number;
}

export interface CloudChangesResponse {
    readonly items: readonly CloudRecordMeta[];
    readonly nextSince: number;
    readonly headSeq: number;
    readonly generation?: number;
    readonly hasMore: boolean;
}

export interface CloudErrorResponse {
    readonly error: {
        readonly code:
            | 'UNAUTHORIZED'
            | 'ACCESS_CODE_REQUIRED'
            | 'INVALID_REQUEST'
            | 'PLAINTEXT_REJECTED'
            | 'RECORD_TOO_LARGE'
            | 'QUOTA_EXCEEDED'
            | 'REVISION_CONFLICT'
            | 'KEY_FINGERPRINT_MISMATCH'
            | 'VAULT_NOT_FOUND'
            | 'NOT_FOUND'
            | 'RATE_LIMITED'
            | 'INTERNAL_ERROR';
        readonly message: string;
        readonly currentRevision?: number;
        readonly vaultKeyFingerprint?: string;
    };
}
