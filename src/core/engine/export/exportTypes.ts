// src/core/engine/export/exportTypes.ts - Shared export pipeline contracts.
// Split out of exportOrchestrator.ts (P1: 1006-line god-file decomposition).
// Dependency direction: every module in core/engine/export may import these
// types; this module imports nothing from the engine (leaf, no cycles).

export interface ExportOptions {
    selected: any[];
    format?: string;
    useZip?: boolean;
    currentSlot?: string;
    dirHandle?: any;
    skip?: boolean;
    includeIndex?: boolean;
    includeAssets?: boolean;
    conversations?: any[];
    exportedIds?: Record<string, any>;
    takeoutEngine?: any;
    downloadHandler?: (blob: Blob, filename: string) => Promise<void> | void;
    [key: string]: any;
}

export interface ExportCallbacks {
    onProgress?: (progress: any) => void;
    onLog?: (msg: string, level?: string) => void;
    onTitleUpdated?: (id: string, title: string, source?: string) => void;
    onItemExported?: (id: string, record: any) => void;
}

export interface ExportResult {
    landedChats: number;
    exportedCount?: number;
    failedChats: any[];
    failedAttachments: any[];
    skipped: number;
    totalAssets: number;
    downloadedAssets: number;
    aborted?: boolean;
}

export interface ExportOrchestratorModule {
    ExportOrchestrator: any;
    AsyncQueue: any;
    ensureSubDir: (root: any, subPath: string) => Promise<any>;
    sanitizeFileName: (name?: string | null, fallback?: string) => string;
    sanitizeZipPath: (p?: string | null) => string;
    getExtensionVersion: () => string;
}

export default {};
