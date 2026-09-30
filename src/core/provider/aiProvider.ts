import type { Conversation, ChatMessage, Attachment, TitleSources } from "../../types/conversation.js";

export type {
    Conversation,
    ChatMessage,
    Attachment,
    TitleSources
};

export interface ProviderConversationItem {
    id: string;
    title: string;
    url?: string;
    updatedAt?: number | string | null;
    [key: string]: any;
}

export interface ProviderConversationDetail {
    id: string;
    title: string;
    messages: ChatMessage[];
    url?: string;
    [key: string]: any;
}

export interface ProviderPageResult<T> {
    items: T[];
    total?: number;
    hasMore?: boolean;
    nextCursor?: string | null;
    stoppedEarly?: boolean;
    diagnostics?: any;
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

    checkReadiness(context?: any): Promise<ProviderReadiness>;
    listConversations(options?: any): Promise<ProviderPageResult<ProviderConversationItem>>;
    fetchConversationDetail(conversationId: string, options?: any): Promise<ProviderConversationDetail>;
    matchesUrl(url: string): boolean;
    fetchAsset?(url: string, options?: any): Promise<Blob | ArrayBuffer>;
}
