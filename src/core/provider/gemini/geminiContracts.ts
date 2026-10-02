import type {
    AIProvider, ProviderReadiness
} from "../aiProvider.js";
import type { ConversationListItem } from "../../api/parser/parseList.js";
import type { PaginationOptions, PaginationResult, PaginatedDetailResult } from "../../api/client/pagination.js";

/** Full parser/pagination evidence retained for current Gemini consumers. */
export type GeminiProviderConversationItem = ConversationListItem;
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
export interface GeminiProviderListOptions extends PaginationOptions {
    /** Content watermark policy, forwarded unchanged; pagination does not read it. */
    forceFull?: boolean;
}
export interface GeminiProviderDetailOptions {
    targetSid?: string | null;
    slot?: string | null;
}

/** The two client operations this adapter actually calls; also permits typed DI. */
export interface GeminiProviderClient {
    getAllConversations(options?: GeminiProviderListOptions): Promise<PaginationResult>;
    getConversationDetail(conversationId: string, targetSid?: string | null): Promise<PaginatedDetailResult>;
}

export interface GeminiProviderContract extends AIProvider {
    checkReadiness(context?: GeminiProviderReadinessContext): Promise<GeminiProviderReadiness>;
    listConversations(options?: GeminiProviderListOptions): Promise<GeminiProviderPageResult>;
    fetchConversationDetail(conversationId: string, options?: GeminiProviderDetailOptions): Promise<GeminiProviderConversationDetail>;
}

/**
 * Temporary application boundary for existing Gemini-dependent content readers.
 * W2-04/05/06/07 must migrate these readers before registry/resolver use AIProvider.
 * This alias does not promise Gemini evidence from future neutral providers.
 */
export type ApplicationProvider = GeminiProviderContract;
