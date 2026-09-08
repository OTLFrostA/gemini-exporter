declare var define: any;
declare function importScripts(...urls: string[]): void;

// Core globals are declared via their own module files (declare global) — do not duplicate here to avoid TS2403
declare var JSZip: any;

// UI workbench globals (mixed UMD / ESM transition, used via typeof checks)
declare var ConversationsStore: any;
declare var ListView: any;
declare var LogView: any;
declare var DialogView: any;
declare var AccountView: any;
declare var ExportController: any;
declare var SyncController: any;
declare var TakeoutController: any;
declare var DirHandleController: any;
declare var TourGuide: any;
declare var BadgeView: any;
declare var PageObserver: any;
declare var MessageRouter: any;
declare var MessageBridge: any;
declare var SyncEngine: any;
declare var DomScraper: any;
declare var AssetFetcher: any;
declare var OptionsInit: any;
declare var OptionsExport: any;
declare var OptionsSync: any;
declare var OptionsTakeout: any;
declare var OptionsSettings: any;
declare var DefaultApiClient: any;
declare var GeminiAPIClient: any;
declare var DefaultTabService: any;
declare var TabService: any;
declare var I18n: any;

