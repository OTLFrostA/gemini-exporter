import { registerCleanup } from './cleanupRegistry.js';

let __lastObservedUrl = typeof location !== 'undefined' ? location.href : '';
let __historyUrlCallback: (() => void) | null = null;
let __locationPoll: ReturnType<typeof setInterval> | null = null;

function __handleLocationChange(): void {
    if (typeof location === 'undefined') return;
    if (location.href !== __lastObservedUrl) {
        __lastObservedUrl = location.href;
        __historyUrlCallback?.();
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
    removeHistoryListeners();
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

export const PageObserver = { cleanup, hookHistoryEvents };
