import type { DomainConversationDetail } from '../../../domain/conversationDetail.js';
import type { GeminiNormalizationInput } from './normalizationInput.js';
import {
    normalizeGeminiConversation,
    type GeminiNormalizationOptions,
    type GeminiNormalizationResult,
} from './normalizeConversation.js';

/** Normalize a Domain conversation through canonical rules without accepting legacy turns. */
export function normalizeDomainConversation(
    conversation: DomainConversationDetail,
    options: GeminiNormalizationOptions = {},
): Promise<GeminiNormalizationResult> {
    const input: GeminiNormalizationInput = {
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
        messages: conversation.messages,
    };
    return normalizeGeminiConversation(input, options);
}
