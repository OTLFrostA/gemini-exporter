import type { ProviderConversationItem } from '../contracts.js';

interface ClaudeListParseResult { conversations: ProviderConversationItem[]; keys: Array<{ id: string; time: number }> }

export function claudeTimestamp(value: unknown): number | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const time = typeof value === 'number' ? (value < 1e11 ? value * 1000 : value) : Date.parse(value);
    return Number.isSafeInteger(time) && time > 0 ? time : undefined;
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Claude source record');
    return value as Record<string, unknown>;
}

/** Claude's currently observed list endpoint returns an array, not a paginated envelope. */
export function parseClaudeList(raw: unknown): ClaudeListParseResult {
    if (!Array.isArray(raw)) throw new TypeError('Invalid Claude list response');
    const seen = new Set<string>();
    const conversations = raw.map(value => {
        const item = object(value);
        const id = item.uuid;
        if (typeof id !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)
            || seen.has(id)) throw new TypeError('Invalid or duplicate Claude conversation UUID');
        seen.add(id);
        const updatedAt = claudeTimestamp(item.updated_at);
        const createdAt = claudeTimestamp(item.created_at);
        if (updatedAt === undefined) throw new TypeError('Claude list is missing source activity time');
        const title = typeof item.name === 'string' ? item.name.trim() : '';
        return { id, ...(title ? { title, titleSource: 'provider' as const } : {}),
            ...(createdAt !== undefined ? { createdAt } : {}), updatedAt };
    });
    // Coverage must use wire order; sorting only normalizes the Domain list.
    const keys = conversations.map(item => ({ id: item.id, time: item.updatedAt }));
    conversations.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { conversations, keys };
}
