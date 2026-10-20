import type { Account } from '../../../l2/accountRegistry.js';
import type { AIProvider } from '../aiProvider.js';
import type { PaginatedDetailResult } from './api/pagination.js';
export type GeminiProviderConversationItem = import('../../parsers/gemini/parseIndexObservation.js').GeminiIndexObservationInput & { id: string };
export type GeminiProviderConversationDetail = PaginatedDetailResult;
export type GeminiProviderListOptions = import('../aiProvider.js').ProviderListOptions;

/** The two client operations this adapter actually calls; also permits typed DI. */
export interface GeminiProviderClient {
    getConversationList: import('./api/pagination.js').GeminiPaginationListClient['getConversationList'];
    getConversationDetail(conversationId: string, targetSid?: string | null, account?: Account, signal?: AbortSignal): Promise<PaginatedDetailResult>;
}
export interface GeminiProviderContract extends AIProvider {}
