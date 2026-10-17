import { compareConversationIndexes, indexActivityTime } from '../domain/conversationIndex.js';
import type { DomainConversationIndex, TitleSource } from '../../types/index.js';
export type { TitleSource };
import type { ExportRecord } from '../../types/ui.js';
import { normId } from './pathUtils.js';
import { TITLE_AUTHORITY_RANK, resolveTitle as resolveAuthorityTitle } from '../domain/titleAuthority.js';

/** Only the fields title arbitration reads or mutates. */
export interface TitleResolutionInput { id?: string | number; title?: string; titleSource?: string; titles?: import('../../types/conversation.js').TitleSources; }

/** Export freshness also recognizes historical truncation flags. */
export type ExportActivityRecord = Readonly<Partial<Pick<ExportRecord,
    'exportedAt' | 'chatTime' | 'messageCount' | 'status' | 'hasFailedAssets'
>> & {
    isTruncated?: boolean;
    truncated?: boolean;
}>;

export interface TitleResolution {
    title: string;
    source: TitleSource;
}

export const RESEARCH_PROMPT_PREFIX_RE = /^(?:我已经完成了研究|我拟定了一个研究方案|I've completed your research|Here is a research plan)/i;

export const TITLE_SOURCE_PRIORITY: TitleSource[] = ['user', 'provider', 'derived'];

export const TITLE_TIER_RANK = Object.fromEntries(TITLE_SOURCE_PRIORITY.map(source => [source, TITLE_AUTHORITY_RANK[source]]));

/**
 * Normalizes a raw source string into a canonical, reliable TitleSource.
 * Returns undefined if source is falsy, unknown, or an unreliable fallback
 * tier ('default', 'legacy', 'export').
 */
export function normalizeReliableTitleSource(source?: string | null): TitleSource | undefined {
    if (typeof source !== 'string') return undefined;
    const s = source.trim();
    if (!s || s === 'default' || s === 'legacy' || s === 'export') {
        return undefined;
    }
    return TITLE_SOURCE_PRIORITY.find(candidate => candidate === s);
}

/**
 * Resolves the first reliable TitleSource from candidate sources in priority order.
 * Returns undefined if no candidate provides a reliable source.
 */
export function resolveReliableTitleSource(...sources: (string | null | undefined)[]): TitleSource | undefined {
    for (const src of sources) {
        const normalized = normalizeReliableTitleSource(src);
        if (normalized) return normalized;
    }
    return undefined;
}


export function isTakeoutConversation(c?: Readonly<Partial<DomainConversationIndex>> | null): boolean {
    return false;
}

export function cleanZeroWidth(t: unknown): string {
    return String(t || '').replace(/[\u200E\u200B\uFEFF\u00A0]/g, '').trim();
}

export function isBrandPlaceholderTitle(t: unknown): boolean {
    if (!t) return true;
    return /^(?:(?:Google\s+)?(?:Gemini|Bard|Google\s+AI|Google\s+Account)|New chat|新对话|未命名对话|未命名|Untitled conversation|Untitled Chat|Untitled|Document|Search|搜索)$/i.test(cleanZeroWidth(t));
}

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

export function unescapeHtml(text?: string | null): string {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function removeElementBlocks(input: string, tagName: string): string {
    let current = input;
    const openToken = `<${tagName}`;
    const closeToken = `</${tagName}`;
    let searchFrom = 0;
    while (searchFrom < current.length) {
        const lower = current.toLowerCase();
        const startIdx = lower.indexOf(openToken, searchFrom);
        if (startIdx === -1) break;
        const afterOpen = current.charAt(startIdx + openToken.length);
        if (afterOpen && afterOpen !== '>' && afterOpen !== '/' && !/\s/.test(afterOpen)) {
            searchFrom = startIdx + openToken.length;
            continue;
        }
        const closeStart = lower.indexOf(closeToken, startIdx + openToken.length);
        if (closeStart === -1) {
            current = current.slice(0, startIdx);
            break;
        }
        const closeEnd = current.indexOf('>', closeStart + closeToken.length);
        if (closeEnd === -1) {
            current = current.slice(0, startIdx);
            break;
        }
        current = current.slice(0, startIdx) + current.slice(closeEnd + 1);
        searchFrom = startIdx;
    }
    return current;
}

export function stripHtmlTags(html?: string | null): string {
    if (!html || typeof html !== 'string') return '';
    let res = html;
    let prev = '';
    while (res !== prev) {
        prev = res;
        res = removeElementBlocks(res, 'script');
        res = removeElementBlocks(res, 'style');
        let tagStart = res.indexOf('<');
        while (tagStart !== -1) {
            const tagEnd = res.indexOf('>', tagStart + 1);
            if (tagEnd === -1) break;
            res = res.slice(0, tagStart) + res.slice(tagEnd + 1);
            tagStart = res.indexOf('<');
        }
    }
    return res;
}

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
export function resolveTitle(chat?: TitleResolutionInput | null): TitleResolution {
    return { title: cleanTitle(chat?.title) || '未命名对话', source: normalizeReliableTitleSource(chat?.titleSource) ?? 'derived' };
}

export function toTimestampMs(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') {
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
            return n < 1e11 ? n * 1000 : n;
        }
        const t = new Date(s).getTime();
        return Number.isFinite(t) && t > 0 ? t : null;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** Canonical index facts only; historical conversion belongs to acquisition/migration. */
export function getEffectiveTimestamp(chat?: Readonly<Partial<DomainConversationIndex>> | null): number {
    return chat ? indexActivityTime(chat) ?? 0 : 0;
}
export function compareConversations(a: DomainConversationIndex, b: DomainConversationIndex): number {
    return compareConversationIndexes(a, b);
}

export type ConversationExportStateKind =
    | 'unexported'
    | 'exporting_assets'
    | 'exported_ok'
    | 'exported_partial'
    | 'updated'
    | 'failed';

export interface ConversationBadgeDescriptor {
    kind: 'none' | 'exporting_assets' | 'exported_ok' | 'exported_partial' | 'updated' | 'failed';
    className: string;
    i18nKey: string;
    defaultLabel: string;
    bg: string;
    border: string;
    color: string;
}

export interface ConversationExportState {
    state: ConversationExportStateKind;
    /** True only when conversation activity on server/local advanced past the export record */
    hasNewerActivity: boolean;
    /** True when incremental export (skipExported) should include this conversation, including resource retries */
    needsIncrementalExport: boolean;
    /** Default selection includes new, updated, failed or empty exports, but accepts delivered partial exports */
    shouldAutoSelect: boolean;
    /** True when the conversation failed in the current session or has a partial/failed export record */
    isFailed: boolean;
    /** True when never exported and not failed */
    isUnexported: boolean;
    /** True when exported without failure/partial status */
    isExportedClean: boolean;
    /** Deterministic badge visual & i18n descriptor */
    badge: ConversationBadgeDescriptor;
}

export interface ResolveConversationExportStateOptions {
    isFailedInSession?: boolean;
    customHasNewerActivity?: (c: Readonly<Partial<DomainConversationIndex>> | null | undefined, rec: ExportActivityRecord | null | undefined) => boolean;
}

const BADGE_DESCRIPTORS: Record<ConversationBadgeDescriptor['kind'], ConversationBadgeDescriptor> = {
    none: {
        kind: 'none',
        className: '',
        i18nKey: '',
        defaultLabel: '',
        bg: '',
        border: '',
        color: ''
    },
    exporting_assets: {
        kind: 'exporting_assets',
        className: 'badge badge-exporting-assets',
        i18nKey: 'badgeExportingAssets',
        defaultLabel: 'Exporting assets...',
        bg: 'rgba(59,130,246,0.15)',
        border: 'rgba(59,130,246,0.3)',
        color: '#3b82f6'
    },
    updated: {
        kind: 'updated',
        className: 'badge badge-updated',
        i18nKey: 'badgeUpdated',
        defaultLabel: 'Updated',
        bg: 'rgba(245,158,11,0.15)',
        border: 'rgba(245,158,11,0.35)',
        color: '#f59e0b'
    },
    exported_partial: {
        kind: 'exported_partial',
        className: 'badge badge-exported-partial',
        i18nKey: 'badgeExportedPartial',
        defaultLabel: 'Exported (Partial Assets)',
        bg: 'rgba(234,179,8,0.15)',
        border: 'rgba(234,179,8,0.3)',
        color: '#eab308'
    },
    exported_ok: {
        kind: 'exported_ok',
        className: 'badge badge-exported',
        i18nKey: 'badgeExported',
        defaultLabel: 'Exported',
        bg: 'rgba(16,185,129,0.15)',
        border: 'rgba(16,185,129,0.3)',
        color: '#10b981'
    },
    failed: {
        kind: 'failed',
        className: 'badge badge-failed',
        i18nKey: 'badgeFailed',
        defaultLabel: 'Failed',
        bg: 'rgba(239,68,68,0.15)',
        border: 'rgba(239,68,68,0.3)',
        color: '#ef4444'
    }
};

function computeHasNewerActivity(c: Readonly<Partial<DomainConversationIndex>> | null | undefined, rec: ExportActivityRecord | null | undefined): boolean {
    if (!c || !rec) return false;
    const cTs = c.updatedAt;
    const savedVersion = toTimestampMs(rec.chatTime);
    // Local exportedAt only describes a disk write. It can never suppress a source update.
    if (cTs !== undefined && savedVersion !== null && cTs > savedVersion) return true;
    return false;
}

export function resolveConversationExportState(
    c: Readonly<Partial<DomainConversationIndex>> | null | undefined,
    rec?: ExportActivityRecord | null,
    options?: ResolveConversationExportStateOptions
): ConversationExportState {
    const hasRecord = !!rec;
    const recStatus = rec ? rec.status : undefined;
    const isPendingAssets = !!(rec && recStatus === 'pending_assets');
    const isPartial = !isPendingAssets && !!(rec && (recStatus === 'partial' || !!rec.hasFailedAssets));
    const isRecordFailed = !!(rec && recStatus === 'failed');
    const isFailedInSession = !!options?.isFailedInSession;

    const isFailed = isFailedInSession || isPartial || isRecordFailed;
    const isUnexported = !hasRecord && !isFailed;
    const isExportedClean = hasRecord && !isFailed;

    const activityChecker = options?.customHasNewerActivity || computeHasNewerActivity;
    const hasNewerActivity = hasRecord && !isPendingAssets ? activityChecker(c, rec) : false;

    let state: ConversationExportStateKind;
    let badgeKind: ConversationBadgeDescriptor['kind'];

    if (!hasRecord) {
        state = isFailedInSession ? 'failed' : 'unexported';
        badgeKind = isFailedInSession ? 'failed' : 'none';
    } else if (isPendingAssets) {
        state = 'exporting_assets';
        badgeKind = 'exporting_assets';
    } else if (isRecordFailed || isFailedInSession) {
        state = 'failed';
        badgeKind = 'failed';
    } else if (hasNewerActivity) {
        state = 'updated';
        badgeKind = 'updated';
    } else if (isPartial) {
        state = 'exported_partial';
        badgeKind = 'exported_partial';
    } else {
        state = 'exported_ok';
        badgeKind = 'exported_ok';
    }

    const versionUnknown = hasRecord && (c?.updatedAt === undefined || toTimestampMs(rec?.chatTime) === null);
    const needsIncrementalExport = !hasRecord || isPartial || isRecordFailed || hasNewerActivity || versionUnknown;
    const shouldAutoSelect = !isPendingAssets && (
        !hasRecord || isRecordFailed || recStatus === 'empty' || hasNewerActivity || versionUnknown || (isFailedInSession && !isPartial)
    );

    return {
        state,
        hasNewerActivity,
        needsIncrementalExport,
        shouldAutoSelect,
        isFailed,
        isUnexported,
        isExportedClean,
        badge: BADGE_DESCRIPTORS[badgeKind]
    };
}

export function checkIsUpdated(c: Readonly<Partial<DomainConversationIndex>> | null | undefined, rec?: ExportActivityRecord | null): boolean {
    if (!c || !rec) return false;
    // Partial export records are never considered up-to-date so failed attachments can be retried on subsequent syncs
    const st = resolveConversationExportState(c, rec);
    return st.state === 'exported_partial' || st.hasNewerActivity;
}

export function resolveDetailTitle(
    messages: ({ role?: unknown; content?: unknown } | null | undefined)[] | null | undefined,
    convId?: string | number
): { title: string; source: 'derived' } | null {
    if (!Array.isArray(messages)) return null;
    const firstUser = messages.find(m => m && m.role === 'user' && m.content && String(m.content).trim());
    if (!firstUser) return null;
    const rawContent = String(firstUser.content).trim().slice(0, 60).replace(/\n+/g, ' ');
    const candidate = cleanTitle(rawContent);
    if (isRealTitle(candidate, convId)) {
        return { title: candidate, source: 'derived' };
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
    toTimestampMs,
    getEffectiveTimestamp,
    compareConversations,
    checkIsUpdated,
    resolveConversationExportState,
    TITLE_SOURCE_PRIORITY,
    TITLE_TIER_RANK
};

