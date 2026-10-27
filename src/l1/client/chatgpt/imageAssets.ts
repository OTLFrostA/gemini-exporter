/**
 * Adapted from pionxzh/chatgpt-exporter (MIT); signed download URLs are transient.
 */

interface ChatGPTParsedDownload {
    downloadUrl: string;
    fileName?: string;
    byteLength?: number;
    mimeType?: string;
}

export function fileIdFromPointer(pointer: string): string | null {
    if (!pointer.startsWith('sediment://')) return null;
    const id = pointer.slice('sediment://'.length);
    return id ? id : null;
}

export function buildFileDownloadPath(fileId: string): string {
    return `/files/download/${encodeURIComponent(fileId)}`;
}

/** Narrow the files/download payload without ever upgrading unknown data. */
export function parseFileDownloadPayload(value: unknown): ChatGPTParsedDownload | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!('status' in value) || value.status !== 'success') return null;
    const downloadUrl = 'download_url' in value ? value.download_url : undefined;
    if (typeof downloadUrl !== 'string' || !downloadUrl) return null;
    const parsed: ChatGPTParsedDownload = { downloadUrl };
    if ('file_name' in value && typeof value.file_name === 'string' && value.file_name) {
        parsed.fileName = value.file_name;
    }
    if ('file_size_bytes' in value && typeof value.file_size_bytes === 'number' && Number.isFinite(value.file_size_bytes)) {
        parsed.byteLength = Math.round(value.file_size_bytes);
    }
    if ('mime_type' in value && typeof value.mime_type === 'string' && value.mime_type) {
        parsed.mimeType = value.mime_type;
    }
    return parsed;
}
