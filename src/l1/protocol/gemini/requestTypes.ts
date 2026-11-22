export interface GeminiListRequestContext {
    streamId: 'recent' | 'pinned';
    requestCursor: string | null;
}

export interface GeminiDetailRequestContext {
    conversationId: string;
    requestCursor: string | null;
}

export interface GeminiRequestContext {
    list: GeminiListRequestContext | null;
    detail: GeminiDetailRequestContext | null;
    deletionId: string | null;
}
