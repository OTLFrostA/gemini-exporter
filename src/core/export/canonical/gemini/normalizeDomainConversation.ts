import type { DomainConversationDetail } from '../../../domain/conversationDetail.js';
import {
    normalizeCanonicalConversation,
    type GeminiNormalizationOptions,
    type GeminiNormalizationResult,
} from './normalizeConversation.js';

/** Normalize Domain messages directly through shared canonical message and bundle logic. */
export async function normalizeDomainConversation(
    conversation: DomainConversationDetail,
    options: GeminiNormalizationOptions = {},
): Promise<GeminiNormalizationResult> {
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
    const messages = conversation.messages.map((message, index) => ({
        message,
        kind: 'domain' as const,
        locator: `messages[${index}]`,
    }));
    return normalizeCanonicalConversation(metadata, messages, options);
}
