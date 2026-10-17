import type { Account } from '../../domain/accountRegistry.js';
import { mergeConversationPages } from '../../parsers/gemini/rpc/mergePages.js';
import type { SourceConversationParseResult } from '../../parsers/parsingResult.js';
import { getErrorMessage } from '../../utils/errorText.js';
import { isDevMode } from '../../utils/devMode.js';
import { normId } from '../../utils/pathUtils.js';
import type { ListParseResult } from '../../parsers/gemini/rpc/parseList.js';
import type { DetailParseResult } from './detailTypes.js';

export interface GeminiListRequestOptions {
    signal?: AbortSignal | null;
    maxRetries?: number;
    _retried?: boolean;
    _retryCount?: number;
    _overrideAt?: string;
    _overrideBl?: string | null;
}
export interface GeminiDetailRequestOptions extends Omit<GeminiListRequestOptions, '_retried'> {
    account?: Account;
    _retriedXsrf?: boolean;
    detailOnly?: boolean;
    altParams?: boolean;
}
export interface GeminiPaginationListClient {
    getConversationList(pageToken?: string | null, targetSid?: string | null,
        customFilter?: unknown, opts?: GeminiListRequestOptions): Promise<ListParseResult>;
}
export interface GeminiPaginationDetailClient {
    fetchConversationPage(conversationId: string, pageToken?: string | null,
        targetSid?: string | null, opts?: GeminiDetailRequestOptions): Promise<DetailParseResult>;
}
export interface PaginatedDetailResult extends SourceConversationParseResult {
    transport: DetailParseResult['transport'];
}
export interface GeminiClientPaginationModule { getConversationDetail: typeof getConversationDetail }

async function getConversationDetail(client: GeminiPaginationDetailClient, conversationId: string, targetSid?: string | null, account?: Account, signal?: AbortSignal): Promise<PaginatedDetailResult> {
    const pages: DetailParseResult[] = [];
    const seenTokens = new Set<string>();
    let token: string | null = null;
    let truncateReason: 'token_loop' | 'max_turns_page_limit_20' | undefined;
    do {
        signal?.throwIfAborted();
        const page = await client.fetchConversationPage(conversationId, token, targetSid, { account, signal });
        pages.push(page);
        token = page.transport.nextPageToken;
        if (token && seenTokens.has(token)) { truncateReason = 'token_loop'; break; }
        if (token) seenTokens.add(token);
    } while (token && pages.length < 20);
    if (token && !truncateReason) truncateReason = 'max_turns_page_limit_20';
    const first = pages[0];
    if (!first) throw new Error('no data');
    const inner = first.transport.decodedPayload;
    const metadataOnly = !pages.some(page => page.conversation.detail.messages.length) && Array.isArray(inner)
        && inner[0] === null && inner[1] === null && Array.isArray(inner[2])
        && typeof inner[2][0]?.[0] === 'string' && inner[2][0][0].startsWith('c_');
    if (metadataOnly) {
        try {
            const retry = await client.fetchConversationPage(conversationId, null, targetSid, { detailOnly: true, altParams: true, account, signal });
            if (retry.conversation.detail.messages.length) {
                // The retry is a new detail chain; follow its real cursor before claiming completeness.
                pages.splice(0, pages.length, retry);
                seenTokens.clear();
                truncateReason = undefined;
                token = retry.transport.nextPageToken;
                while (token && pages.length < 20) {
                    if (seenTokens.has(token)) { truncateReason = 'token_loop'; break; }
                    seenTokens.add(token);
                    const next = await client.fetchConversationPage(conversationId, token, targetSid, { detailOnly: true, altParams: true, account, signal });
                    pages.push(next);
                    token = next.transport.nextPageToken;
                }
                if (token && !truncateReason) truncateReason = 'max_turns_page_limit_20';
            }
        } catch (error: unknown) {
            signal?.throwIfAborted();
            if (pages.some(page => page.conversation.detail.messages.length)) throw error;
            if (isDevMode()) console.warn('[Gemini Exporter Client] metadata-only retry failed:', getErrorMessage(error));
        }
    }
    const expectedId = normId(conversationId);
    if (pages.some(page => page.conversationId !== expectedId)) throw new TypeError('Detail response identity mismatch');
    const result = mergeConversationPages(pages, truncateReason, !token && pages.some(page => page.conversation.detail.messages.length > 0));
    return { ...result, transport: { ...first.transport, nextPageToken: token } };
}

export { getConversationDetail };
export const GeminiClientPagination: GeminiClientPaginationModule = { getConversationDetail };
export default GeminiClientPagination;
