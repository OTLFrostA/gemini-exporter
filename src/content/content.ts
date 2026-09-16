// src/content/content.ts - Gemini Exporter content script coordinator (Layered Architecture)
import '../core/protocol/protocol.js';
import '../core/utils/constants.js';
import '../core/utils/utils.js';
import '../core/storage/storageService.js';
import '../core/api/parser/extractors.js';
import '../core/api/parser/attachments.js';
import '../core/api/parser/parseList.js';
import '../core/api/parser/parseDetail.js';
import '../core/api/geminiParser.js';
import '../core/api/client/credentialManager.js';
import '../core/api/client/retryPolicy.js';
import '../core/api/client/rpcClient.js';
import '../core/api/client/pagination.js';
import '../core/api/geminiClient.js';
import { StorageService } from '../core/storage/storageService.js';
import { GeminiUtils } from '../core/utils/utils.js';
import { contentContext } from './contentContext.js';
import { ensureCreds } from './bootstrap.js';
import { SyncEngine } from './syncEngine.js';
import { PageObserver } from './pageObserver.js';
import { MessageRouter } from './messageRouter.js';
import { BadgeView } from './badgeView.js';
import { MessageBridge } from './messageBridge.js';
import { DomScraper } from './domScraper.js';
import { AssetFetcher } from './assetFetcher.js';
import { LiveSaveObserver } from './liveSaveObserver.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { LiveStorageManager } from '../core/storage/liveStorageManager.js';
import { ChatFormatter } from '../core/engine/chatFormatter.js';
import { FsWriter } from '../core/engine/writers/fsWriter.js';

