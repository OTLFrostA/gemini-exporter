import type { DomainConversationIndex } from '../../src/core/domain/conversationIndex.js';
import type { ListParseResult } from '../../src/core/parsers/gemini/rpc/parseList.js';

/** Pagination unit tests stub the parser seam; they do not establish source ordering evidence. */
export function listFixture(conversations: DomainConversationIndex[] = [], nextPageToken: string | null = null): ListParseResult {
    return { conversations, nextPageToken, pageEvidence: { valid: true, ordered: false,
        keys: conversations.map(item => ({ id: item.id, time: 0 })) } };
}
