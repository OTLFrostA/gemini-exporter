/**
 * src/core/utils/titleUtils.ts
 * Conversation title arbitration, sanitization, and priority ordering.
 */

import type { Conversation } from '../../types/index.js';
import { normId } from './pathUtils.js';

export interface TitleResolution {
    title: string;
    source: string;
}

const RESEARCH_PROMPT_PREFIX_RE = /^(?:我已经完成了研究|我拟定了一个研究方案|I've completed your research|Here is a research plan)/i;

export const TITLE_SOURCE_PRIORITY: string[] = ['rpc', 'dom', 'takeout', 'sniff', 'legacy', 'default'];

export const TITLE_TIER_RANK: Record<string, number> = {
    rpc: 50,
    dom: 40,
    takeout: 30,
    sniff: 20,
    legacy: 10,
    default: 0
};

/**
 * Strips zero-width characters and standard whitespace.
 */
export function cleanZeroWidth(t: any): string {
    return String(t || '').replace(/[\u200E\u200B\uFEFF\u00A0]/g, '').trim();
}

/**
 * Checks if a title is an empty, generic brand placeholder or system account string.
 */
export function isBrandPlaceholderTitle(t: any): boolean {
    if (!t) return true;
    return /^(Google\s+)?(Gemini|Bard|Google\s+AI|Google\s+Account)$/i.test(cleanZeroWidth(t));
}

/**
 * Determine if a title is a real, meaningful conversation title
 * (not a placeholder, ID, or auto-generated default).
 */
export function isRealTitle(title?: string | null, id?: string | number): boolean {
    if (!title || typeof title !== 'string') return false;
    let t = title.trim();
    if (!t || t.length < 2) return false;
    if (t === 'Untitled' || t === '未命名' || t === 'New chat' || t === '新对话') return false;
    if (id) {
        let cleanId = normId(id);
        let cleanT = normId(t);
        if (cleanT === cleanId) return false;
        if (cleanT.startsWith('未命名对话(') || cleanT.startsWith('Untitled(')) return false;
        if (cleanT === 'c_' + cleanId || cleanId === 'c_' + cleanT) return false;
    }
    if (/^(未命名对话|Untitled conversation|Untitled|Document|Gemini|Google Gemini|Bard|Google Bard|Google AI|New chat|新对话|Search|搜索)$/i.test(t)) return false;
    if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(t)) return false;
    if (/^(Google Account|Sign in|Sign-in|Sign in with Google|登录|重新登录)/i.test(t)) return false;
    if (/^[a-f0-9_-]{8,64}$/i.test(t)) return false;
    if (/^[0-9a-f]{16}$/i.test(t) || /^c_[0-9a-f]{16}$/i.test(t)) return false;
    if (RESEARCH_PROMPT_PREFIX_RE.test(t)) return false;
    return true;
}

/**
 * Decodes standard HTML entities into plain characters.
 */
export function unescapeHtml(text?: string | null): string {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

/**
 * Strips HTML tags recursively to ensure safe plain text output.
 */
export function stripHtmlTags(html?: string | null): string {
    if (!html || typeof html !== 'string') return '';
    let res = html;
    let prev = '';
    while (res !== prev) {
        prev = res;
        res = res
            .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
            .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
            .replace(/<[^>]+>/g, '');
    }
    return res;
}

/**
 * Clean conversation title by removing brand suffixes and prefixes
 */
export function cleanTitle(rawTitle?: string | null): string {
    if (!rawTitle || typeof rawTitle !== 'string') return '';
    let t = rawTitle.replace(/\u00a0/g, ' ').replace(/[\r\n\t]+/g, ' ').trim();
    if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(t)) return '';
    t = t.replace(/\s*[-–—|·•]\s*(Google\s+)?(Gemini|Bard|Google\s+AI).*$/i, '');
    t = t.replace(/^(Google\s+)?(Gemini|Bard|Google\s+AI)\s*[-–—|·•]\s*/i, '');
    t = t.trim();
    if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(t)) return '';
    return t;
}

/**
 * Resolve the most authoritative valid title from a chat object with multi-tier source slots.
 */
export function resolveTitle(chat?: Partial<Conversation> | null): TitleResolution {
    if (!chat) return { title: '未命名对话', source: 'default' };
    const id = chat.id || '';

    // 1. Traverse tiered title slots in priority order
    if (chat.titles && typeof chat.titles === 'object') {
        for (const source of TITLE_SOURCE_PRIORITY) {
            if (source === 'legacy' || source === 'default') continue;
            const raw = chat.titles[source];
            if (!raw) continue;
            const clean = cleanTitle(raw);
            if (clean && (isRealTitle(clean, id) || (source === 'takeout' && !isBrandPlaceholderTitle(clean)))) {
                return { title: clean, source: source };
            }
        }
    }

    // 2. Legacy fallback to chat.title
    const legacyClean = cleanTitle(chat.title);
    if (legacyClean && isRealTitle(legacyClean, id)) {
        return { title: legacyClean, source: chat.titleSource || 'legacy' };
    }

    // 3. Fallback to Takeout Prompt if present in chat.titles
    if (chat.titles && chat.titles.takeout) {
        const rawTakeout = cleanTitle(chat.titles.takeout);
        if (rawTakeout) return { title: rawTakeout, source: 'takeout' };
    }

    return { title: '未命名对话', source: 'default' };
}

