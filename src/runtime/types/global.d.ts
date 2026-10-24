declare var define: unknown;
declare function importScripts(...urls: string[]): void;
declare const __EXT_VERSION__: string;

// Core globals are declared via their own module files (declare global) — do not duplicate here to avoid TS2403

declare var GeminiAPIClient: import('../../l1/client/gemini/geminiClient.js').GeminiAPIClient;

declare var _WIZ_global_data: Record<string, string> | undefined;
declare var WIZ_global_data: Record<string, string> | undefined;
declare var __WIZ_global_data: Record<string, string> | undefined;

interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<import('../capabilities/directoryHandle.js').DirectoryHandle>;
    __mitex?: Pick<typeof import('../../l4/format/typst/mathConverter.js'), 'initMitexWasm' | 'isMitexReady' | 'convertMathWithMitex'>;
    __gemExporterAborted?: boolean;
    __gemExporterActiveClient?: import('../content/contentContext.js').ActiveClientContract | null;
    __gemExporterContentContext?: import('../content/contentContext.js').ContentContext;
    __gemExporterDeepScanPromise?: Promise<void> | null;
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

interface HTMLElement {
    __initialRefreshed?: boolean;
}

declare var __gemExporterAborted: boolean | undefined;
