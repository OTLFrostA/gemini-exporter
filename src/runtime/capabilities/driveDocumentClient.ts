import { isRecord } from '../../shared/utils/typeGuards.js';
import { isDriveFileId } from '../../shared/types/driveExport.js';
import type { DriveMarkdownDocument } from '../../application/export/renderDriveMarkdown.js';

const API = 'https://www.googleapis.com/drive/v3/';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MARKDOWN_MIME = 'text/markdown';
const FILE_FIELDS = 'id,mimeType,parents,trashed,appProperties';
const MAX_MULTIPART_BYTES = 5 * 1024 * 1024;

export interface DriveUser { permissionId: string; email: string }
export interface DriveDocumentMetadata {
    id: string;
    mimeType: string;
    parents: readonly string[];
    trashed: boolean;
    exportKey: string | null;
    digest: string | null;
}
interface WriteDocument {
    id: string;
    folderId: string;
    exportKey: string;
    digest: string;
    document: DriveMarkdownDocument;
    create: boolean;
}

export class DriveHttpError extends Error {
    constructor(readonly status: number) {
        super('Google Drive HTTP ' + status);
        this.name = 'DriveHttpError';
    }
}

function decodeId(value: unknown): string {
    if (!isRecord(value) || !isDriveFileId(value.id)) throw new TypeError('Invalid Drive file response');
    return value.id;
}

function decodeDocument(value: unknown): DriveDocumentMetadata {
    if (!isRecord(value) || !isDriveFileId(value.id) || typeof value.mimeType !== 'string'
        || typeof value.trashed !== 'boolean' || !Array.isArray(value.parents)
        || !value.parents.every(isDriveFileId)) throw new TypeError('Invalid Drive metadata');
    const properties = isRecord(value.appProperties) ? value.appProperties : {};
    return { id: value.id, mimeType: value.mimeType, trashed: value.trashed,
        parents: value.parents.filter(isDriveFileId),
        exportKey: typeof properties.geExportKey === 'string' ? properties.geExportKey : null,
        digest: typeof properties.geDigest === 'string' ? properties.geDigest : null };
}

export function assertOwnedDocument(file: DriveDocumentMetadata, id: string, folderId: string, exportKey: string): void {
    if (file.id !== id || file.trashed || file.mimeType !== MARKDOWN_MIME
        || file.parents.length !== 1 || file.parents[0] !== folderId || file.exportKey !== exportKey) {
        throw new Error('Drive document no longer belongs to the configured export folder');
    }
}

/** All requests are to fixed Google HTTPS origins, never URLs from conversations.
 * The bearer token stays in the client closure; errors omit response bodies.
 */
export function createDriveDocumentClient(token: string,
    transport: (url: string, init: RequestInit) => Promise<Response> = fetch) {
    const request = async (url: string, init: RequestInit = {}, allowMissing = false): Promise<Response> => {
        const headers = new Headers(init.headers);
        headers.set('Authorization', 'Bearer ' + token);
        const response = await transport(url, { ...init, headers, credentials: 'omit',
            redirect: 'error', signal: AbortSignal.timeout(25000) });
        if (!response.ok && !(allowMissing && response.status === 404)) throw new DriveHttpError(response.status);
        return response;
    };

    return {
        async about(): Promise<DriveUser> {
            const response = await request(API + 'about?fields=user(permissionId,emailAddress)');
            const value: unknown = await response.json();
            if (!isRecord(value) || !isRecord(value.user) || typeof value.user.permissionId !== 'string'
                || !value.user.permissionId || typeof value.user.emailAddress !== 'string'
                || !value.user.emailAddress) throw new TypeError('Missing Drive account identity');
            return { permissionId: value.user.permissionId, email: value.user.emailAddress };
        },
        async createFolder(): Promise<string> {
            const response = await request(API + 'files?fields=id', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'AI Conversations - Gemini Exporter', mimeType: FOLDER_MIME, parents: ['root'] }),
            });
            const value: unknown = await response.json();
            return decodeId(value);
        },
        async generateId(): Promise<string> {
            const response = await request(API + 'files/generateIds?count=1&space=drive&type=files');
            const value: unknown = await response.json();
            if (!isRecord(value) || !Array.isArray(value.ids) || value.ids.length !== 1
                || !isDriveFileId(value.ids[0])) throw new TypeError('Invalid Drive generated ID');
            return value.ids[0];
        },
        async getDocument(id: string): Promise<DriveDocumentMetadata | null> {
            const response = await request(API + 'files/' + encodeURIComponent(id) + '?fields=' + FILE_FIELDS, {}, true);
            if (response.status === 404) return null;
            const value: unknown = await response.json();
            return decodeDocument(value);
        },
        async writeDocument(input: WriteDocument): Promise<void> {
            const { id, folderId, exportKey, digest, document, create } = input;
            const metadata = { name: document.name,
                appProperties: { geExportKey: exportKey, geDigest: digest },
                ...(create ? { id, parents: [folderId], mimeType: MARKDOWN_MIME } : {}) };
            const boundary = 'ge-' + crypto.randomUUID();
            const body = new Blob([
                '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
                JSON.stringify(metadata),
                '\r\n--' + boundary + '\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n',
                document.markdown, '\r\n--' + boundary + '--\r\n',
            ]);
            if (body.size > MAX_MULTIPART_BYTES) throw new Error('Drive document exceeds the MVP 5 MiB upload limit');
            const url = UPLOAD + (create ? '' : '/' + encodeURIComponent(id)) + '?uploadType=multipart&fields=id';
            const response = await request(url, { method: create ? 'POST' : 'PATCH',
                headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
            const value: unknown = await response.json();
            if (decodeId(value) !== id) throw new Error('Drive returned a different file identity');
        },
    };
}
