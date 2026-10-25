/**
 * ChatGPT image-asset resolution, ported from pionxzh/chatgpt-exporter (MIT).
 * Chain: `sediment://<fileId>` -> `GET /backend-api/files/download/:id`
 * -> signed estuary `download_url` -> bytes -> base64 Domain asset.
 * @unverified-provider-scaffold Verified live via 9222 (2.1MB PNG, 2026-10-14).
 */

interface ChatGPTParsedDownload {
    downloadUrl: string;
    fileName?: string;
    byteLength?: number;
    mimeType?: string;
}

/** `sediment://file_abc` -> `file_abc`; non-sediment pointers yield null. */
export function fileIdFromPointer(pointer: string): string | null {
    if (!pointer.startsWith('sediment://')) return null;
    const id = pointer.slice('sediment://'.length);
    return id ? id : null;
}

/** Backend path for the signed-URL exchange. */
export function buildFileDownloadPath(fileId: string): string {
    return `/files/download/${encodeURIComponent(fileId)}`;
}

/** Narrow the files/download payload without ever upgrading unknown data. */
export function parseFileDownloadPayload(value: unknown): ChatGPTParsedDownload | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record['status'] !== 'success') return null;
    const downloadUrl = record['download_url'];
    if (typeof downloadUrl !== 'string' || !downloadUrl) return null;
    const parsed: ChatGPTParsedDownload = { downloadUrl };
    if (typeof record['file_name'] === 'string' && record['file_name']) {
        parsed.fileName = record['file_name'];
    }
    if (typeof record['file_size_bytes'] === 'number' && Number.isFinite(record['file_size_bytes'])) {
        parsed.byteLength = Math.round(record['file_size_bytes']);
    }
    if (typeof record['mime_type'] === 'string' && record['mime_type']) {
        parsed.mimeType = record['mime_type'];
    }
    return parsed;
}