/**
 * Set a title into a specific source tier slot without destroying other tiers.
 */
export function setTitleBySource(chat: any, source?: string, rawTitle?: string): TitleResolution {
    if (!chat) return { title: '未命名对话', source: 'default' };
    chat.titles = (chat.titles && typeof chat.titles === 'object') ? chat.titles : {};
    const cleaned = cleanTitle(rawTitle);
    if (cleaned && isRealTitle(cleaned, chat.id)) {
        if (source) chat.titles[source as string] = cleaned;
    } else if (source === 'takeout' && cleaned) {
        if (source) chat.titles[source as string] = cleaned;
    }
    const resolved = resolveTitle(chat);
    chat.title = resolved.title;
    chat.titleSource = resolved.source;
    return resolved;
}

/**
 * Get the authoritative effective timestamp (milliseconds) of a conversation.
 */
export function getEffectiveTimestamp(chat?: Partial<Conversation> | null): number {
    if (!chat || typeof chat !== 'object') return 0;
    const candidates = [chat.updatedAt, chat.timestamp, (chat as any).chatTime, chat.createdAt, (chat as any).lastSeen];
    for (const raw of candidates) {
        if (raw === null || raw === undefined) continue;
        let ms = (typeof raw === 'string') ? new Date(raw).getTime() : Number(raw);
        if (Number.isFinite(ms) && ms > 0) {
            return ms;
        }
    }
    return 0;
}

/**
 * Authoritative conversation comparator for consistent ordering across UI and background sync.
 */
export function compareConversations(a?: any, b?: any): number {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;

    const tsA = getEffectiveTimestamp(a);
    const tsB = getEffectiveTimestamp(b);
    if (tsA !== tsB) return tsB - tsA;

    const idxA = typeof a.sidebarIndex === 'number' ? a.sidebarIndex : 999999;
    const idxB = typeof b.sidebarIndex === 'number' ? b.sidebarIndex : 999999;
    if (idxA !== idxB) return idxA - idxB;

    let lsA = 0;
    if (a.lastSeen) {
        lsA = (typeof a.lastSeen === 'string') ? new Date(a.lastSeen).getTime() : Number(a.lastSeen);
        if (!Number.isFinite(lsA)) lsA = 0;
    }
    let lsB = 0;
    if (b.lastSeen) {
        lsB = (typeof b.lastSeen === 'string') ? new Date(b.lastSeen).getTime() : Number(b.lastSeen);
        if (!Number.isFinite(lsB)) lsB = 0;
    }
    return lsB - lsA;
}

/**
 * Single Source of Truth (SSoT): Check if an exported conversation has subsequent updates.
 * Compares chat effective timestamps and message counts against the export record.
 */
export function checkIsUpdated(c: any, rec?: any): boolean {
    if (!c || !rec) return false;
    try {
        const cTs = getEffectiveTimestamp(c);
        const rTs = rec.exportedAt ? (typeof rec.exportedAt === 'string' ? new Date(rec.exportedAt).getTime() : Number(rec.exportedAt)) : 0;
        const rChatTime = (rec as any).chatTime ? (typeof (rec as any).chatTime === 'string' ? new Date((rec as any).chatTime).getTime() : Number((rec as any).chatTime)) : 0;

        // 1. Timestamp check with a 2000ms grace buffer for clock skew / write latency:
        // If chat timestamp advanced in Gemini past the export time or recorded chat time, it is updated.
        if (cTs > 0 && rTs > 0 && cTs > rTs + 2000) {
            return true;
        }
        if (cTs > 0 && rChatTime > 0 && cTs > rChatTime + 2000) {
            return true;
        }

        // 2. Export freshness lock: if the export finished strictly AFTER the conversation's last activity,
        // the conversation content cannot be newer than the export.
        // Suppress messageCount discrepancies caused by cloud metadata inflating turn slots.
        if (rTs > 0 && cTs > 0 && rTs >= cTs + 2000) {
            return false;
        }

        // 3. Fallback: message count increase when timestamps are absent or contemporaneous
        const curMsgCount = c.messageCount || (Array.isArray(c.messages) ? c.messages.length : 0);
        const recMsgCount = (rec as any).messageCount || 0;
        if (curMsgCount > 0 && recMsgCount > 0 && curMsgCount > recMsgCount) {
            return true;
        }
    } catch {
        /* intentional */
    }
    return false;
}

/**
 * Sniffs conversation title from the first user message if current title is missing or generic.
 */
export function resolveDetailTitle(
    messages: any[] | null | undefined,
    convId?: string | number
): { title: string; source: 'sniff' } | null {
    if (!Array.isArray(messages)) return null;
    const firstUser = messages.find(m => m && m.role === 'user' && m.content && String(m.content).trim());
    if (!firstUser) return null;
    const rawContent = String(firstUser.content).trim().slice(0, 60).replace(/\n+/g, ' ');
    const candidate = cleanTitle(rawContent);
    if (isRealTitle(candidate, convId)) {
        return { title: candidate, source: 'sniff' };
    }
    return null;
}

export default {
    isRealTitle,
    cleanTitle,
    cleanZeroWidth,
    isBrandPlaceholderTitle,
    resolveTitle,
    resolveDetailTitle,
    setTitleBySource,
    getEffectiveTimestamp,
    compareConversations,
    checkIsUpdated,
    TITLE_SOURCE_PRIORITY,
    TITLE_TIER_RANK
};

