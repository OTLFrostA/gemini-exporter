import type { ProviderConversationDetail } from '../core/provider/aiProvider.js';
import type { GeminiProviderConversationDetail } from '../core/provider/gemini/geminiContracts.js';
import type { ParserAttachment } from '../core/api/parser/parseDetail.js';
import type { TitleSource, TitleSources } from './conversation.js';

/** DOM observations are not parser/wire diagnostics. */
export interface DomDetailDebug {
    fallbackUsed?: string | null;
    nodeCount?: number;
    htmlLen?: number;
    isNetworkError?: boolean;
    status?: number;
    isNotFound?: boolean;
}

export interface DomDetail extends ProviderConversationDetail {
    messages: Array<ProviderConversationDetail['messages'][number] & {
        images?: ParserAttachment[];
        attachments?: ParserAttachment[];
    }>;
    titleSource?: TitleSource;
    titles?: TitleSources;
    timestamp?: number | null;
    chatTime?: number | null;
    error?: string;
    isDeleted?: boolean;
    _raw?: { htmlLen: number };
    _debug?: DomDetailDebug;
}

/** Acquisition preserves the complete Gemini companion, or the smaller DOM shape. */
export type ContentConversationDetail = GeminiProviderConversationDetail | DomDetail;

/** Only the injected detail operation is promised; no abort/client lifecycle claim. */
export interface DetailClient {
    getConversationDetail(id: string, targetSid?: string | null): Promise<GeminiProviderConversationDetail | null>;
}

export type ProviderEmptyDebug = {
    rawKeys: string[];
    rawPreview: string;
    topPreview: string;
    messagesLen: number | undefined;
    hasRaw: boolean;
    titleSeen: string;
} | { error: string; isDeleted?: true };

export interface DetailFallbackDebug {
    batchexecuteEmptyDebug: ProviderEmptyDebug | null;
    domDebug?: DomDetailDebug | null;
    domHtmlLen?: number | null;
    domError?: string;
    isDeleted?: boolean;
}

export interface DeletedRpcDetail extends ProviderConversationDetail {
    _empty: true;
    isDeleted: true;
    error: string;
    _debug: DetailFallbackDebug;
}

export interface EmptyDomDetail extends Omit<DomDetail, '_debug'> {
    _empty: true;
    isEmpty: boolean;
    isDeleted: boolean;
    error: string;
    _debug: DetailFallbackDebug;
    _debug_dom_empty: true;
}

/** Existing runtime envelope: source discriminates evidence without changing wire layout. */
export type GetConversationDetailResponse =
    | { success: true; source: 'batchexecute'; data: GeminiProviderConversationDetail | DeletedRpcDetail }
    | { success: true; source: 'dom'; data: DomDetail | EmptyDomDetail }
    | { success: false; error: string; ok?: false; _debug?: DetailFallbackDebug };
