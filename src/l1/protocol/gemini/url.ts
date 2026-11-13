import { normId } from '../../../shared/utils/pathUtils.js';

const RESERVED_ROUTES = new Set([
    'download', 'settings', 'prompts', 'archive', 'trash', 'share',
    'activity', 'help', 'feedback', 'gems', 'explore', 'privacy', 'terms', 'updates', 'faq',
]);

export function isReservedRoute(id?: string | number | null): boolean {
    if (!id) return false;
    const clean = normId(id).toLowerCase();
    return RESERVED_ROUTES.has(clean);
}

export function isGeminiUrl(urlStr?: string | null): boolean {
    if (!urlStr || typeof urlStr !== 'string') return false;
    try {
        const u = new URL(urlStr);
        return u.protocol === 'https:' && u.hostname === 'gemini.google.com';
    } catch {
        return false;
    }
}

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

export function extractConversationIdFromUrl(urlOrPath?: string | null): string | null {
    if (!urlOrPath || typeof urlOrPath !== 'string') return null;
    const m = urlOrPath.match(/\/app\/(?:c_)?([A-Za-z0-9_-]{8,})/i);
    if (!m || !m[1]) return null;
    const cleanId = normId(m[1]);
    return isReservedRoute(cleanId) ? null : cleanId;
}
