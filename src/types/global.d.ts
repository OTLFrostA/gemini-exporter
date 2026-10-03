declare var define: any;
declare function importScripts(...urls: string[]): void;
declare const __EXT_VERSION__: string;

// Core globals are declared via their own module files (declare global) — do not duplicate here to avoid TS2403

declare var GeminiAPIClient: import('../core/api/geminiClient.js').GeminiAPIClient;

// UI workbench globals (mixed UMD / ESM transition, used via typeof checks)
declare var ConversationsStore: import('./ui.js').IConversationsStore;
declare var ListView: import('./ui.js').IListView;
declare var LogView: import('./ui.js').ILogView;
declare var DialogView: import('./ui.js').IDialogView;
declare var AccountView: import('./ui.js').IAccountView;
declare var ExportController: import('./ui.js').ExportControllerContract;
declare var SyncController: import('./ui.js').SyncControllerContract;
declare var TakeoutController: import('./ui.js').TakeoutControllerContract;
declare var DirHandleController: import('./ui.js').DirHandleControllerContract;
declare var TourGuide: import('./ui.js').TourGuideContract;

declare var TabService: import('./utils.js').TabServiceModule;

declare var _WIZ_global_data: Record<string, string> | undefined;
declare var WIZ_global_data: Record<string, string> | undefined;
declare var __WIZ_global_data: Record<string, string> | undefined;

interface Window {
    __gemExporterAborted?: boolean;
    __gemExporterActiveClient?: import('../content/contentContext.js').ActiveClientContract | null;
    __gemExporterContentContext?: import('../content/contentContext.js').ContentContext;
    __gemExporterDeepScanPromise?: Promise<unknown> | null;
    __gemExporterInjected?: boolean;
    __gemExporterDevMode?: boolean;
    __gemExporterVerboseLog?: boolean;
    __gemExporterLogAll?: boolean;
    __gemExporterScrollAll?: (() => void) | null;
    __gemExporterExtractAt?: () => string;
    __gemExporterExtractBl?: () => string;
    __gemExporterEnsureCreds?: () => Promise<unknown>;
    __gemExporterExtractedAt?: string;
    __gemExporterExtractedBl?: string;
    __gemExporterCleanups?: Array<() => void>;
    __gemExporterHistoryHooked?: boolean;
    __gemExporterBridgeListening?: boolean;
    __gemExporterSyncInterval?: unknown;
    __gemExporterTitleObserver?: unknown;
    __gemExporterDebounceTimer?: unknown;
    __gemExporterUrlWatcher?: unknown;
    __gemExporterBl?: string | null;
    __geminiAt?: string;
    _WIZ_global_data?: Record<string, string>;
    WIZ_global_data?: Record<string, string>;
    __WIZ_global_data?: Record<string, string>;
}


