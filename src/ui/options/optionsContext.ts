// src/ui/options/optionsContext.ts - Centralized workbench dependencies & context accessors
import { ConversationsStore } from '../state/conversationsStore.js';
import { ListView } from '../views/listView.js';
import { DialogView } from '../views/dialogView.js';
import { LogView } from '../views/logView.js';
import { AccountView } from '../views/accountView.js';
import { ExportController } from '../controllers/exportController.js';
import { SyncController } from '../controllers/syncController.js';
import { TakeoutController } from '../controllers/takeoutController.js';
import { DirHandleController } from '../controllers/dirHandleController.js';
import { StorageService } from '../../core/storage/storageService.js';
import { FormatStore } from '../../core/storage/formatStore.js';
import { LiveStorageManager } from '../../core/storage/liveStorageManager.js';
import { GeminiUtils } from '../../core/utils/utils.js';
import { GeminiConstants } from '../../core/utils/constants.js';
import { GeminiProtocol } from '../../core/protocol/protocol.js';
import { ProviderRegistry } from '../../core/provider/providerRegistry.js';
import '../../core/provider/index.js';
import { TabService } from '../../core/utils/tabService.js';
import { TakeoutEngine } from '../../core/engine/takeoutEngine.js';
import { TourGuide } from '../tour/tourGuide.js';
import { FsWriter } from '../../core/engine/writers/fsWriter.js';
import { ChatFormatter } from '../../core/engine/chatFormatter.js';
import { I18n } from '../../core/utils/i18n.js';
import { getI18n as commonGetI18n } from '../uiCommon.js';

export const getI18n = () => commonGetI18n() || I18n;
export const t = (key: string, ...args: any[]): string => {
    const i18n = getI18n();
    return i18n && typeof i18n.t === 'function' ? i18n.t(key, ...args) : key;
};
export const getLang = (): string => {
    const i18n = getI18n();
    return i18n && typeof i18n.getLang === 'function' ? i18n.getLang() : 'en';
};

export const getStore = () => (typeof (globalThis as any).ConversationsStore !== 'undefined' ? (globalThis as any).ConversationsStore : ConversationsStore);
export const getList = () => (typeof (globalThis as any).ListView !== 'undefined' ? (globalThis as any).ListView : ListView);
export const getDialogs = () => (typeof (globalThis as any).DialogView !== 'undefined' ? (globalThis as any).DialogView : DialogView);
export const getLogView = () => (typeof (globalThis as any).LogView !== 'undefined' ? (globalThis as any).LogView : LogView);
export const getAccountView = () => (typeof (globalThis as any).AccountView !== 'undefined' ? (globalThis as any).AccountView : AccountView);
export const getExportCtrl = () => (typeof (globalThis as any).ExportController !== 'undefined' ? (globalThis as any).ExportController : ExportController);
export const getSyncCtrl = () => (typeof (globalThis as any).SyncController !== 'undefined' ? (globalThis as any).SyncController : SyncController);
export const getTakeoutCtrl = () => (typeof (globalThis as any).TakeoutController !== 'undefined' ? (globalThis as any).TakeoutController : TakeoutController);
export const getDirHandle = () => (typeof (globalThis as any).DirHandleController !== 'undefined' ? (globalThis as any).DirHandleController : DirHandleController);
export const getStorage = () => (typeof (globalThis as any).StorageService !== 'undefined' ? (globalThis as any).StorageService : StorageService);
export const getFormats = () => (typeof (globalThis as any).FormatStore !== 'undefined' ? (globalThis as any).FormatStore : FormatStore);
export const getLiveStorage = () => (typeof (globalThis as any).LiveStorageManager !== 'undefined' ? (globalThis as any).LiveStorageManager : LiveStorageManager);
export const getUtils = () => (typeof (globalThis as any).GeminiUtils !== 'undefined' ? (globalThis as any).GeminiUtils : GeminiUtils);
export const getConstants = () => (typeof (globalThis as any).GeminiConstants !== 'undefined' ? (globalThis as any).GeminiConstants : GeminiConstants);
export const getProtocol = () => (typeof (globalThis as any).GeminiProtocol !== 'undefined' ? (globalThis as any).GeminiProtocol : GeminiProtocol);
const resolveProvider = () => {
    const url = (typeof location !== 'undefined' && location.href) || '';
    return ProviderRegistry.findByUrl(url) || ProviderRegistry.getDefault();
};
// NOTE: the legacy `(globalThis as any).GeminiAPIClient` primary was intentionally
// dropped: geminiClient self-registers on globalThis whenever it loads (including
// transitively via the provider chain above), so keeping it as primary would
// silently bypass the registry and the provider wiring would never take effect.
export const getApiClient = () => resolveProvider();
export const getTabService = () => (typeof (globalThis as any).TabService !== 'undefined' ? (globalThis as any).TabService : TabService);
export const getTakeoutEngine = () => (typeof (globalThis as any).TakeoutEngine !== 'undefined' ? (globalThis as any).TakeoutEngine : TakeoutEngine);
export const getTour = () => (typeof (globalThis as any).TourGuide !== 'undefined' ? (globalThis as any).TourGuide : TourGuide);
export const getFsWriter = () => (typeof (globalThis as any).FsWriter !== 'undefined' ? (globalThis as any).FsWriter : FsWriter);
export const getChatFormatter = () => (typeof (globalThis as any).ChatFormatter !== 'undefined' ? (globalThis as any).ChatFormatter : ChatFormatter);
