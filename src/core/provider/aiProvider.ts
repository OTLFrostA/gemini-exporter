/**
 * src/core/provider/aiProvider.ts
 * Universal AI Provider specification and contract interfaces.
 * Defines the unified lifecycle for authenticating, enumerating,
 * and fetching conversations across heterogeneous AI platforms (Gemini, ChatGPT, Claude, DeepSeek, etc.).
 */
import type { Conversation, ChatMessage, Attachment, TitleSources } from "../../types/conversation.js";

export type {
    Conversation,
    ChatMessage,
    Attachment,
    TitleSources
};

/**
 * Provider-neutral conversation list item.
 * Providers map their platform-specific list payloads into this shape;
 * extra platform fields are allowed via the index signature.
 */
export interface ProviderConversationItem {
    id: string;
    title: string;
    url?: string;
    updatedAt?: number | string | null;
    [key: string]: any;
}

/**
 * Provider-neutral conversation detail.
 * Providers map their platform-specific detail payloads into this shape;
 * extra platform fields are allowed via the index signature.
 */
export interface ProviderConversationDetail {
    id: string;
    title: string;
    messages: ChatMessage[];
    url?: string;
    [key: string]: any;
}

/**
 * Provider-neutral paginated result.
 */
export interface ProviderPageResult<T> {
    items: T[];
    total?: number;
    hasMore?: boolean;
    nextCursor?: string | null;
    stoppedEarly?: boolean;
    diagnostics?: any;
}

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

export interface AIProvider {
    readonly id: string;
    readonly name: string;
    readonly hostPatterns: string[];
    readonly capabilities: ProviderCapabilities;

    // Check if the provider is ready in the current tab/session context
    checkReadiness(context?: any): Promise<ProviderReadiness>;

    // List conversations with pagination, incremental detection, and progress callbacks
    listConversations(options?: any): Promise<ProviderPageResult<ProviderConversationItem>>;

    // Fetch conversation detail normalized to the provider-neutral detail model
    fetchConversationDetail(conversationId: string, options?: any): Promise<ProviderConversationDetail>;

    // Match whether this provider handles a specific URL
    matchesUrl(url: string): boolean;

    // Optional media/asset downloader
    fetchAsset?(url: string, options?: any): Promise<Blob | ArrayBuffer>;
}
