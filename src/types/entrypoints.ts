import type { MessageAction } from './messages.js';

export interface BackgroundMessage {
    action: MessageAction;
    id?: string;
    conversationId?: string;
    accountId?: string;
    ids?: (string | { id: string; title?: string; url?: string })[];
    format?: string;
    skipExported?: boolean;
    globalOffset?: number;
    globalTotal?: number;
    maxIter?: number;
    tabId?: number;
    percent?: number;
    done?: number;
    total?: number;
    title?: string;
    count?: number;
    windowId?: number;
    payload?: unknown;
}

export interface BackgroundResponse {
    ok?: boolean;
    success?: boolean;
    error?: string;
    details?: string;
    tabId?: number;
    handleName?: string;
    targetFile?: string;
    version?: string;
    ver?: string;
    aborted?: boolean;
    results?: unknown[];
    skipped?: number;
    data?: unknown;
    chat?: unknown;
    dataUrl?: string;
}
