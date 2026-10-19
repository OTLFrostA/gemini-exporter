import type { PageObservation } from '../../domain/pageObservation.js';
import type { ConversationListItem, ListParseResult } from '../../parsers/gemini/rpc/parseList.js';
import type { GeminiListRequestContext } from '../../parsers/gemini/rpc/listRequest.js';

export function geminiListObservation(result: ListParseResult, request: GeminiListRequestContext | null,
    accountId: string | null, truncated = false, requestedAt = 0): PageObservation<ConversationListItem> {
    if (!request || !['recent', 'pinned'].includes(request.streamId)
        || !(request.requestCursor === null || typeof request.requestCursor === 'string')) request = null;
    const { keys, valid: parsedValid, ordered } = result.pageEvidence;
    const providerLimit = !truncated && request?.streamId === 'recent' && request.requestCursor !== null
        && result.failure === 'hit_google_limit' && result.conversations.length === 0;
    const valid = !truncated && (providerLimit || parsedValid && !result.failure);
    return { providerId: 'gemini', accountId, streamId: request?.streamId ?? 'unknown', items: result.conversations,
        requestCursor: request?.requestCursor ?? null, nextCursor: result.nextPageToken,
        requestedAt, requestKnown: request !== null, valid,
        ...(providerLimit ? { terminal: 'provider_limit' as const } : {}),
        ordered: valid && request?.streamId === 'recent' && (providerLimit || ordered), keys };
}
