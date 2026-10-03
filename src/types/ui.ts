import type { Attachment, Conversation, GeneratedMediaIdentity } from './conversation.js';

import type { ConversationExportState, ResolveConversationExportStateOptions } from '../core/utils/titleUtils.js';

export interface ExportRecord {
    exportedAt: number | string;
    title?: string;
    format?: string;
    files?: string[];
    status?: string;
    hasFailedAssets?: boolean;
    messageCount?: number;
    chatTime?: number | string;
}


/** Profile fields written by content bootstrap and synchronization. */
export interface AccountSlotInfo {
    slot?: string;
    accountId?: string;
    gaiaId?: string;
    name?: string;
    email?: string;
    count?: number;
    lastSync?: string;
}
export type AccountSlots = Record<string, AccountSlotInfo>;
export interface ReconcileOptions { keepTakeout?: boolean; }

/** Browser directory capability used by direct writes and permission recovery. */
export interface DirectoryHandle extends FileSystemDirectoryHandle {
    queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export interface ExportSession {
    status?: string;
    slot?: string;
    total?: number;
    current?: number;
    failedCount?: number;
    lastChatTitle?: string;
    updatedAt?: number;
}
export interface FailedChat { id: string; chatId?: string; title?: string; error?: string; }
export interface FailedAttachment {
    chatId: string;
    chatTitle?: string;
    file?: string;
    error?: string;
    sourceUrl?: string;
    sourceEvidence?: unknown;
}
export interface ExportProgress {
    current: number;
    total: number;
    pct: number;
    title: string;
    assetsDownloaded?: number;
    assetsTotal?: number;
}
/** Only the Takeout capabilities used by export, independent of ZIP decoding/index internals. */
export interface TakeoutExportSource {
    getTakeoutOfflineChat(chatId: string, slot?: string | null): Conversation | null;
    getTakeoutMediaForChat(chatId: string, slot?: string | null): Array<{
        filename: string;
        isGenerated?: boolean;
        providerRequestId?: string;
        imageOrdinal?: number;
        generation?: GeneratedMediaIdentity;
    }>;
    getTakeoutFallbackMedia(chatId: string, filenameOrId: string, slot?: string | null,
        generation?: GeneratedMediaIdentity): Promise<Uint8Array | null>;
}
export interface UIExportOptions {
    selected: Array<string | Pick<Conversation, 'id'> & Partial<Conversation>>;
    format?: string;
    useZip?: boolean;
    currentSlot?: string;
    dirHandle?: DirectoryHandle | null;
    skip?: boolean;
    includeIndex?: boolean;
    includeAssets?: boolean;
    conversations?: Conversation[];
    exportedIds?: Record<string, ExportRecord>;
    takeoutEngine?: TakeoutExportSource | null;
    downloadHandler?: (blob: Blob, filename: string) => Promise<void> | void;
}
export interface UIExportCallbacks {
    onProgress?: (progress: ExportProgress) => void;
    onLog?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
    onTitleUpdated?: (id: string, title: string, source?: string) => void;
    onItemExported?: (id: string, record: ExportRecord) => void;
    onItemPendingAssets?: (id: string, count: number) => void;
}
/** Common UI summary. PDF omits attachment counters and skipped count. */
export interface UIExportResult {
    landedChats?: number;
    exportedCount?: number;
    failedChats?: FailedChat[];
    failedAttachments?: FailedAttachment[];
    skipped?: number;
    totalAssets?: number;
    downloadedAssets?: number;
    aborted?: boolean;
}
export interface ActiveExportEngine { abort(): void; dispose?(): void; }
export interface TakeoutImportResult {
    conversations: Conversation[];
    totalMediaCount: number;
}
/** Background/content scan reply projected to the fields consumed by the UI. */
export interface ScanResponse {
    success: boolean;
    count?: number;
    total?: number;
    error?: string;
    hitGoogleLimit?: boolean;
    diagnostics?: { hitGoogleLimit?: boolean; stopReason?: string };
}
export interface ScanCallbacks {
    onStart?: () => void;
    onProgress?: (pct: number, text: string) => void;
    onLog?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
    onFinished?: (result: { count: number; res: ScanResponse; message: string; hitGoogleLimit: boolean }) => void;
    onError?: (err: Error, errMsg?: string, details?: { hitGoogleLimit: boolean; res: ScanResponse | null | undefined }) => void;
}
export interface StopScanCallbacks {
    onStopped?: (result: { message: string }) => void;
    onLog?: ScanCallbacks['onLog'];
}
export interface TourStep {
    id: string;
    getTarget: () => Element | null;
    placement: 'top' | 'bottom' | 'left' | 'right';
    titleKey: string;
    descKey?: string;
    hintKey?: string;
    isDynamicConnect?: boolean;
    isFinal?: boolean;
    setupAction?: (advance: () => void) => (() => void) | undefined;
    spotlightTarget?: () => Element | null;
    spotlightTitleKey?: string;
    spotlightDescKey?: string;
    spotlightHintKey?: string;
    spotlightActionLabelKey?: string;
}

export interface IConversationsStore {
    getConversations: () => Conversation[];
    setConversations: (list: Conversation[]) => void;
    getExportedIds: () => Record<string, ExportRecord>;
    setExportedIds: (map: Record<string, ExportRecord>) => void;
    getCurrentSlot: () => string;
    setCurrentSlot: (slot: string) => void;
    getAccountSlots: () => AccountSlots;
    setAccountSlots: (map: AccountSlots) => void;
    getExportedRecord: (id: string | null | undefined) => ExportRecord | null;
    getSignature: (list?: Conversation[]) => string;
    loadStore: (slotOverride?: string) => Promise<{
        conversations: Conversation[];
        exportedIds: Record<string, ExportRecord>;
        slot: string;
        accountSlots: AccountSlots;
    }>;
    getLastSync: (slot?: string) => Promise<{ timestamp: number | null; count: number }>;
    saveConversations: (slot: string, list: Conversation[]) => Promise<void>;
    clearExported: (slot: string) => Promise<void>;
    clearAll: (slot: string) => Promise<void>;
    getDevMode: () => Promise<boolean>;
    setDevMode: (devOn: boolean) => Promise<void>;
    removeConversation: (id: string) => Promise<Conversation[]>;
    reconcileWithCloud: (activeCloudList: Pick<Conversation, 'id'>[], options?: ReconcileOptions) => Promise<{ kept: number; removed: number; removedIds: string[] }>;
    normalizeAndDeduplicate: (incoming: Conversation[]) => { processed: Conversation[]; hasDirtyTitles: boolean; changedCount: number };
    hasTakeoutData: () => boolean;
    normId: (id: string | null | undefined) => string;
}

export interface IListView {
    render: (conversations: Conversation[], exportedIds: Record<string, ExportRecord>, prevSelectedSet?: Set<string> | null, searchFilter?: string, filterType?: string, failedChatIds?: Set<string>) => void;
    updateStat: (conversations?: Conversation[]) => void;
    getSelected: (conversations?: Conversation[]) => Conversation[];
    getSelectedIds: () => Set<string>;
    selectAll: (conversations?: Conversation[]) => void;
    deselectAll: (conversations?: Conversation[]) => void;
    selectUnexported: (conversations?: Conversation[], exportedIds?: Record<string, ExportRecord>) => void;
    isRealTitle: (title: string, id?: string) => boolean;
    updateItemExportStatus: (chatId: string, exportRecord?: ExportRecord | null) => void;
    selectByIds?: (targetIds: Set<string> | string[], conversations?: Conversation[]) => void;
    checkIsUpdated?: (c: Partial<Conversation> | null | undefined, rec: ExportRecord | null | undefined) => boolean;
    resolveConversationExportState?: (c: Partial<Conversation> | null | undefined, rec?: Partial<ExportRecord> | null, options?: ResolveConversationExportStateOptions) => ConversationExportState;
    setSelectedIds?: (ids: Set<string> | null) => void;
}

export interface IAccountView {
    render: (accountSlots: AccountSlots, currentSlot: string) => void;
}

export interface IDialogView {
    renderExportBanner: (session: ExportSession | null | undefined, currentSlot: string, isRunning: boolean) => void;
    dismissExportBanner: () => void;
    showDirectWritePrompt: (count: number, onConfirmFolder: () => void, onContinueZip: () => void) => void;
    hideDirectWritePrompt: () => void;
    showTakeoutLimitPrompt: (options?: { count?: number; hitGoogleLimit?: boolean; force?: boolean; onImportTakeout?: () => void; onDismiss?: () => void }) => Promise<void>;
    hideTakeoutLimitPrompt: () => void;
    renderExportFailureBanner: (failedList: FailedChat[], onRetry?: () => void) => void;
    hideExportFailureBanner: () => void;
    getLastFailedChats: () => FailedChat[];
    setLastFailedChats?: (list: FailedChat[]) => void;
}

export interface IProgressView {
    show: (initialPct?: number, text?: string) => void;
    update: (pct: number, text?: string) => void;
    complete: (text?: string) => void;
    reset: () => void;
    hide: (delayMs?: number) => void;
}

export interface ILogView {
    init: (elId?: string) => void;
    log: (msg: string, level?: 'info' | 'warn' | 'error') => void;
    clear: () => void;
    render: () => void;
    getBuffer: () => Array<{ time: string; level: string; tag: string; msg: string }>;
}

export interface DirHandleControllerContract {
    saveStoredDirHandle: (handle: DirectoryHandle | null) => Promise<boolean>;
    getStoredDirHandle: () => Promise<DirectoryHandle | null>;
    verifyDirPermission: (handle: DirectoryHandle | null, options?: { allowRequest?: boolean }) => Promise<boolean>;
    restoreSavedDirHandle: () => Promise<DirectoryHandle | null>;
    requestDirHandle: () => Promise<DirectoryHandle>;
    getDirHandle: () => DirectoryHandle | null;
    setDirHandle: (handle: DirectoryHandle | null) => void;
    getPendingPermissionHandle?: () => DirectoryHandle | null;
    reauthorizeDirHandle?: () => Promise<boolean>;
}

export interface TakeoutControllerContract {
    handleTakeoutImport: (file: File, callbacks?: {
        onProgress?: (pct: number, txt: string) => void;
        onLog?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
        onFinished?: (result: { res: TakeoutImportResult; addedCount: number; totalMediaCount: number; message: string }) => void;
        onError?: (err: Error, errMsg?: string) => void;
    }) => Promise<void>;
}

export interface SyncControllerContract {
    isScanning: () => boolean;
    setScanRunning: (running: boolean) => void;
    startIncrementalScan: (slot: string, callbacks?: ScanCallbacks) => void;
    startDeepScan: (slot: string, callbacks?: ScanCallbacks) => void;
    stopScan: (slot: string, callbacks?: StopScanCallbacks) => void;
}

export interface ExportControllerContract {
    setRunning: (running: boolean) => void;
    isRunning: () => boolean;
    getActiveEngine: () => ActiveExportEngine | null;
    runExport: (params: UIExportOptions, callbacks: UIExportCallbacks) => Promise<UIExportResult>;
    abort: () => void;
    estimateMemoryUsage?: (selected: Array<string | Partial<Conversation> & { attachments?: Attachment[] }>, conversations: Conversation[]) => number;
}


export interface TourGuideContract {
    startTour: (stepIndex?: number) => Promise<void>;
    startFeatureSpotlight: (stepId: string, version: string, options?: { onAction?: () => void | Promise<void>; actionLabelKey?: string }) => Promise<void>;
    dismissFeatureSpotlight: () => Promise<void>;
    goToStep: (stepIndex: number) => Promise<void>;
    nextStep: () => Promise<void>;
    prevStep: () => Promise<void>;
    finishTour: () => Promise<void>;
    skipTour: () => Promise<void>;
    isActive: () => boolean;
    getCurrentStep: () => number;
    destroy: () => void;
    clearActionListeners: () => void;
    bindStepAction: (step: TourStep | null | undefined) => void;
    STEPS: TourStep[];
}

export interface OptionsInitOptions {
    onCheckPendingTakeout?: () => Promise<void> | void;
}

export interface OptionsExportOptions {
    loadStore?: (force?: boolean, customSelected?: Set<string>) => Promise<void>;
    log?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
    getSearchFilter?: () => string;
}

export interface OptionsSyncOptions {
    loadStore?: (force?: boolean, customSelected?: Set<string>) => Promise<void>;
    log?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
    maybePromptTakeout?: (count: number, hitLimit: boolean) => Promise<void> | void;
}

export interface OptionsTakeoutOptions {
    loadStore?: (force?: boolean, customSelected?: Set<string>) => Promise<void>;
    log?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
}

export interface OptionsSettingsOptions {
    loadStore?: (force?: boolean, customSelected?: Set<string>) => Promise<void>;
    log?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
    clearLog?: () => void;
    renderLog?: () => void;
    updateZipUi?: () => void;
    checkExportSession?: () => Promise<void> | void;
    updateAccountSlotSelector?: () => void;
    getSearchFilter?: () => string;
    getChatFilterType?: () => string;
}
