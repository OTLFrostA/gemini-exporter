import type { Account } from '../../domain/accountRegistry.js';
import { conversationKey } from '../../domain/conversationKey.js';
import { restoreConversationIndex, type DomainConversationIndex } from '../../domain/conversationIndex.js';
import type { TitleSource } from '../../domain/titleAuthority.js';
import { cleanTitle, isRealTitle, isBrandPlaceholderTitle } from '../../utils/titleUtils.js';
import { normId, isReservedRoute } from '../../utils/pathUtils.js';

export type ConversationIngestionSource = 'detail' | 'takeout' | 'snapshot';
export function semanticTitleSource(source?: string): TitleSource {
    return source === 'user' ? 'user' : ['rpc', 'api-detail', 'dom', 'provider', 'openai'].includes(source ?? '') ? 'provider' : 'derived';
}
export interface ParsedMetadataInput {
    account: Account; providerId: string; id: string; title?: string; titleSource?: string;
    createdAt?: number; updatedAt?: number; url?: string; messageCount?: number;
}
/** Source paths become semantics here. Domain never ranks RPC versus DOM. */
export function parseIndexMetadata(input: ParsedMetadataInput, source: ConversationIngestionSource = 'detail'): DomainConversationIndex {
    if (input.account.providerId !== input.providerId) throw new TypeError('Parser account/provider mismatch');
    const id = input.providerId === 'gemini' ? normId(input.id) : input.id.trim();
    if (!id || input.providerId === 'gemini' && (id === 'unknown' || isReservedRoute(id))) throw new TypeError('Invalid conversation identity');
    const candidate = cleanTitle(input.title);
    const title = !isBrandPlaceholderTitle(candidate) && (isRealTitle(candidate, id) || (input.providerId !== 'gemini' || source === 'takeout' || input.titleSource === 'takeout') && candidate) ? candidate : undefined;
    return restoreConversationIndex({ key: conversationKey(input.account.id, id),
        ...(title ? { title, titleSource: semanticTitleSource(input.titleSource ?? (source === 'takeout' ? 'takeout' : undefined)) } : {}),
        ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}), ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {}) });
}
