import { restoreConversationIndex, type DomainConversationIndex } from '../../domain/conversationIndex.js';
import { normalizeTimestamp } from '../../domain/time.js';
import { cleanTitle, isRealTitle, isBrandPlaceholderTitle } from '../../utils/titleUtils.js';
import { isTitleSource, resolveTitle, type TitleCandidate } from '../../domain/titleAuthority.js';
import { normId, isReservedRoute } from '../../utils/pathUtils.js';

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
/** Released disk metadata -> Domain Index. Historical aliases are interpreted only here. */
export function parseLegacyConversationIndex(value: unknown, providerId = 'gemini'): DomainConversationIndex {
    const row = object(value);
    if (typeof row.id !== 'string' && typeof row.id !== 'number') throw new TypeError('Index source has no identity');
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
    const rawUrl = typeof row.url === 'string' ? row.url : typeof row.href === 'string' ? row.href : undefined;
    if (rawUrl && /accounts\.google\.com|SignOutOptions/i.test(rawUrl)) throw new TypeError('Not a conversation URL');
    const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : providerId === 'gemini' ? `https://gemini.google.com/app/${encodeURIComponent(id)}` : undefined;
    const createdAt = legacyTime(row.createdAt);
    const updatedAt = legacyTime(row.updatedAt) ?? legacyTime(row.timestamp) ?? legacyTime(row.chatTime);
    const takeout = row.hasTakeoutImport === true || (row.source === 'takeout' || row.source === 'takeout-import' || row.titleSource === 'takeout' || row.isTakeoutOnly === true || typeof titleSlots.takeout === 'string');
    // Retain recorded availability during migration, without establishing fresh cloud presence.
    const cloudAvailability = (row.cloudAvailability === 'deleted' || row.cloudAvailability === 'unlisted' || row.cloudAvailability === 'available') ? row.cloudAvailability : 'unknown';
    // Historical counts have mixed units and cannot establish individual-message facts.
    return restoreConversationIndex({ providerId, id, title: resolved?.value ?? '', titleSource: resolved?.source ?? 'default',
        cloudAvailability, hasTakeoutImport: !!takeout, ...(createdAt !== undefined ? { createdAt } : {}),
        ...(updatedAt !== undefined ? { updatedAt } : {}),
        ...(url ? { url } : {}) });
}
