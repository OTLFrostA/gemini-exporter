import type { Account } from '../../domain/accountRegistry.js';
import type {
    AIProvider, ProviderReadiness
} from "../aiProvider.js";
import type { GeminiIndexObservationInput } from '../../parsers/gemini/parseIndexObservation.js';
import type { PaginationOptions, PaginationResult, PaginatedDetailResult } from "../../api/client/pagination.js";

/** Full parser/pagination evidence retained for current Gemini consumers. */
export type GeminiProviderConversationItem = GeminiIndexObservationInput & { id: string };
export type GeminiProviderConversationDetail = PaginatedDetailResult;

export interface GeminiProviderPageResult extends PaginationResult {
    items: GeminiProviderConversationItem[];
    hasMore: boolean;
    nextCursor: null;
    stoppedEarly?: true;
    completionReason: PaginationResult["completionReason"];
}

export interface GeminiProviderReadinessContext {
    accountSlot?: string;
}
export interface GeminiProviderReadiness extends ProviderReadiness {
    accountSlot?: string;
}
export interface GeminiProviderListOptions extends Omit<PaginationOptions, 'onPageBatch' | 'onProgress'> {
    accountId?: string;
    canCommit?: () => boolean;
    onPageBatch?: ((info: { page: number; hasMore: boolean; count: number; scanHead?: import('../../domain/coverageAdmission.js').ScanHead }) => Promise<import('../../api/client/pagination.js').PaginationStopDecision | void>) | null;
    onProgress?: ((info: Omit<import('../../api/client/pagination.js').PaginationProgressInfo, 'batch'>) => void) | null;
}
export interface GeminiProviderDetailOptions {
    targetSid?: string | null;
    slot?: string | null;
}

/** The two client operations this adapter actually calls; also permits typed DI. */
export interface GeminiProviderClient {
    getAllConversations(options?: PaginationOptions): Promise<PaginationResult>;
    getConversationDetail(conversationId: string, targetSid?: string | null, account?: Account): Promise<PaginatedDetailResult>;
}

export interface GeminiProviderContract extends AIProvider {
    checkReadiness: (context?: unknown) => Promise<GeminiProviderReadiness>;
    listConversations: (options?: GeminiProviderListOptions) => Promise<GeminiProviderPageResult>;
    fetchConversationDetail: (conversationId: string, options?: unknown) => Promise<GeminiProviderConversationDetail>;
}
