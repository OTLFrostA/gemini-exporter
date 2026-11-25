import { isRecord, isUuid } from '../utils/typeGuards.js';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** A single explicitly consented source -> destination binding. No credentials. */
export interface DriveExportConnection {
    sourceAccountId: string;
    destinationPermissionId: string;
    destinationEmail: string;
    folderId: string;
}

export function isDriveFileId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}

/** Storage and content-world settings ingress; malformed bindings fail closed. */
export function readDriveExportConnection(value: unknown): DriveExportConnection | null {
    if (!isRecord(value) || !isUuid(value.sourceAccountId)
        || typeof value.destinationPermissionId !== 'string' || !value.destinationPermissionId
        || typeof value.destinationEmail !== 'string' || !value.destinationEmail
        || !isDriveFileId(value.folderId)) return null;
    return { sourceAccountId: value.sourceAccountId,
        destinationPermissionId: value.destinationPermissionId,
        destinationEmail: value.destinationEmail, folderId: value.folderId };
}
