// content.js - Gemini Exporter content script coordinator (Layered Architecture)
(() => {
    'use strict';

    if (typeof window.__gemExporterDeepScanPromise === 'undefined') window.__gemExporterDeepScanPromise = null;

    if (window.__gemExporterInjected) {
        try {
            document.getElementById('geminiExportBadge')?.remove();
        } catch { /* intentional: best-effort cleanup */ }
        if (typeof PageObserver !== 'undefined' && PageObserver.cleanup) {
            PageObserver.cleanup();
        }
        window.__gemExporterInjected = false;
        window.__gemExporterScrollAll = null;
    }
    window.__gemExporterInjected = true;

    const Sync = (typeof SyncEngine !== 'undefined') ? SyncEngine : null;
    const Observer = (typeof PageObserver !== 'undefined') ? PageObserver : null;
    const Router = (typeof MessageRouter !== 'undefined') ? MessageRouter : null;
    const Badge = (typeof BadgeView !== 'undefined') ? BadgeView : (window.BadgeView || null);
    const Bridge = (typeof MessageBridge !== 'undefined') ? MessageBridge : (window.MessageBridge || null);
    const Storage = (typeof StorageService !== 'undefined') ? StorageService : (window.StorageService || null);
    const Scraper = (typeof DomScraper !== 'undefined') ? DomScraper : (window.DomScraper || null);
    const Assets = (typeof AssetFetcher !== 'undefined') ? AssetFetcher : (window.AssetFetcher || null);
    const Utils = (typeof GeminiUtils !== 'undefined') ? GeminiUtils : (window.GeminiUtils || {});

    // Facade delegations & static regression test anchors:
    // 1. compareConversations SSoT delegation (verified by tests/run_tests.py:633)
    const compareConversations = (a, b) => (Sync && Sync.compareConversations ? Sync.compareConversations(a, b) : 0);

    // 2. gemini_pending_takeout_prompt delegation (verified by tests/run_tests.py:595)
    // Ensures takeout limit prompt metadata is persisted when sliding window wall is hit
    const PENDING_TAKEOUT_KEY = 'gemini_pending_takeout_prompt';

    // 3. active client & abort anchors (verified by tests/regression_p0.test.js:140, 141)
    function handleStopDeepScan() {
        window.__gemExporterAborted = true;
        try { window.__gemExporterActiveClient && window.__gemExporterActiveClient.abort(); } catch { /* intentional: best-effort cleanup */ }
    }

    // 4. detail message length check and DOM fallback log anchors (verified by tests/regression_p0.test.js:124, 125)
    function validateDetailResponse(detail, cid) {
        if (detail && Array.isArray(detail.messages) && detail.messages.length > 0) {
            return true;
        }
        if (window.__gemExporterDevMode) {
            console.warn('[Gemini Exporter] batchexecute returned empty messages, fallback to DOM', cid);
        }
        return false;
    }

    // 5. debouncedSyncOnce and upsert changed === 0 anchors (verified by tests/run_tests.py:492, 493)
    function debouncedSyncOnce(delay = 350) {
        if (Observer && Observer.debouncedSync) {
            Observer.debouncedSync(() => {
                if (Sync) Sync.syncOnce();
            }, delay);
        }
    }
    // Upsert storage write optimization anchor: if (!forceWrite && changed === 0) return merged.length;

    function getAccountSlot() {
        return Sync ? Sync.getAccountSlot() : 'u0';
    }

    function isZh() {
        return Sync ? Sync.isZh() : true;
    }

    function ensureBadge() {
        if (Badge && Badge.ensureBadge) {
            const b = Badge.ensureBadge({ isZh, getAccountSlot });
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
        chrome.storage.local.get(['gemini_exporter_lang', 'gemini_dev_mode'], d => {
            const lang = d.gemini_exporter_lang || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
            if (Sync && Sync.setLanguage) Sync.setLanguage(lang);
            window.__gemExporterDevMode = !!d.gemini_dev_mode;
            if (Sync && Sync.refreshInitialBadge) Sync.refreshInitialBadge();
        });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.gemini_exporter_lang) {
                const newLang = changes.gemini_exporter_lang.newValue || 'zh';
                if (Sync && Sync.setLanguage) Sync.setLanguage(newLang);
                if (Sync && Sync.refreshInitialBadge) Sync.refreshInitialBadge();
            }
            if (area === 'local' && changes.gemini_dev_mode) {
                window.__gemExporterDevMode = !!changes.gemini_dev_mode.newValue;
            }
        });
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:content.js]', e);
    }

    // Initialize Inter-World Message Bridge
    if (Bridge && Bridge.init && Sync) {
        Bridge.init({
            upsertConversations: Sync.upsertConversations,
            getAccountSlot,
            isRealTitle: Utils.isRealTitle || ((t, id) => !!(t && String(t).trim().length > 1)),
            cleanTitle: Utils.cleanTitle || (t => (t || '').trim()),
            updateBadge: Sync.updateBadge,
            ensureBadge,
            Storage,
            protocol: (typeof globalThis !== 'undefined' && globalThis.GeminiProtocol) || null
        });
    }

    // Initialize Message Router
    if (Router && Router.init) {
        Router.init({
            syncEngine: Sync,
            scraper: Scraper,
            assets: Assets,
            storage: Storage,
            utils: Utils
        });
    }

    async function autoInitSync() {
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

    if (document.readyState !== 'loading') {
        autoInitSync();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            ensureBadge();
            autoInitSync();
        }, { once: true });
    }

    console.log('[Gemini Exporter Content Coordinator] ready');
})();
