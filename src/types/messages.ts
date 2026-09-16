/**
 * src/types/messages.ts
 * Centralized Schema for Chrome extension runtime and tab messages.
 */

import type { Conversation, Attachment } from './conversation.js';

export const MESSAGE_ACTIONS = {
    SYNC_UPDATE: 'syncUpdate',
    SCAN_PROGRESS: 'scanProgress',
    OPEN_OPTIONS: 'openOptions',
    GET_CONVERSATION_DETAIL: 'getConversationDetail',
    FETCH_BATCH: 'fetchBatch',
    FETCH_CHAT: 'fetchChat',
    CANCEL_EXPORT: 'cancelExport',
    DOWNLOAD_ASSET_DIRECT: 'downloadAssetDirect',
    ABORT_SYNC: 'abortSync',
    DEEP_SCAN: 'deepScan',
    STOP_DEEP_SCAN: 'stopDeepScan',
    EXPORT_PROGRESS: 'exportProgress',
    PING: 'ping',
    OPEN_GEMINI_PAGE: 'openGeminiPage',
    RELOAD_GEMINI_TAB: 'reloadGeminiTab',
    START_EXPORT: 'startExport',
    LIVE_SAVE_VIA_HANDLE: 'liveSaveViaHandle',
    GET_FILE_BLOB: 'getFileBlob',
    GET_IMAGE_BLOB: 'getImageBlob',
    GET_SCROLL_CONTAINER: 'getScrollContainer'
} as const;

export type MessageAction = typeof MESSAGE_ACTIONS[keyof typeof MESSAGE_ACTIONS];

export interface BaseMessage {
    action: MessageAction;
    [key: string]: any;
}

export interface SyncUpdateMessage extends BaseMessage {
    action: 'syncUpdate';
    slot: string;
    count?: number;
    from?: string;
    conversations?: Conversation[];
}

export interface ScanProgressMessage extends BaseMessage {
    action: 'scanProgress';
    slot?: string;
    scanned?: number;
    total?: number;
    status?: string;
    stoppedEarly?: boolean;
}

export interface DownloadAssetDirectMessage extends BaseMessage {
    action: 'downloadAssetDirect';
    url: string;
    referer?: string;
    preferBuffer?: boolean;
    timeoutMs?: number;
}

export interface DownloadAssetResponse {
    success: boolean;
    dataBuffer?: ArrayBuffer | ArrayBufferView;
    blobBuffer?: ArrayBuffer | ArrayBufferView;
    dataBase64?: string;
    blobBase64?: string;
    mime?: string;
    contentType?: string;
    size?: number;
    finalUrl?: string;
    error?: string;
}

export interface GetConversationDetailMessage extends BaseMessage {
    action: 'getConversationDetail';
    conversationId: string;
    accountSlot?: string;
}

export interface CancelExportMessage extends BaseMessage {
    action: 'cancelExport';
}

export interface ExportProgressMessage extends BaseMessage {
    action: 'exportProgress';
    pct?: number;
    current?: number;
    total?: number;
    title?: string;
    assetsDownloaded?: number;
    assetsTotal?: number;
}

export interface LiveSaveViaHandlePayload {
    chat: any;
    safeTitle: string;
    nid: string;
    config?: any;
    fileName?: string;
}

export interface LiveSaveViaHandleMessage extends BaseMessage {
    action: 'liveSaveViaHandle';
    payload: LiveSaveViaHandlePayload;
    accountSlot?: string;
}

export interface FetchChatMessage extends BaseMessage {
    action: 'fetchChat';
    conversationId: string;
    accountSlot?: string;
}

export interface GetFileBlobMessage extends BaseMessage {
    action: 'getFileBlob';
    url: string;
    token?: string;
}

export interface GetImageBlobMessage extends BaseMessage {
    action: 'getImageBlob';
    url: string;
}

export interface GetScrollContainerMessage extends BaseMessage {
    action: 'getScrollContainer';
}


