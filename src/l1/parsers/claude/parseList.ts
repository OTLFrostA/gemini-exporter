import type { ProviderConversationItem } from '../contracts.js';
import { expectRecord, isUuid } from '../../../shared/utils/typeGuards.js';
import { parseEpochOrIsoTimestamp } from '../shared/time.js';

interface ClaudeListParseResult { conversations: ProviderConversationItem[]; keys: Array<{ id: string; time: number }> }

export function claudeTimestamp(value: unknown): number | undefined {
    return parseEpochOrIsoTimestamp(value);
}

/** Claude's currently observed list endpoint returns an array, not a paginated envelope. */
export function parseClaudeList(raw: unknown): ClaudeListParseResult {
    if (!Array.isArray(raw)) throw new TypeError('Invalid Claude list response');
    const seen = new Set<string>();
    const conversations = raw.map((item: unknown) => {
        const row = expectRecord(item, 'Invalid Claude source record');
        const id = row.uuid;
        if (!isUuid(id) || seen.has(id)) throw new TypeError('Invalid or duplicate Claude conversation UUID');
        seen.add(id);
        const updatedAt = claudeTimestamp(row.updated_at);
        const createdAt = claudeTimestamp(row.created_at);
        if (updatedAt === undefined) throw new TypeError('Claude list is missing source activity time');
        const title = typeof row.name === 'string' ? row.name.trim() : '';
        return { id, ...(title ? { title, titleSource: 'provider' as const } : {}),
            ...(createdAt !== undefined ? { createdAt } : {}), updatedAt };
    });
    // Coverage must use wire order; sorting only normalizes the Domain list.
    const keys = conversations.map(item => ({ id: item.id, time: item.updatedAt }));
    conversations.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { conversations, keys };
}
