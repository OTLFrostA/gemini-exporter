/**
 * src/types/messages.ts
 * Centralized Schema for Chrome extension runtime and tab messages.
 */

import type { Conversation } from './conversation.js';
import type { LiveSaveConfig } from './liveSave.js';

/**
 * P1-092: exact protocol union. Every action below is both sent and handled
 * somewhere in src (verified by grep over action:'x' send sites and
 * msg.action==='x' comparisons). 'startExport' was a ghost entry — no sender,
 * no handler — and is removed.
 */
export type MessageAction =
    | 'syncUpdate'
    | 'scanProgress'
    | 'openOptions'
    | 'getConversationDetail'
    | 'fetchBatch'
    | 'fetchChat'
    | 'cancelExport'
    | 'downloadAssetDirect'
    | 'abortSync'
    | 'deepScan'
    | 'stopDeepScan'
    | 'exportProgress'
    | 'ping'
    | 'openGeminiPage'
    | 'reloadGeminiTab'
    | 'liveSaveViaHandle'
    | 'getScrollContainer'
    | 'getFileBlob'
    | 'getImageBlob';

export interface BaseMessage {
    action: MessageAction;
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

/** P1-093: matches what liveSaveCoordinator actually sends and liveSaveHandler destructures. */
export interface LiveSaveAsset {
    fileName: string;
    subDir?: string;
    base64?: string;
}

export interface LiveSaveViaHandlePayload {
    chat: Conversation;
    safeTitle: string;
    nid: string;
    config?: LiveSaveConfig;
    fileName?: string;
    assets?: LiveSaveAsset[];
}

export interface LiveSaveViaHandleMessage extends BaseMessage {
    action: 'liveSaveViaHandle';
    payload: LiveSaveViaHandlePayload;
    accountSlot?: string;
}

