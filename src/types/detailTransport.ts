import type { ResourceConversationParseResult } from '../core/parsers/parsingResult.js';
import type { GeminiDomParseResult } from '../core/parsers/gemini/dom/parseConversation.js';
import type { GeminiProviderConversationDetail } from '../core/provider/gemini/geminiContracts.js';

export interface DomDetailDebug {
    fallbackUsed?: string | null; nodeCount?: number; htmlLen?: number;
    isNetworkError?: boolean; status?: number; isNotFound?: boolean;
}
export type DomDetail = GeminiDomParseResult;
export type ContentConversationDetail = ResourceConversationParseResult;
export interface DetailClient {
    getConversationDetail(id: string, targetSid?: string | null): Promise<GeminiProviderConversationDetail | null>;
}
export type ProviderEmptyDebug = {
    rawKeys: string[]; rawPreview: string; topPreview: string;
    messagesLen: number | undefined; hasRaw: boolean; titleSeen: string;
} | { error: string; isDeleted?: true };
export interface DetailFallbackDebug {
    batchexecuteEmptyDebug: ProviderEmptyDebug | null;
    domDebug?: DomDetailDebug | null; domHtmlLen?: number | null; domError?: string; isDeleted?: boolean;
}
/** An acquisition failure is not an empty or fabricated Domain conversation. */
export interface DetailFailure {
    id: string; title?: string; error: string; isDeleted?: boolean;
    _empty?: true; isEmpty?: boolean; _debug_dom_empty?: boolean;
    _debug?: DetailFallbackDebug | DomDetailDebug;
}
export type DeletedRpcDetail = DetailFailure;
export type EmptyDomDetail = DetailFailure;
export type GetConversationDetailResponse =
    | { success: true; source: 'batchexecute' | 'dom'; data: ResourceConversationParseResult | DetailFailure }
    | { success: false; error: string; ok?: false; _debug?: DetailFallbackDebug };
