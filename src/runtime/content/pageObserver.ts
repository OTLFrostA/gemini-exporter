import { contentContext } from './contentContext.js';
import { registerCleanup } from './cleanupRegistry.js';

let __syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let __lastObservedUrl = typeof location !== 'undefined' ? location.href : '';
let __historyUrlCallback: (() => void) | null = null;
let __locationPoll: ReturnType<typeof setInterval> | null = null;

function __handleLocationChange(): void {
    if (typeof location === 'undefined') return;
    if (location.href !== __lastObservedUrl) {
        __lastObservedUrl = location.href;
        if (typeof __historyUrlCallback === 'function') __historyUrlCallback();
    }
}

function removeHistoryListeners(): void {
    if (__locationPoll !== null) { clearInterval(__locationPoll); __locationPoll = null; }
    if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('popstate', __handleLocationChange);
        window.removeEventListener('gemini:locationchange', __handleLocationChange);
    }
    __historyUrlCallback = null;
}

export function cleanup(): void {
    contentContext.clearTimer('urlWatcher');
    contentContext.clearTimer('syncInterval');
    contentContext.clearTimer('titleObserver');
    contentContext.clearTimer('debounceTimer');

    if (__syncDebounceTimer) {
        clearTimeout(__syncDebounceTimer);
        __syncDebounceTimer = null;
    }

    if (typeof window !== 'undefined') {
        const w = window;
        w.__gemExporterUrlWatcher = null;
        w.__gemExporterSyncInterval = null;
        w.__gemExporterTitleObserver = null;
        w.__gemExporterDebounceTimer = null;
        removeHistoryListeners();
    }
}

export function debouncedSync(syncCallback?: () => void, delay = 350): void {
    if (__syncDebounceTimer) {
        clearTimeout(__syncDebounceTimer);
        __syncDebounceTimer = null;
    }
    const timer = setTimeout(() => {
        __syncDebounceTimer = null;
        contentContext.clearTimer('debounceTimer');
        if (contentContext.getDeepScanPromise()) return;
        if (typeof syncCallback === 'function') syncCallback();
    }, delay);
    __syncDebounceTimer = timer;
    contentContext.registerTimer('debounceTimer', timer, () => clearTimeout(timer));
}

export function hookHistoryEvents(onUrlChanged: () => void): void {
    if (typeof window === 'undefined' || typeof history === 'undefined') return;

    const w = window;
    if (!w.__gemExporterHistoryHooked) {
        w.__gemExporterHistoryHooked = true;
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function(...args: Parameters<History['pushState']>) {
            const res = originalPushState.apply(this, args);
            window.dispatchEvent(new Event('gemini:locationchange'));
            return res;
        };

        history.replaceState = function(...args: Parameters<History['replaceState']>) {
            const res = originalReplaceState.apply(this, args);
            window.dispatchEvent(new Event('gemini:locationchange'));
            return res;
        };

    }

    removeHistoryListeners();
    __lastObservedUrl = location.href;
    __historyUrlCallback = onUrlChanged;
    window.addEventListener('popstate', __handleLocationChange);
    window.addEventListener('gemini:locationchange', __handleLocationChange);
    // ISOLATED-world history wrappers may not observe page-world pushState.
    // Poll the URL only; never poll Domain, count, or trigger Sync.
    __locationPoll = setInterval(__handleLocationChange, 1000);
    registerCleanup(removeHistoryListeners);
}

export function observeTitleChanges(onTitleChanged: () => void): void {
    if (typeof document === 'undefined') return;
    try {
        const titleEl = document.querySelector('title');
        if (titleEl) {
            const observer = new MutationObserver(() => {
                onTitleChanged();
            });
            observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
            contentContext.registerTimer('titleObserver', observer, () => observer.disconnect());
        }
    } catch (e) {
        if (contentContext.isDevMode()) console.debug('[GemExporter:pageObserver]', e);
    }
}

export function startPeriodicSync(syncCallback?: () => void, intervalMs = 15000): void {
    if (typeof window === 'undefined') return;
    contentContext.clearTimer('syncInterval');
    const syncInterval = setInterval(() => {
        if (contentContext.getDeepScanPromise()) return;
        if (typeof syncCallback === 'function') syncCallback();
    }, intervalMs);
    contentContext.registerTimer('syncInterval', syncInterval, () => clearInterval(syncInterval));
}

export function init({ onSync }: { onSync?: () => void } = {}): { cleanup: () => void; debouncedSync: typeof debouncedSync } {
    cleanup();

    const triggerSync = (delay = 350) => debouncedSync(onSync, delay);

    hookHistoryEvents(() => triggerSync(400));
    observeTitleChanges(() => triggerSync(500));
    startPeriodicSync(onSync, 15000);

    return {
        cleanup,
        debouncedSync
    };
}

export const PageObserver = {
    init,
    cleanup,
    debouncedSync,
    hookHistoryEvents,
    observeTitleChanges,
    startPeriodicSync
};
