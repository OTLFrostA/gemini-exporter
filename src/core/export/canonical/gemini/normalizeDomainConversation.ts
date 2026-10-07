import type { LegacyResourceHints } from '../../assets/resourceHints.js';
import { assertDomainClosure } from '../../../domain/closure.js';
import { toCanonicalDomainMessage } from '../../../domain/canonicalInputAdapter.js';
import type { DomainConversationDetail } from '../../../domain/conversationDetail.js';
import {
    normalizeCanonicalConversation,
    type CanonicalNormalizationOptions,
    type CanonicalNormalizationResult,
} from '../normalizeConversation.js';

/** Normalize Domain messages directly through shared canonical message and bundle logic. */
export async function normalizeDomainConversation(
    conversation: DomainConversationDetail,
    options: Omit<CanonicalNormalizationOptions, 'providerId'> & { resourceHints?: LegacyResourceHints } = {},
): Promise<CanonicalNormalizationResult> {
    assertDomainClosure(conversation);
    const assets = new Map(conversation.assets.map(asset => [asset.id, asset]));
    const metadata = {
        id: conversation.id,
        title: conversation.title,
        titleSource: conversation.titleSource,
        titles: conversation.titles,
        timestamp: conversation.timestamp,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        chatTime: conversation.chatTime,
        lastSeen: conversation.lastSeen,
        url: conversation.url,
        href: conversation.href,
    };
    const messages = conversation.messages.map((message, index) =>
        toCanonicalDomainMessage(message, `messages[${index}]`, assets, options.resourceHints));
    return normalizeCanonicalConversation(metadata, messages, { ...options, providerId: conversation.providerId });
}
