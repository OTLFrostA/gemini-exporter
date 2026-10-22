/**
 * Synthetic ChatGPT backend-api List responses. Keep native field names and
 * optional legacy flags so missing, present and malformed evidence stay
 * distinguishable in parser/provider tests. No Domain or Account facts here.
 */
export interface ChatGPTListFixture {
    items?: readonly unknown[];
    total?: number | null;
    offset?: number;
    limit?: number;
    cursor?: string | null;
    hasMissingConversations?: boolean;
}

export function chatgptList({
    items = [], total, offset, limit, cursor, hasMissingConversations,
}: ChatGPTListFixture = {}) {
    return {
        items: [...items],
        ...(total !== undefined ? { total } : {}),
        ...(offset !== undefined ? { offset } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
        ...(hasMissingConversations !== undefined ? { has_missing_conversations: hasMissingConversations } : {}),
    };
}
