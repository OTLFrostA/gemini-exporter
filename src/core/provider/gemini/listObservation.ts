import type { PageObservation } from '../../sync/pageObservation.js';
import type { ConversationListItem, ListParseResult } from '../../parsers/gemini/rpc/parseList.js';
import type { GeminiListRequestContext } from '../../parsers/gemini/rpc/listRequest.js';

export function geminiListObservation(result: ListParseResult, request: GeminiListRequestContext | null,
    accountId: string | null, truncated = false, requestedAt = 0): PageObservation<ConversationListItem> {
    if (!request || !['recent', 'pinned'].includes(request.streamId)
        || !(request.requestCursor === null || typeof request.requestCursor === 'string')) request = null;
    const { keys, valid: parsedValid, ordered } = result.pageEvidence;
    const valid = parsedValid && !truncated && !result.failure;
    return { providerId: 'gemini', accountId, streamId: request?.streamId ?? 'unknown', items: result.conversations,
        requestCursor: request?.requestCursor ?? null, nextCursor: result.nextPageToken,
        requestedAt, requestKnown: request !== null, valid,
        ordered: valid && request?.streamId === 'recent' && ordered, keys };
}
