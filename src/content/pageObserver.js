// src/content/pageObserver.js - Page lifecycle, URL mutation watcher, and timer cleanup
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PageObserver = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    let __syncDebounceTimer = null;
    let __lastObservedUrl = typeof location !== 'undefined' ? location.href : '';

    function cleanupPreviousWatchers() {
        if (typeof window === 'undefined') return;

        if (window.__gemExporterUrlWatcher) {
            clearInterval(window.__gemExporterUrlWatcher);
            window.__gemExporterUrlWatcher = null;
        }
        if (window.__gemExporterSyncInterval) {
            clearInterval(window.__gemExporterSyncInterval);
            window.__gemExporterSyncInterval = null;
        }
        if (window.__gemExporterTitleObserver) {
            try { window.__gemExporterTitleObserver.disconnect(); } catch { /* best-effort cleanup */ }
            window.__gemExporterTitleObserver = null;
        }
        if (window.__gemExporterDebounceTimer) {
            clearTimeout(window.__gemExporterDebounceTimer);
            window.__gemExporterDebounceTimer = null;
        }
    }

    function debouncedSync(syncCallback, delay = 350) {
        if (__syncDebounceTimer) clearTimeout(__syncDebounceTimer);
        __syncDebounceTimer = setTimeout(() => {
            __syncDebounceTimer = null;
            if (typeof window !== 'undefined' && window.__gemExporterDeepScanPromise) return;
            if (typeof syncCallback === 'function') syncCallback();
        }, delay);
        if (typeof window !== 'undefined') {
            window.__gemExporterDebounceTimer = __syncDebounceTimer;
        }
    }

    function hookHistoryEvents(onUrlChanged) {
        if (typeof window === 'undefined' || typeof history === 'undefined') return;

        if (!window.__gemExporterHistoryHooked) {
            window.__gemExporterHistoryHooked = true;
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;

            history.pushState = function(...args) {
                const res = originalPushState.apply(this, args);
                window.dispatchEvent(new Event('gemini:locationchange'));
                return res;
            };

            history.replaceState = function(...args) {
                const res = originalReplaceState.apply(this, args);
                window.dispatchEvent(new Event('gemini:locationchange'));
                return res;
            };
        }

        const handleLocationChange = () => {
            if (typeof location === 'undefined') return;
            if (location.href !== __lastObservedUrl) {
                __lastObservedUrl = location.href;
                onUrlChanged();
            }
        };

        window.addEventListener('popstate', handleLocationChange);
        window.addEventListener('gemini:locationchange', handleLocationChange);

        // Fallback polling guard stored cleanly in window for leak-free disposal (Issue A1 fix)
        window.__gemExporterUrlWatcher = setInterval(() => {
            if (typeof location === 'undefined') return;
            if (location.href !== __lastObservedUrl) {
                __lastObservedUrl = location.href;
                onUrlChanged();
            }
        }, 1000);
    }

    function observeTitleChanges(onTitleChanged) {
        if (typeof document === 'undefined') return;
        try {
            const titleEl = document.querySelector('title');
            if (titleEl) {
                const observer = new MutationObserver(() => {
                    onTitleChanged();
                });
                observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
                if (typeof window !== 'undefined') {
                    window.__gemExporterTitleObserver = observer;
                }
            }
        } catch (e) {
            if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:pageObserver]', e);
        }
    }

    function startPeriodicSync(syncCallback, intervalMs = 15000) {
        if (typeof window === 'undefined') return;
        if (window.__gemExporterSyncInterval) clearInterval(window.__gemExporterSyncInterval);
        window.__gemExporterSyncInterval = setInterval(() => {
            if (window.__gemExporterDeepScanPromise) return;
            if (typeof syncCallback === 'function') syncCallback();
        }, intervalMs);
    }

    function init({ onSync } = {}) {
        cleanupPreviousWatchers();

        const triggerSync = (delay = 350) => debouncedSync(onSync, delay);

        hookHistoryEvents(() => triggerSync(400));
        observeTitleChanges(() => triggerSync(500));
        startPeriodicSync(onSync, 15000);
    }

    function cleanup() {
        cleanupPreviousWatchers();
    }

    return {
        init,
        cleanup,
        cleanupPreviousWatchers,
        debouncedSync,
        hookHistoryEvents,
        observeTitleChanges,
        startPeriodicSync
    };
}));
