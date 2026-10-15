import { restoreConversationIndex, type DomainConversationIndex } from '../../domain/conversationIndex.js';
import type { TitleSource } from '../../domain/titleAuthority.js';
import { cleanTitle, isRealTitle, isBrandPlaceholderTitle } from '../../utils/titleUtils.js';
import { normId, isReservedRoute } from '../../utils/pathUtils.js';

export type ConversationIngestionSource = 'detail' | 'takeout' | 'snapshot';
/** Source metadata interpreted while the parser still owns its provenance. */
export interface ParsedMetadataInput {
    providerId: string; id: string; title: string; titleSource?: TitleSource;
    createdAt?: number; updatedAt?: number; url?: string; messageCount?: number;
    cloudAvailability?: DomainConversationIndex['cloudAvailability']; hasTakeoutImport?: boolean;
}
/** Project parsed facts into the catalog. No disk aliases, raw source records or message-time inference. */
export function parseIndexMetadata(detail: ParsedMetadataInput, source: ConversationIngestionSource = 'detail'): DomainConversationIndex {
    const id = detail.providerId === 'gemini' ? normId(detail.id) : detail.id.trim();
    if (!id || detail.providerId === 'gemini' && (id === 'unknown' || isReservedRoute(id))) throw new TypeError('Detail has invalid index identity');
    const provenance = detail.titleSource === 'default' ? 'legacy' : detail.titleSource ?? (source === 'takeout' ? 'takeout' : 'legacy');
    const candidate = cleanTitle(detail.title);
    const title = !isBrandPlaceholderTitle(candidate) && (isRealTitle(candidate, id) || (detail.providerId !== 'gemini' || provenance === 'takeout') && candidate) ? candidate : '';
    if (detail.url && /accounts\.google\.com|SignOutOptions/i.test(detail.url)) throw new TypeError('Not a conversation URL');
    const url = detail.url && /^https?:\/\//i.test(detail.url) ? detail.url
        : detail.providerId === 'gemini' ? `https://gemini.google.com/app/${encodeURIComponent(id)}` : undefined;
    return restoreConversationIndex({ providerId: detail.providerId, id, title, titleSource: title ? provenance : 'default',
        cloudAvailability: detail.cloudAvailability ?? 'unknown', hasTakeoutImport: source === 'takeout' || detail.hasTakeoutImport === true, messageCount: detail.messageCount,
        ...(detail.createdAt !== undefined ? { createdAt: detail.createdAt } : {}), ...(detail.updatedAt !== undefined ? { updatedAt: detail.updatedAt } : {}), ...(url ? { url } : {}) });
}

