import type { ConversationParseResult } from '../parsers/contracts.js';
import type { DomainConversationDetail } from '../domain/conversationDetail.js';
import { restoreConversationIndex, type DomainConversationIndex } from '../domain/conversationIndex.js';
import { cleanTitle, isRealTitle, isBrandPlaceholderTitle } from '../utils/titleUtils.js';
import { normId, isReservedRoute } from '../utils/pathUtils.js';

export type ConversationIngestionSource = 'detail' | 'takeout' | 'snapshot';

/** Project parsed facts into the catalog. No disk aliases, raw source records or message-time inference. */
export function indexFromDetail(detail: DomainConversationDetail, source: ConversationIngestionSource = 'detail'): DomainConversationIndex {
    const id = detail.providerId === 'gemini' ? normId(detail.id) : detail.id.trim();
    if (!id || detail.providerId === 'gemini' && (id === 'unknown' || isReservedRoute(id))) throw new TypeError('Detail has invalid index identity');
    const provenance = detail.titleSource === 'default' ? 'legacy' : detail.titleSource ?? (source === 'takeout' ? 'takeout' : 'legacy');
    const candidate = cleanTitle(detail.title);
    const title = isRealTitle(candidate, id) || provenance === 'takeout' && candidate && !isBrandPlaceholderTitle(candidate) ? candidate : '';
    if (detail.url && /accounts\.google\.com|SignOutOptions/i.test(detail.url)) throw new TypeError('Not a conversation URL');
    const url = detail.url && /^https?:\/\//i.test(detail.url) ? detail.url
        : detail.providerId === 'gemini' ? `https://gemini.google.com/app/${encodeURIComponent(id)}` : undefined;
    return restoreConversationIndex({ providerId: detail.providerId, id, title, titleSource: title ? provenance : 'default',
        cloudAvailability: 'unknown', hasTakeoutImport: source === 'takeout', messageCount: detail.messages.length,
        ...(detail.createdAt !== undefined ? { createdAt: detail.createdAt } : {}), ...(url ? { url } : {}) });
}

/** The capture envelope supplies source activity; Detail and message dates do not own it. */
export function indexFromParsed(result: ConversationParseResult, source: ConversationIngestionSource = 'detail'): DomainConversationIndex {
    return restoreConversationIndex({ ...indexFromDetail(result.conversation, source),
        ...(result.sourceVersion !== undefined ? { updatedAt: result.sourceVersion } : {}) });
}
