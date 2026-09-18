/**
 * Centralized schema for Chrome extension runtime and tab messages.
 */
import type { Conversation } from './conversation.js';
import type { LiveSaveConfig } from './liveSave.js';

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
    LIVE_SAVE_VIA_HANDLE: 'liveSaveViaHandle',
    GET_FILE_BLOB: 'getFileBlob',
    GET_IMAGE_BLOB: 'getImageBlob',
    GET_SCROLL_CONTAINER: 'getScrollContainer',
    CAPTURE_TAB: 'captureTab',
    SCREENSHOT_PREPARE: 'screenshotPrepare',
    SCREENSHOT_SCROLL: 'screenshotScroll',
    SCREENSHOT_RESTORE: 'screenshotRestore'
} as const;

export type MessageAction = typeof MESSAGE_ACTIONS[keyof typeof MESSAGE_ACTIONS];

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
    targetSid?: string;
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

// Payload shapes below were confirmed against the actual senders and handlers
// (see per-interface notes); fields stay optional to match the existing
// BackgroundMessage loose-bag convention.

export interface FetchBatchMessage extends BaseMessage {
    // Sender: src/core/engine/export/batchWorker.ts (~L187: ids/format/
    // skipExported/globalOffset/globalTotal/accountSlot).
    // Handler: src/background/background.ts (~L119) reads the same fields;
    // batchFetcher.fetchBatch(list, format?, skipExported?, ..., globalOffset?,
    // globalTotal?, accountSlot?) gives the per-field types.
    action: 'fetchBatch';
    ids?: (string | { id: string; title?: string; url?: string })[];
    format?: string;
    skipExported?: boolean;
    globalOffset?: number;
    globalTotal?: number;
    accountSlot?: string;
}

export interface AbortSyncMessage extends BaseMessage {
    // Handler: src/background/background.ts (~L158) reads accountSlot and
    // forwards a bare { action: 'abortSync' } to the Gemini tab.
    // Content handler: src/content/messageRouter.ts (~L109) reads no fields.
    // (No UI->background sender exists in src; the handler is kept for compat.)
    action: 'abortSync';
    accountSlot?: string;
}

export interface DeepScanMessage extends BaseMessage {
    // UI sender: src/ui/controllers/syncController.ts (~L57: mode is
    // 'incremental' | 'full', accountSlot).
    // Background (src/background/background.ts ~L176) reads mode/maxIter/
    // accountSlot and forwards { action, maxIter, mode } to the tab
    // (defaults: maxIter 150, mode 'auto').
    // Content handler: src/content/messageRouter.ts (~L77) reads mode === 'full'.
    action: 'deepScan';
    mode?: 'incremental' | 'full' | 'auto';
    maxIter?: number;
    accountSlot?: string;
}

export interface StopDeepScanMessage extends BaseMessage {
    // Sender: src/ui/controllers/syncController.ts (~L105: accountSlot).
    // Handler: src/background/background.ts (~L196) reads accountSlot and
    // forwards a bare { action: 'stopDeepScan' } to the Gemini tab.
    action: 'stopDeepScan';
    accountSlot?: string;
}

export interface PingMessage extends BaseMessage {
    // Sender: src/core/utils/tabService.ts (~L129: bare { action: 'ping' }).
    // Handlers: src/background/background.ts (~L166) and
    // src/content/messageRouter.ts (~L67) read no fields.
    action: 'ping';
}

export interface OpenOptionsMessage extends BaseMessage {
    // Sender: src/content/badgeView.ts (~L111: bare { action: 'openOptions' }).
    // Handler: src/background/background.ts (~L68) reads no fields.
    action: 'openOptions';
}

export interface OpenGeminiPageMessage extends BaseMessage {
    // Sender: src/core/utils/tabService.ts (~L150: bare { action }).
    // Handler: src/background/background.ts (~L74) reads no fields.
    action: 'openGeminiPage';
}

export interface ReloadGeminiTabMessage extends BaseMessage {
    // Sender: src/core/utils/tabService.ts (~L160: { action, tabId? }).
    // Handler: src/background/background.ts (~L81) reads msg.tabId.
    action: 'reloadGeminiTab';
    tabId?: number;
}


