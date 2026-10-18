import { extractConversationIdFromUrl } from '../core/utils/pathUtils.js';

export type LiveTurnCallback = (conversationId: string, reason: 'turn_complete' | 'location_change' | 'unload') => void;
export interface LiveSaveObserverOptions {
    debounceMs?: number;
    onTurnComplete?: LiveTurnCallback;
    getActiveId?: () => string | null;
}
let options: LiveSaveObserverOptions = {};
let active = false;
let pendingId: string | null = null;
let completion: ReturnType<typeof setTimeout> | undefined;
function discard(): void {
    clearTimeout(completion);
    completion = undefined;
    pendingId = null;
}
export function checkIsGeneratingDOM(): boolean {
    if (typeof document === 'undefined') return false;

    const stopSelectors = [
        'button[aria-label*="Stop"]',
        'button[aria-label*="停止"]',
        'button[aria-label*="Arrêter"]',
        'button[aria-label*="Stoppen"]',
        'button[data-test-id*="stop"]',
        '[data-test-id="stop-button"]',
        '.stop-generating-button',
        'mat-icon[fonticon="stop"]',
        'mat-icon[fonticon="pause"]'
    ];
    for (const sel of stopSelectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el && el.offsetParent !== null) {
            return true;
        }
    }

    const streamingSelectors = [
        'model-response.loading',
        'model-response.generating',
        '[data-is-generating="true"]',
        '.model-response-text-loading',
        '.sparkle-loading',
        '.streaming'
    ];
    for (const sel of streamingSelectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) return true;
    }

    return false;
}

export function getActiveConversationId(): string | null {
    return typeof location === 'undefined' ? null : extractConversationIdFromUrl(location.pathname);
}
export function cleanup(): void {
    discard();
    active = false;
    if (typeof window === 'undefined') return;
    window.removeEventListener('gemini:locationchange', discard);
    window.removeEventListener('popstate', discard);
    window.removeEventListener('beforeunload', discard);
}
export function init(value: LiveSaveObserverOptions = {}): void {
    cleanup();
    if (typeof window === 'undefined') return;
    options = value;
    active = true;
    window.addEventListener('gemini:locationchange', discard);
    window.addEventListener('popstate', discard);
    window.addEventListener('beforeunload', discard);
}
export function isObserverActive(): boolean { return active; }
export function notifyStreamStart(cid?: string | null): void {
    discard();
    pendingId = cid || options.getActiveId?.() || getActiveConversationId();
}
/** Only L1's confirmed stream completion authorizes a save; DOM idleness never does. */
export function notifyStreamComplete(cid?: string | null): void {
    if (!active) return;
    const id = cid || pendingId || options.getActiveId?.() || getActiveConversationId();
    discard();
    if (!id) return;
    completion = setTimeout(() => {
        completion = undefined;
        if (active) options.onTurnComplete?.(id, 'turn_complete');
    }, options.debounceMs ?? 50);
}
export function flushCurrentTurnNow(): void {
    // Navigation/unload/forced flush cannot establish generation completion.
}
export const LiveSaveObserver = { init, cleanup, isObserverActive, checkIsGeneratingDOM,
    getActiveConversationId, notifyStreamStart, notifyStreamComplete, flushCurrentTurnNow };
export default LiveSaveObserver;
