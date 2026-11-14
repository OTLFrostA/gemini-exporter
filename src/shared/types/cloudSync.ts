/**
 * Shared wire DTO contracts between the browser extension and the zero-knowledge Cloud Sync Worker.
 * No plaintext conversation titles, provider IDs, or conversation IDs ever appear in these types.
 */

export const CLOUD_WIRE_MAGIC = [0x47, 0x45, 0x45, 0x31] as const; // "GEE1"
export const CLOUD_MAX_RECORD_BYTES = 2 * 1024 * 1024; // 2 MiB
export const CLOUD_DEFAULT_USER_QUOTA_BYTES = 100 * 1024 * 1024; // 100 MiB

export interface CloudAuthGoogleRequest {
    readonly idToken: string;
}

export interface CloudAuthSessionResponse {
    readonly sessionToken: string;
    readonly ownerSubject: string;
    readonly expiresAt: number;
    /** Ephemeral display hint extracted from the Google ID token; never persisted by the server. */
    readonly email?: string;
}

export interface CloudVaultStatusResponse {
    readonly ownerSubject: string;
    readonly recordCount: number;
    readonly usedBytes: number;
    readonly quotaBytes: number;
    readonly headSeq: number;
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
    readonly hasMore: boolean;
}

export interface CloudErrorResponse {
    readonly error: {
        readonly code:
            | 'UNAUTHORIZED'
            | 'INVALID_REQUEST'
            | 'PLAINTEXT_REJECTED'
            | 'RECORD_TOO_LARGE'
            | 'QUOTA_EXCEEDED'
            | 'REVISION_CONFLICT'
            | 'NOT_FOUND'
            | 'RATE_LIMITED'
            | 'INTERNAL_ERROR';
        readonly message: string;
        readonly currentRevision?: number;
    };
}
