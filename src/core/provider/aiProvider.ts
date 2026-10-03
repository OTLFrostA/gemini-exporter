/** Provider-neutral lifecycle and data. Gemini evidence belongs in gemini contracts. */
export interface ProviderConversationItem {
    id: string;
    title: string;
    url?: string;
    createdAt?: number | null;
    updatedAt?: number | null;
    messageCount?: number;
}

export interface ProviderMessage {
    id?: string;
    role: 'user' | 'model' | 'assistant' | 'system';
    content: string;
    timestamp?: number | null;
}

export interface ProviderConversationDetail extends ProviderConversationItem {
    messages: ProviderMessage[];
}

export interface ProviderPageResult<T> {
    items: T[];
    total?: number;
    /** Legacy availability hint; never sufficient evidence for reconciliation. */
    hasMore?: boolean;
    nextCursor?: string | null;
    stoppedEarly?: boolean;
    exhaustive: boolean;
    /** Provider-defined cause; Gemini's exact vocabulary is in its companion. */
    completionReason: string;
}

export interface ProviderPageBatchInfo {
    page: number;
    hasMore: boolean;
}

export interface ProviderStopDecision {
    shouldStop?: boolean;
    reason?: string;
}

export interface ProviderProgressInfo<T = ProviderConversationItem> {
    page: number;
    added: number;
    total: number;
    hasMore: boolean;
    batch?: T[];
    stoppedEarly?: boolean;
    reason?: string;
}

export interface ProviderListOptions<T = ProviderConversationItem> {
    maxPages?: number;
    incremental?: boolean;
    signal?: AbortSignal | null;
    onProgress?: ((info: ProviderProgressInfo<T>) => void) | null;
    onPageBatch?: ((batch: T[], info: ProviderPageBatchInfo) => Promise<ProviderStopDecision | void>) | null;
}

export interface ProviderReadiness {
    ready: boolean;
    accountName?: string;
    error?: string;
}

export interface AIProvider {
    readonly id: string;
    readonly name: string;
    readonly hostPatterns: string[];

    /** Context/detail options are unverified at the neutral seam. */
    checkReadiness: (context?: unknown) => Promise<ProviderReadiness>;
    listConversations: (options?: ProviderListOptions) => Promise<ProviderPageResult<ProviderConversationItem>>;
    fetchConversationDetail: (conversationId: string, options?: unknown) => Promise<ProviderConversationDetail>;
    matchesUrl(url: string): boolean;
    /** @unverified-provider-scaffold No implementation or production caller yet. */
    fetchAsset?(url: string, options?: unknown): Promise<Blob | ArrayBuffer>;
}
