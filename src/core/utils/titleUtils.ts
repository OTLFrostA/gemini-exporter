import { compareConversationIndexes, indexActivityTime } from '../domain/conversationIndex.js';
import type { DomainConversationIndex, TitleSource } from '../../types/index.js';
export type { TitleSource };
import { cleanTitle, cleanZeroWidth, isBrandPlaceholderTitle, isRealTitle, resolveDetailTitle } from './titleText.js';
export { cleanTitle, cleanZeroWidth, isBrandPlaceholderTitle, isRealTitle, resolveDetailTitle, RESEARCH_PROMPT_PREFIX_RE, unescapeHtml, stripHtmlTags } from './titleText.js';
import { TITLE_SOURCE_PRIORITY, TITLE_TIER_RANK, normalizeReliableTitleSource, resolveReliableTitleSource } from '../domain/titleAuthority.js';
export { TITLE_SOURCE_PRIORITY, TITLE_TIER_RANK, normalizeReliableTitleSource, resolveReliableTitleSource } from '../domain/titleAuthority.js';

/** Only the fields title arbitration reads or mutates. */
export interface TitleResolutionInput { id?: string | number; title?: string; titleSource?: string; }

export interface TitleResolution {
    title: string;
    source: TitleSource;
}

/**
 * Resolve the most authoritative valid title from a chat object.
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

export default {
    isRealTitle, cleanTitle, cleanZeroWidth, isBrandPlaceholderTitle, resolveTitle,
    resolveDetailTitle, toTimestampMs, getEffectiveTimestamp, compareConversations,
    TITLE_SOURCE_PRIORITY, TITLE_TIER_RANK
};
