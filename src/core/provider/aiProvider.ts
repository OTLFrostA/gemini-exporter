/**
 * src/core/provider/aiProvider.ts
 * Universal AI Provider specification and contract interfaces.
 * Defines the unified lifecycle for authenticating, enumerating,
 * and fetching conversations across heterogeneous AI platforms (Gemini, ChatGPT, Claude, DeepSeek, etc.).
 */
import type { Conversation, ChatMessage, Attachment, TitleSources } from "../../types/conversation.js";
import type { ConversationListItem } from "../api/parser/parseList.js";
import type { DetailParseResult } from "../api/parser/parseDetail.js";
import type { PaginationOptions, PaginationResult, PaginationProgressInfo } from "../api/client/pagination.js";

export type {
    Conversation,
    ChatMessage,
    Attachment,
    TitleSources,
    ConversationListItem,
    DetailParseResult,
    PaginationOptions,
    PaginationResult,
    PaginationProgressInfo
};

export interface ProviderCapabilities {
    supportsRealtimeSniffing: boolean;
    supportsTakeoutImport: boolean;
    supportsThoughtBlocks: boolean;
    supportsIncrementalSync: boolean;
    supportsMultiAccount: boolean;
}

export interface ProviderReadiness {
    ready: boolean;
    accountSlot?: string;
    accountName?: string;
    error?: string;
}

export interface ProviderListResult {
    conversations: ConversationListItem[];
    total: number;
    stoppedEarly?: boolean;
    hasMore?: boolean;
    nextCursor?: string | null;
    diagnostics?: any;
    [key: string]: any;
}

export interface AIProvider {
    readonly id: string;
    readonly name: string;
    readonly hostPatterns: string[];
    readonly capabilities: ProviderCapabilities;

    // Check if the provider is ready in the current tab/session context
    checkReadiness(context?: any): Promise<ProviderReadiness>;

    // List conversations with pagination, incremental detection, and progress callbacks
    listConversations(options?: PaginationOptions): Promise<PaginationResult | ProviderListResult>;

    // Fetch conversation detail normalized to the standard DetailParseResult / Conversation model
    fetchConversationDetail(conversationId: string, options?: any): Promise<DetailParseResult>;

    // Match whether this provider handles a specific URL
    matchesUrl(url: string): boolean;

    // Optional media/asset downloader
    fetchAsset?(url: string, options?: any): Promise<Blob | ArrayBuffer>;
}