(() => {
    'use strict';

    if (typeof window === 'undefined') return;

    const w = window as any;

    if (typeof w.__gemExporterDeepScanPromise === 'undefined') w.__gemExporterDeepScanPromise = null;

    // P1-026: cross-bundle cleanup registry. The previously injected bundle
    // registered its OWN teardown functions here at the end of its init, so
    // run them now — calling the new bundle's PageObserver.cleanup() cannot
    // reach the old bundle's module state (observers, listeners, timers).
    const runPreviousBundleCleanups = () => {
        const fns = Array.isArray(w.__gemExporterCleanups) ? w.__gemExporterCleanups : [];
        w.__gemExporterCleanups = [];
        for (const fn of fns) {
            try {
                if (typeof fn === 'function') fn();
            } catch (e) {
                if (typeof console !== 'undefined' && console.warn) console.warn('[Gemini Exporter] previous bundle cleanup failed', e);
            }
        }
    };

    if (w.__gemExporterInjected) {
        // Newest first: the previous (fixed) bundle's registered cleanups.
        runPreviousBundleCleanups();
        // Fallback for bundles that predate the registry: best-effort cleanup
        // with the current bundle's module instances.
        try {
            document.getElementById('geminiExportBadge')?.remove();
        } catch {
            /* intentional: best-effort cleanup */
        }
        if (PageObserver && PageObserver.cleanup) {
            PageObserver.cleanup();
        }
        if (LiveSaveObserver && LiveSaveObserver.cleanup) {
            LiveSaveObserver.cleanup();
        }
        w.__gemExporterInjected = false;
        w.__gemExporterScrollAll = null;
    }
    w.__gemExporterInjected = true;
    contentContext.setInjected(true);

    const Sync = SyncEngine;
    const Observer = PageObserver;
    const Router = MessageRouter;
    const Badge = BadgeView;
    const Bridge = MessageBridge;
    const Storage = (typeof StorageService !== 'undefined' ? StorageService : null) as any;
    const Scraper = DomScraper;
    const Assets = AssetFetcher;
    const Utils = (typeof GeminiUtils !== 'undefined' ? GeminiUtils : null) as any;

    function getAccountSlot(): string {
        return Sync ? Sync.getAccountSlot() : 'u0';
    }

    function isZh(): boolean {
        return Sync ? Sync.isZh() : true;
    }

    function ensureBadge(): HTMLElement | null {
        if (Badge && Badge.ensureBadge) {
            const b = Badge.ensureBadge({ isZh, onClick: undefined }) as any;
            if (b && !b.__initialRefreshed) {
                b.__initialRefreshed = true;
                if (Sync && Sync.refreshInitialBadge) {
                    Sync.refreshInitialBadge();
                }
            }
            return b;
        }
        return document.getElementById('geminiExportBadge');
    }

    // Language & Dev mode synchronization
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['gemini_exporter_lang', 'gemini_dev_mode'], d => {
                const lang = String(d.gemini_exporter_lang || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'));
                if (Sync && Sync.setLanguage) Sync.setLanguage(lang);
                contentContext.setDevMode(!!d.gemini_dev_mode);
                w.__gemExporterDevMode = !!d.gemini_dev_mode;
                if (Sync && Sync.refreshInitialBadge) Sync.refreshInitialBadge();
            });
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes.gemini_exporter_lang) {
                    const newLang = String(changes.gemini_exporter_lang.newValue || 'zh');
                    if (Sync && Sync.setLanguage) Sync.setLanguage(newLang);
                    if (Sync && Sync.refreshInitialBadge) Sync.refreshInitialBadge();
                }
                if (area === 'local' && changes.gemini_dev_mode) {
                    const devMode = !!changes.gemini_dev_mode.newValue;
                    contentContext.setDevMode(devMode);
                    w.__gemExporterDevMode = devMode;
                }
            });
        }
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:content.ts]', e);
    }

    // Initialize Live Auto-Save system
    if (LiveSaveCoordinator && LiveSaveObserver) {
        LiveSaveCoordinator.init({
            storageManager: LiveStorageManager,
            scraper: Scraper,
            formatter: typeof ChatFormatter !== 'undefined' ? ChatFormatter : (w.ChatFormatter || null),
            fsWriterClass: typeof FsWriter !== 'undefined' ? FsWriter : (w.FsWriter || null),
            utils: Utils,
            badge: Badge
        });

        LiveSaveObserver.init({
            debounceMs: 300,
            onTurnComplete: (cid, reason) => {
                LiveSaveCoordinator.executeLiveSave(cid, reason);
                if (Sync && Sync.touchActiveConversation) {
                    Sync.touchActiveConversation(cid, undefined, { source: 'live-turn-complete' }).catch(() => {});
                }
            }
        });
    }

    // Initialize Inter-World Message Bridge
    if (Bridge && Bridge.init && Sync) {
        Bridge.init({
            upsertConversations: Sync.upsertConversations,
            touchActiveConversation: Sync.touchActiveConversation,
            extractActiveChatTitle: Sync.extractActiveChatTitle,
            getAccountSlot,
            isRealTitle: Utils?.isRealTitle || ((t: string, id: string) => !!(t && String(t).trim().length > 1)),
            cleanTitle: Utils?.cleanTitle || ((t: string) => (t || '').trim()),
            updateBadge: Sync.updateBadge,
            ensureBadge,
            Storage,
            protocol: typeof GeminiProtocol !== 'undefined' ? GeminiProtocol : null,
            onStreamStart: (cid) => {
                if (LiveSaveObserver && typeof LiveSaveObserver.notifyStreamStart === 'function') {
                    LiveSaveObserver.notifyStreamStart(cid);
                }
            },
            onStreamComplete: (cid) => {
                if (LiveSaveObserver && typeof LiveSaveObserver.notifyStreamComplete === 'function') {
                    LiveSaveObserver.notifyStreamComplete(cid);
                }
            }
        });
    }

    // Initialize Message Router
    // P1-026: capture the chrome.runtime.onMessage listener this bundle's
    // Router.init registers, so a later re-inject can remove exactly this
    // function (re-injecting otherwise stacks duplicate router listeners).
    let routerMessageListener: ((msg: any, sender: any, sendResponse: any) => any) | null = null;
    if (Router && Router.init) {
        const onMessageApi = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) || null;
        const origAddListener = onMessageApi ? onMessageApi.addListener.bind(onMessageApi) : null;
        if (onMessageApi && origAddListener) {
            (onMessageApi as any).addListener = (fn: any) => {
                routerMessageListener = fn;
                return origAddListener(fn);
            };
        }
        try {
            Router.init({
                syncEngine: Sync,
                scraper: Scraper,
                assets: Assets,
                storage: Storage,
                utils: Utils
            });
        } finally {
            if (onMessageApi && origAddListener) {
                (onMessageApi as any).addListener = origAddListener;
            }
        }
    }

    async function autoInitSync(): Promise<void> {
        ensureBadge();
        if (Sync) {
            await Sync.refreshInitialBadge();
            await Sync.syncOnce();
        }
    }

    // Initialize Page Observer (handles pushState, popstate, MutationObserver and clean intervals)
    if (Observer && Observer.init) {
        Observer.init({
            onSync: () => {
                if (Sync) Sync.syncOnce();
            }
        });
    }

    // Run credential bootstrap
    ensureCreds();

    if (document.readyState !== 'loading') {
        autoInitSync();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            ensureBadge();
            autoInitSync();
        }, { once: true });
    }

    // P1-026: register THIS bundle's teardown so the next re-inject can tear
    // down this bundle's actual module state (not the next bundle's).
    try {
        const cleanups: Array<() => void> = [];
        cleanups.push(() => { try { PageObserver && (PageObserver as any).cleanup && (PageObserver as any).cleanup(); } catch { /* best effort */ } });
        cleanups.push(() => { try { LiveSaveObserver && (LiveSaveObserver as any).cleanup && (LiveSaveObserver as any).cleanup(); } catch { /* best effort */ } });
        cleanups.push(() => { try { (contentContext as any).clearAllTimers && (contentContext as any).clearAllTimers(); } catch { /* best effort */ } });
        cleanups.push(() => {
            try {
                const fn = routerMessageListener;
                if (fn && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
                    chrome.runtime.onMessage.removeListener(fn as any);
                }
            } catch { /* best effort */ }
        });
        cleanups.push(() => {
            try {
                if (Bridge && (Bridge as any).handleWindowMessage && typeof window !== 'undefined') {
                    window.removeEventListener('message', (Bridge as any).handleWindowMessage);
                }
            } catch { /* best effort */ }
        });
        cleanups.push(() => { try { document.getElementById('geminiExportBadge')?.remove(); } catch { /* best effort */ } });
        w.__gemExporterCleanups = (Array.isArray(w.__gemExporterCleanups) ? w.__gemExporterCleanups : []).concat(cleanups);
    } catch {
        /* intentional: registry is best-effort */
    }

    console.log('[Gemini Exporter Content Coordinator] ready');
})();
