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
 * Unified predicate: "is this conversation record takeout-derived?"
 *
 * History: this exact 4-condition check used to be copy-pasted inline in four
 * places with drifted semantics —
 *   - conversationsStore.reconcileWithCloud: had an extra `!titles.rpc && !titles.dom` guard
 *   - storageService.reconcileConversations: had the same extra guard
 *   - conversationsStore.hasTakeoutData: wide (titles.takeout alone counts)
 *   - storageService.hasTakeoutData: wide
 * A "hybrid" record whose titles carry BOTH takeout and rpc was therefore
 * judged "not takeout" by the guarded reconciliation paths (and deleted) while
 * the wide hasTakeoutData checks considered it takeout data — the same data
 * was kept by one path and removed by another.
 *
 * Canonical semantics are WIDE: a record counts as takeout as soon as it ever
 * carried takeout data, regardless of later online (rpc/dom) enrichment.
 * Rationale: these predicates guard reconciliation keep-lists, which are
 * adjacent to deletion; the conservative direction is to keep data, not delete
 * it. The `titles.takeout && !titles.rpc && !titles.dom` variant is NOT used
 * here — "the record also has online titles" must not downgrade its
 * takeout-derived status for keep purposes.
 *
 * BEHAVIOR CHANGE (intentional, towards the safe side): on the two previously
 * guarded reconciliation sites, a takeout+rpc hybrid record now evaluates to
 * true (kept); before it evaluated to false (removed by reconcile). Nothing
 * else about deletion semantics changed.
 */
export function isTakeoutConversation(c: any): boolean {
    if (!c) return false;
    return (
        (c as any).source === 'takeout' ||
        c.titleSource === 'takeout' ||
        (c as any).isTakeoutOnly ||
        !!(c.titles && (c.titles as any).takeout)
    );
}

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
    // P1-107: this fallback used to accept ANY non-empty takeout title, even
    // brand placeholders that step 1 explicitly rejected ("Google Gemini" etc.).
    // Apply the same standard as step 1 so the two steps cannot contradict.
    if (chat.titles && chat.titles.takeout) {
        const rawTakeout = cleanTitle(chat.titles.takeout);
        if (rawTakeout && (isRealTitle(rawTakeout, id) || !isBrandPlaceholderTitle(rawTakeout))) {
            return { title: rawTakeout, source: 'takeout' };
        }
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
 * P1-106: normalize the many timestamp shapes seen in the wild (pure-digit
 * epoch strings, ISO strings, Date objects, numbers) into epoch milliseconds.
 * Pure-digit strings are epoch seconds when short (< 1e11) and epoch
 * milliseconds otherwise — previously `new Date("1726358400000")` produced an
 * Invalid Date and the value was silently dropped. Returns null when the
 * value cannot be interpreted as a positive timestamp.
 */
export function toTimestampMs(raw: any): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') {
        // Numbers keep the historical contract: epoch milliseconds as-is
        // (existing tests pin small values like 3000 to mean 3000ms).
        return Number.isFinite(raw) && raw > 0 ? raw : null;
    }
    if (raw instanceof Date) {
        const t = raw.getTime();
        return Number.isFinite(t) && t > 0 ? t : null;
    }
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) return null;
        if (/^\d+(\.\d+)?$/.test(s)) {
            const n = Number(s);
            if (!Number.isFinite(n) || n <= 0) return null;
            // Pure-digit strings: short values are epoch seconds (a 10-digit
            // value as ms would land in 1970), long values are epoch ms.
            return n < 1e11 ? n * 1000 : n;
        }
        const t = new Date(s).getTime();
        return Number.isFinite(t) && t > 0 ? t : null;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Get the authoritative effective timestamp (milliseconds) of a conversation.
 */
export function getEffectiveTimestamp(chat?: Partial<Conversation> | null): number {
    if (!chat || typeof chat !== 'object') return 0;
    const candidates = [chat.updatedAt, chat.timestamp, (chat as any).chatTime, chat.createdAt, (chat as any).lastSeen];
    for (const raw of candidates) {
        const ms = toTimestampMs(raw);
        if (ms !== null) {
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

    // Display recency: a chat the user just interacted with bumps to the top
    // via the client-observed lastActiveAt, without touching the
    // server-authoritative timestamps (SSOT: #403 follow-up). The scan
    // watermark and export-staleness checks keep using getEffectiveTimestamp
    // (server time only); lastActiveAt never feeds them.
    const tsA = Math.max(getEffectiveTimestamp(a), toTimestampMs((a as any)?.lastActiveAt) ?? 0);
    const tsB = Math.max(getEffectiveTimestamp(b), toTimestampMs((b as any)?.lastActiveAt) ?? 0);
    if (tsA !== tsB) return tsB - tsA;

    const idxA = typeof a.sidebarIndex === 'number' ? a.sidebarIndex : 999999;
    const idxB = typeof b.sidebarIndex === 'number' ? b.sidebarIndex : 999999;
    if (idxA !== idxB) return idxA - idxB;

    let lsA = 0;
    if (a.lastSeen) {
        lsA = toTimestampMs(a.lastSeen) ?? 0;
    }
    let lsB = 0;
    if (b.lastSeen) {
        lsB = toTimestampMs(b.lastSeen) ?? 0;
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
        // P1-106: rec timestamps go through the same normalizer so pure-digit
        // epoch strings (e.g. "1726358400000") are not silently dropped.
        const rTs = toTimestampMs(rec.exportedAt) ?? 0;
        const rChatTime = toTimestampMs((rec as any).chatTime) ?? 0;

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
    toTimestampMs,
    getEffectiveTimestamp,
    compareConversations,
    checkIsUpdated,
    TITLE_SOURCE_PRIORITY,
    TITLE_TIER_RANK
};

