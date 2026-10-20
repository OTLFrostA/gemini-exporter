import type { ProviderConversationItem } from '../contracts.js';
import { chatGPTTimestamp } from './timestamp.js';

export interface ChatGPTListParseResult {
    conversations: ProviderConversationItem[];
    total?: number;
    offset?: number;
    limit?: number;
    hasMissingConversations?: boolean;
    nextCursor: string | null;
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid ChatGPT list payload');
    return value as Record<string, unknown>;
}

/** Backend list metadata -> Domain; pagination controls remain explicit beside business facts. */
export function parseChatGPTList(value: unknown): ChatGPTListParseResult {
    const page = record(value);
    if (!Array.isArray(page.items)
        || (page.total != null && (typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0))
        || (page.cursor != null && typeof page.cursor !== 'string')
        || (page.offset != null && (typeof page.offset !== 'number' || !Number.isSafeInteger(page.offset) || page.offset < 0))
        || (page.limit != null && (typeof page.limit !== 'number' || !Number.isSafeInteger(page.limit) || page.limit <= 0))
        || (page.has_missing_conversations != null && typeof page.has_missing_conversations !== 'boolean')) throw new TypeError('Invalid ChatGPT list page');
    const conversations = page.items.map((value: unknown) => {
        const item = record(value);
        if (typeof item.id !== 'string' || !item.id.trim()
            || (item.title != null && typeof item.title !== 'string')) throw new TypeError('Invalid ChatGPT list item');
        const id = item.id.trim();
        const title = typeof item.title === 'string' ? item.title.trim() : '';
        const createdAt = chatGPTTimestamp(item.create_time);
        const updatedAt = chatGPTTimestamp(item.update_time);
        return { id, ...(title ? { title, titleSource: 'provider' } : {}),
            ...(createdAt !== undefined ? { createdAt } : {}), ...(updatedAt !== undefined ? { updatedAt } : {}) };
    });
    return { conversations, ...(typeof page.total === 'number' ? { total: page.total } : {}),
        ...(typeof page.offset === 'number' ? { offset: page.offset } : {}),
        ...(typeof page.limit === 'number' ? { limit: page.limit } : {}),
        ...(typeof page.has_missing_conversations === 'boolean' ? { hasMissingConversations: page.has_missing_conversations } : {}),
        nextCursor: typeof page.cursor === 'string' ? page.cursor : null };
}
