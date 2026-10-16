import type { DomainConversationIndex } from '../../domain/conversationIndex.js';
import { parseIndexMetadata } from '../shared/parseIndexMetadata.js';
import { chatGPTTimestamp } from './timestamp.js';

export interface ChatGPTListParseResult {
    conversations: DomainConversationIndex[];
    total?: number;
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
        || (page.cursor != null && typeof page.cursor !== 'string')) throw new TypeError('Invalid ChatGPT list page');
    const conversations = page.items.map((value: unknown) => {
        const item = record(value);
        if (typeof item.id !== 'string' || !item.id.trim()
            || (item.title != null && typeof item.title !== 'string')) throw new TypeError('Invalid ChatGPT list item');
        const id = item.id.trim();
        const title = typeof item.title === 'string' ? item.title.trim() : '';
        const createdAt = chatGPTTimestamp(item.create_time);
        const updatedAt = chatGPTTimestamp(item.update_time);
        return parseIndexMetadata({ providerId: 'chatgpt', id, title, titleSource: title ? 'provider' : 'default',
            cloudAvailability: 'available', hasTakeoutImport: false, url: `https://chatgpt.com/c/${encodeURIComponent(id)}`,
            ...(createdAt !== undefined ? { createdAt } : {}), ...(updatedAt !== undefined ? { updatedAt } : {}) });
    });
    return { conversations, ...(typeof page.total === 'number' ? { total: page.total } : {}),
        nextCursor: typeof page.cursor === 'string' ? page.cursor : null };
}
