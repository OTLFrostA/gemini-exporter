import { restoreConversationIndex, type DomainConversationIndex } from '../../domain/conversationIndex.js';
import { isTitleSource } from '../../domain/titleAuthority.js';
import { normalizeTimestamp } from '../../domain/time.js';
import { cleanTitle, isRealTitle, isBrandPlaceholderTitle } from '../../utils/titleUtils.js';
import { normId, isReservedRoute } from '../../utils/pathUtils.js';

export type GeminiIndexObservationSource = 'rpc-list' | 'detail' | 'dom';

/** Page observations are source inputs. Local tie-order hints remain outside Domain. */
export interface GeminiIndexObservationInput {
    id?: string;
    title?: string;
    titleSource?: string;
    createdAt?: number;
    updatedAt?: number;
    url?: string;
    messageCount?: number;
    sidebarIndex?: number;
}

/** Current Gemini observations -> Domain Index, without historical field aliases. */
export function parseGeminiIndexObservation(value: unknown, source: GeminiIndexObservationSource): DomainConversationIndex {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Gemini index observation');
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string') throw new TypeError('Index observation has no identity');
    const id = normId(row.id);
    if (!id || id === 'unknown' || isReservedRoute(id)) throw new TypeError('Index observation has invalid identity');
    const provenance = typeof row.titleSource === 'string' && isTitleSource(row.titleSource) && row.titleSource !== 'default'
        ? row.titleSource : 'legacy';
    const candidate = typeof row.title === 'string' ? cleanTitle(row.title) : '';
    const title = isRealTitle(candidate, id) || provenance === 'takeout' && candidate && !isBrandPlaceholderTitle(candidate) ? candidate : '';
    const rawUrl = typeof row.url === 'string' ? row.url : undefined;
    if (rawUrl && /accounts\.google\.com|SignOutOptions/i.test(rawUrl)) throw new TypeError('Not a conversation URL');
    const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://gemini.google.com/app/${encodeURIComponent(id)}`;
    const createdAt = normalizeTimestamp(row.createdAt);
    const updatedAt = normalizeTimestamp(row.updatedAt);
    // List RPC counts are not individual-message observations.
    const messageCount = source !== 'rpc-list' && typeof row.messageCount === 'number' && Number.isSafeInteger(row.messageCount) && row.messageCount >= 0 ? row.messageCount : undefined;
    return restoreConversationIndex({ providerId: 'gemini', id, title, titleSource: title ? provenance : 'default',
        cloudAvailability: source === 'rpc-list' ? 'available' : 'unknown', hasTakeoutImport: row.hasTakeoutImport === true,
        ...(createdAt !== undefined ? { createdAt } : {}), ...(updatedAt !== undefined ? { updatedAt } : {}),
        url, ...(messageCount !== undefined ? { messageCount } : {}) });
}
