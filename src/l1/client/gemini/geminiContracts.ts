import type { Account } from '../../../l2/accountRegistry.js';
import type { AIProvider } from '../aiProvider.js';
import type { PaginatedDetailResult, GeminiPaginationListClient } from './api/pagination.js';
export interface GeminiProviderClient {
    getConversationList: GeminiPaginationListClient['getConversationList'];
    getConversationDetail(conversationId: string, targetSid?: string | null, account?: Account, signal?: AbortSignal): Promise<PaginatedDetailResult>;
}
export interface GeminiProviderContract extends AIProvider {}
