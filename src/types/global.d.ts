declare var define: any;
declare function importScripts(...urls: string[]): void;
declare const __EXT_VERSION__: string;

// Core globals are declared via their own module files (declare global) — do not duplicate here to avoid TS2403

// P1-099: precise type instead of `any`. geminiClient.ts declares this same
// global in its own `declare global` block as `typeof GeminiAPIClient`; the
// typeof there resolves against this declaration, so it must exist and must
// not be `any` (which would also re-hide typos at every use site).
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

// P1-099: the ~17 `declare var X: any` globals below were dead declarations.
// Every one of them is now either imported as an ES module (PageObserver,
// MessageRouter, MessageBridge, SyncEngine, DomScraper, AssetFetcher),
// referenced only via `(globalThis as any).X` (BadgeView, I18n, Options*),
// declared in its own module's `declare global` (GeminiAPIClient), or never
// referenced at all (DefaultApiClient, DefaultTabService, JSZip — the latter
// is always captured into a local first). Bare-identifier references resolve
// to the real modules now, so the ambient `any`s only hid typos. Removed.
declare var TabService: import('./utils.js').TabServiceModule;

interface Window {
    __gemExporterAborted?: boolean;
    __gemExporterActiveClient?: any;
    __gemExporterContentContext?: any;
    __gemExporterDeepScanPromise?: any;
    __gemExporterInjected?: boolean;
    __gemExporterDevMode?: boolean;
    __gemExporterScrollAll?: any;
    __gemExporterExtractAt?: any;
    __gemExporterExtractBl?: any;
    __gemExporterEnsureCreds?: any;
}


