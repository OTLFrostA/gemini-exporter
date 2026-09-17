/**
 * src/core/utils/pathUtils.ts
 * Path sanitization, file name normalization, and ID routing utilities.
 */

export const RESERVED_ROUTES = new Set([
    'download', 'settings', 'prompts', 'archive', 'trash', 'share',
    'activity', 'help', 'feedback', 'gems', 'explore', 'privacy', 'terms', 'updates', 'faq'
]);

export function normId(id?: string | number | null): string {
    if (!id) return '';
    return String(id).replace(/^c_/, '').trim();
}

export function isReservedRoute(id?: string | number | null): boolean {
    if (!id) return false;
    const clean = normId(id).toLowerCase();
    return RESERVED_ROUTES.has(clean);
}

/**
 * Unified sanitizeFileName - 单一源，70字符上限，防路径穿越与 Windows 保留名
 */
export function sanitizeFileName(name?: string | null, fallback: string = 'untitled'): string {
    if (!name) return fallback;
    let s = String(name).replace(/[\r\n\t\f\v]+/g, ' ').replace(/[\u0000-\u001F\u007F-\u009F]/g, '_');
    // 防路径穿越 ../  ..\  ...
    s = s.replace(/\.\.\//g, '_').replace(/\.\.\\/g, '_');
    s = s.replace(/[<>:"/\\|?*]+/g, '_');
    s = s.replace(/\.{2,}/g, '_');
    s = s.replace(/^\.+|\.+$/g, '');
    s = s.trim();
    if (!s) return fallback;
    let ext = '';
    const lastDot = s.lastIndexOf('.');
    if (lastDot > 0 && s.length - lastDot <= 6) {
        ext = s.slice(lastDot);
        s = s.slice(0, lastDot);
    }
    if (/^(con|prn|aux|nul|com\d{1,2}|lpt\d{1,2})$/i.test(s)) s = s + '_chat';
    if ([...s].length > 70) s = [...s].slice(0, 70).join('').trim();
    s = s.replace(/[\.\s_]+$/g, '').trim();
    if (!s) s = fallback;
    return s + ext;
}

/**
 * Unified sanitizeRelativePath - 单一源，拆分各级相对路径分段清洗，阻断 .. 路径穿越并统一正斜杠
 */
export function sanitizeRelativePath(p?: string | null, defaultName: string = 'file'): string {
    if (!p || typeof p !== 'string') return '';
    const segments = p.split(/[/\\]/).map(seg => {
        let clean = seg.trim();
        if (!clean || clean === '.' || clean === '..') return '_';
        clean = clean.replace(/\.\./g, '_');
        return sanitizeFileName(clean, defaultName);
    }).filter(Boolean);
    return segments.join('/');
}

/**
 * Determine if a given URL belongs to the Gemini web domain.
 */
export function isGeminiUrl(urlStr?: string | null): boolean {
    if (!urlStr || typeof urlStr !== 'string') return false;
    try {
        const u = new URL(urlStr);
        return u.hostname === 'gemini.google.com';
    } catch {
        return false;
    }
}

/**
 * Extract multi-account slot from URL or pathname (e.g. /u/1/app -> u1). Defaults to 'u0'.
 */
export function detectSlotFromUrl(urlOrPath?: string | null): string {
    if (!urlOrPath || typeof urlOrPath !== 'string') return 'u0';
    try {
        const path = urlOrPath.includes('://') ? new URL(urlOrPath).pathname : urlOrPath;
        const m = path.match(/\/u\/(\d+)(?:\/|$)/);
        return m ? `u${m[1]}` : 'u0';
    } catch {
        const m = urlOrPath.match(/\/u\/(\d+)(?:\/|$)/);
        return m ? `u${m[1]}` : 'u0';
    }
}

/**
 * Extract normalized conversation ID from URL or pathname (e.g. /app/c_12345678 -> 12345678).
 * Automatically filters out system reserved routes (settings, prompt, activity, etc.).
 */
export function extractConversationIdFromUrl(urlOrPath?: string | null): string | null {
    if (!urlOrPath || typeof urlOrPath !== 'string') return null;
    const m = urlOrPath.match(/\/app\/(?:c_)?([A-Za-z0-9_-]{8,})/i);
    if (!m || !m[1]) return null;
    const cleanId = normId(m[1]);
    return isReservedRoute(cleanId) ? null : cleanId;
}

/**
 * Generates canonical 6-character short identifier for conversations/documents.
 * Falls back gracefully for shorter IDs or missing inputs.
 */
export function shortId(id?: string | number | null): string {
    const nid = normId(id);
    return nid.length >= 6 ? nid.slice(-6) : (nid || 'chat');
}

/**
 * Generates canonical asset/sub-resource short scope prefix (e.g. "123456_").
 * Returns empty string if no valid ID provided.
 */
export function shortScope(id?: string | number | null): string {
    const nid = normId(id);
    return nid ? `${shortId(nid)}_` : '';
}

/**
 * Unified target export filename generator (e.g. Title_123456.md).
 * Guarantees 100% naming consistency across manual export, batch export, live save, and popup quick export.
 */
export function buildExportFileName(title?: string | null, id?: string | null, ext: string = 'md'): string {
    const safeTitle = sanitizeFileName(title || 'untitled');
    const cid6 = shortId(id);
    let cleanExt = String(ext || '').replace(/^\.+/, '');
    cleanExt = cleanExt.split(/[\\/]/).pop() || '';
    cleanExt = cleanExt.replace(/^\.+|\.+$/g, '').replace(/\.{2,}/g, '.').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!cleanExt) cleanExt = 'md';
    return `${safeTitle}_${cid6}.${cleanExt}`;
}

export function isVersionGreater(v1?: string | null, v2?: string | null): boolean {
    if (!v1) return false;
    if (!v2) return true;
    const p1 = String(v1).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const p2 = String(v2).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const maxLen = Math.max(p1.length, p2.length);
    for (let i = 0; i < maxLen; i++) {
        const num1 = p1[i] || 0;
        const num2 = p2[i] || 0;
        if (num1 > num2) return true;
        if (num1 < num2) return false;
    }
    return false;
}

export function sanitizeFileNameLegacy(name?: string | null, fallback: string = 'untitled'): string {
    if (!name) return fallback;
    let s = String(name).replace(/[\r\n\t\f\v]+/g, ' ').replace(/[\u0000-\u001F\u007F-\u009F]/g, '_');
    s = s.replace(/\.\.\//g, '_').replace(/\.\.\\/g, '_');
    s = s.replace(/[<>:"/\\|?*]+/g, '_');
    s = s.replace(/\.{2,}/g, '_');
    s = s.replace(/^\.+|\.+$/g, '');
    s = s.trim();
    if (!s) return fallback;
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = s + '_chat';
    let ext = '';
    const lastDot = s.lastIndexOf('.');
    if (lastDot > 0 && s.length - lastDot <= 6) {
        ext = s.slice(lastDot);
        s = s.slice(0, lastDot);
    }
    if (s.length > 70) s = s.slice(0, 70).trim();
    s = s.replace(/[\.\s_]+$/g, '').trim();
    if (!s) s = fallback;
    return s + ext;
}

export function buildExportFileNameLegacy(title?: string | null, id?: string | null, ext: string = 'md'): string {
    const safeTitle = sanitizeFileNameLegacy(title || 'untitled');
    const nid = normId(id);
    const cid6 = nid.length >= 6 ? nid.slice(-6) : (nid || 'chat');
    const cleanExt = ext.replace(/^\.+/, '') || 'md';
    return `${safeTitle}_${cid6}.${cleanExt}`;
}

export type FileExistsFn = (name: string) => boolean | Promise<boolean>;

export async function resolveExportFileName(
    title?: string | null,
    id?: string | null,
    ext: string = 'md',
    exists?: FileExistsFn
): Promise<string> {
    const fileName = buildExportFileName(title, id, ext);
    const legacyName = buildExportFileNameLegacy(title, id, ext);
    if (!exists || legacyName === fileName) return fileName;
    try {
        if (await exists(fileName)) return fileName;
    } catch { /* probe failure -> fall through to legacy check */ }
    try {
        if (await exists(legacyName)) return legacyName;
    } catch { /* ignore */ }
    return fileName;
}


export default {
    normId,
    sanitizeFileNameLegacy,
    buildExportFileNameLegacy,
    resolveExportFileName,
    shortId,
    shortScope,
    isReservedRoute,
    RESERVED_ROUTES,
    sanitizeFileName,
    sanitizeRelativePath,
    isGeminiUrl,
    detectSlotFromUrl,
    extractConversationIdFromUrl,
    buildExportFileName,
    isVersionGreater
};

