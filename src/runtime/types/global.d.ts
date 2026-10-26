declare const __EXT_VERSION__: string;

// Core globals are declared via their own module files (declare global) — do not duplicate here to avoid TS2403

declare var GeminiAPIClient: import('../../l1/client/gemini/geminiClient.js').GeminiAPIClient;

declare var _WIZ_global_data: Record<string, string> | undefined;
declare var WIZ_global_data: Record<string, string> | undefined;
declare var __WIZ_global_data: Record<string, string> | undefined;

interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<import('../capabilities/directoryHandle.js').DirectoryHandle>;
    __gemExporterAborted?: boolean;
    __gemExporterActiveClient?: import('../content/contentContext.js').ActiveClientContract | null;
    __gemExporterContentContext?: import('../content/contentContext.js').ContentContext;
    __gemExporterDevMode?: boolean;
    __gemExporterVerboseLog?: boolean;
    __gemExporterLogAll?: boolean;
    __gemExporterExtractAt?: () => string;
    __gemExporterExtractBl?: () => string;
    __gemExporterEnsureCreds?: typeof import('../../l1/client/gemini/bootstrap.js').ensureCreds;
    __gemExporterExtractedAt?: string;
    __gemExporterExtractedBl?: string;
    __gemExporterCleanups?: Array<() => void>;
    __gemExporterHistoryHooked?: boolean;
    __geminiAt?: string;
    _WIZ_global_data?: Record<string, string>;
    WIZ_global_data?: Record<string, string>;
    __WIZ_global_data?: Record<string, string>;
}

declare var __gemExporterAborted: boolean | undefined;
