import { restoreConversationIndex, type DomainConversationIndex } from '../../domain/conversationIndex.js';
import { normalizeTimestamp } from '../../domain/time.js';
import { cleanTitle, isRealTitle, isBrandPlaceholderTitle } from '../../utils/titleUtils.js';
import { isTitleSource, resolveTitle, type TitleCandidate } from '../../domain/titleAuthority.js';
import { normId, isReservedRoute } from '../../utils/pathUtils.js';
import type { DomainConversationDetail } from '../../domain/conversationDetail.js';

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid index source record');
    return value as Record<string, unknown>;
}
/** Historical times alone accept seconds-looking numeric strings. Native times never guess units. */
function legacyTime(value: unknown): number | undefined {
    if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
        const number = Number(value);
        return Number.isFinite(number) ? number < 1e11 ? number * 1000 : number : undefined;
    }
    return normalizeTimestamp(value);
}
export type IndexSource = 'legacy' | 'rpc-list' | 'detail' | 'dom' | 'takeout' | 'snapshot' | 'export';
/** Acquisition/migration boundary. Aliases and provenance heuristics stop here. */
export function parseIndexObservation(value: unknown, source: IndexSource, providerId = 'gemini'): DomainConversationIndex {
    const row = object(value);
    if (typeof row.id !== 'string' && !(source === 'legacy' && typeof row.id === 'number')) throw new TypeError('Index source has no identity');
    const id = providerId === 'gemini' ? normId(String(row.id)) : String(row.id).trim();
    if (!id || providerId === 'gemini' && (id === 'unknown' || isReservedRoute(id))) throw new TypeError('Index source has invalid identity');
    const candidates: TitleCandidate[] = [];
    const addTitle = (value: unknown, provenance: string) => {
        if (typeof value !== 'string' || !isTitleSource(provenance) || provenance === 'default') return;
        const title = cleanTitle(value);
        if (isRealTitle(title, id) || provenance === 'takeout' && title && !isBrandPlaceholderTitle(title)) candidates.push({ value: title, source: provenance });
    };
    addTitle(row.title, typeof row.titleSource === 'string' && isTitleSource(row.titleSource) && row.titleSource !== 'default' ? row.titleSource : 'legacy');
    const titleSlots = row.titles && typeof row.titles === 'object' && !Array.isArray(row.titles) ? row.titles as Record<string, unknown> : {};
    for (const [provenance, value] of Object.entries(titleSlots)) addTitle(value, provenance);
    const resolved = resolveTitle(candidates);
    const rawUrl = typeof row.url === 'string' ? row.url : source === 'legacy' && typeof row.href === 'string' ? row.href : undefined;
    if (rawUrl && /accounts\.google\.com|SignOutOptions/i.test(rawUrl)) throw new TypeError('Not a conversation URL');
    const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : providerId === 'gemini' ? `https://gemini.google.com/app/${encodeURIComponent(id)}` : undefined;
    const time = source === 'legacy' ? legacyTime : normalizeTimestamp;
    const createdAt = time(row.createdAt);
    const updatedAt = time(row.updatedAt) ?? (source === 'legacy' ? time(row.timestamp) ?? time(row.chatTime) : undefined);
    const takeout = source === 'takeout' || row.hasTakeoutImport === true || source === 'legacy' && (row.source === 'takeout' || row.source === 'takeout-import' || row.titleSource === 'takeout' || row.isTakeoutOnly === true || typeof titleSlots.takeout === 'string');
    const cloudAvailability = row.cloudAvailability === 'deleted' || row.cloudAvailability === 'unlisted' || row.cloudAvailability === 'available' ? row.cloudAvailability : source === 'rpc-list' || source === 'detail' ? 'available' : 'unknown';
    // Historical/list counts have mixed units. Only known individual-message observations survive.
    const count = (source === 'snapshot' || source === 'detail' || source === 'takeout' || source === 'dom' || source === 'export') && typeof row.messageCount === 'number' && Number.isSafeInteger(row.messageCount) && row.messageCount >= 0 ? row.messageCount : undefined;
    return restoreConversationIndex({ providerId, id, title: resolved?.value ?? '', titleSource: resolved?.source ?? 'default',
        cloudAvailability, hasTakeoutImport: !!takeout, ...(createdAt !== undefined ? { createdAt } : {}),
        ...(updatedAt !== undefined ? { updatedAt } : {}), ...(url ? { url } : {}), ...(count !== undefined ? { messageCount: count } : {}) });
}
export function indexFromDetail(detail: DomainConversationDetail, source: 'detail' | 'takeout' | 'snapshot' = 'detail'): DomainConversationIndex {
    return parseIndexObservation({ id: detail.id, title: detail.title, titleSource: detail.titleSource ?? (source === 'takeout' ? 'takeout' : 'default'),
        createdAt: detail.createdAt, updatedAt: detail.updatedAt, url: detail.url, messageCount: detail.messages.length }, source, detail.providerId);
}

/** Metadata observations authored by page acquisition; order hints stay outside Domain. */
export interface IndexObservationInput {
    id?: string;
    title?: string;
    titleSource?: string;
    createdAt?: number;
    updatedAt?: number;
    url?: string;
    messageCount?: number;
    sidebarIndex?: number;
}
