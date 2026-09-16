// retryPolicy.ts - Centralized HTTP 400 XSRF recovery, 401 cleanup, and 429 backoff policy
import type { GeminiClientCredentialManagerModule } from "./credentialManager.js";
import { calculateBackoff } from "../../engine/export/rateLimiter.js";

export interface Http400Params {
    resp: { status: number; [key: string]: any };
    snippet?: string;
    cred?: any;
    isRetried?: boolean;
    getAtFromPage?: () => string;
    getBlFromPage?: () => string | null;
    loadCredMap?: () => Promise<any>;
    getCredStorage?: () => any;
}

export interface Http400Result {
    shouldRetry: boolean;
    freshAt?: string;
    freshBl?: string | null;
}

export interface Http401Params {
    cred?: any;
    loadCredMap?: () => Promise<any>;
    getCredStorage?: () => any;
}

export interface Http429Params {
    resp: { status: number; headers?: { get?: (header: string) => string | null }; [key: string]: any };
    retryCount?: number;
    maxRetries?: number;
    label?: string;
    /** P1-031: when set, the backoff sleep is interruptible via this signal. */
    signal?: AbortSignal | null;
    /** P1-039: explicit server Retry-After hint in ms, for receivers (e.g. background
     * batchFetcher) that cannot read response headers across chrome.tabs.sendMessage. */
    retryAfterMs?: number;
}

export interface Http429Result {
    shouldRetry: boolean;
    delayMs?: number;
    nextRetryCount?: number;
    /** P1-031: true when the backoff wait was cut short by abort. */
    aborted?: boolean;
}

export interface GeminiClientRetryPolicyModule {
    handleHttp400: (params: Http400Params) => Promise<Http400Result>;
    handleHttp401: (params: Http401Params) => Promise<void>;
    handleHttp429: (params: Http429Params) => Promise<Http429Result>;
    /** P1-031: interruptible sleep; resolves true when cut short by abort. */
    interruptibleSleep: (ms: number, signal?: AbortSignal | null, isAborted?: () => boolean) => Promise<boolean>;
    /** P1-033: parse Retry-After (delta-seconds or HTTP-date), clamped to 30s. */
    parseRetryAfterMs: (value: string | null | undefined) => number | undefined;
}

declare global {
    var GeminiClientRetryPolicy: GeminiClientRetryPolicyModule;
}



    function getCredentialManager(): GeminiClientCredentialManagerModule | null {
        if (typeof GeminiClientCredentialManager !== "undefined") return GeminiClientCredentialManager;
        if (typeof globalThis !== "undefined" && (globalThis as any).GeminiClientCredentialManager) return (globalThis as any).GeminiClientCredentialManager;
        return null;
    }

    /**
     * Attempts automatic XSRF credential recovery on HTTP 400
     */
    async function handleHttp400(params: Http400Params): Promise<Http400Result> {
        const { resp, snippet, cred, isRetried, getAtFromPage, getBlFromPage, loadCredMap, getCredStorage } = params;
        if (resp.status !== 400 || isRetried) return { shouldRetry: false };

        const mXsrf = snippet && snippet.includes("xsrf") ? snippet.match(/"xsrf"\s*,\s*"([^"]+)"/) : null;
        const atFn = getAtFromPage || getCredentialManager()?.getAtFromPage;
        const blFn = getBlFromPage || getCredentialManager()?.getBlFromPage;

        const freshAt = (mXsrf && mXsrf[1]) ? mXsrf[1] : (atFn ? atFn() : null);
        const freshBl = blFn ? blFn() : null;

        if ((freshAt && freshAt !== cred?.at) || (freshBl && freshBl !== cred?.bl)) {
            try {
                const loadMapFn = loadCredMap || getCredentialManager()?.loadCredMap;
                const getStorageFn = getCredStorage || getCredentialManager()?.getCredStorage;

                if (loadMapFn && getStorageFn) {
                    let map = await loadMapFn();
                    if (cred?.sid && map[cred.sid]) {
                        if (freshAt) map[cred.sid].at = freshAt;
                        if (freshBl) map[cred.sid].bl = freshBl;
                        const storage = getStorageFn();
                        if (storage) {
                            await storage.set({ gemini_credentials_map: map });
                            if (typeof chrome !== "undefined" && storage !== chrome.storage.local && chrome.storage.local) {
                                await chrome.storage.local.remove(["gemini_credentials_map", "gemini_credentials"]);
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn("[GemExporter:storage] Storage operation failed:", e);
            }
            return {
                shouldRetry: true,
                freshAt: freshAt || cred?.at,
                freshBl: freshBl || cred?.bl
            };
        }
        return { shouldRetry: false };
    }

    /**
     * Cleans up expired credentials on HTTP 401
     */
    async function handleHttp401(params: Http401Params): Promise<void> {
        const { cred, loadCredMap, getCredStorage } = params;
        try {
            const loadMapFn = loadCredMap || getCredentialManager()?.loadCredMap;
            const getStorageFn = getCredStorage || getCredentialManager()?.getCredStorage;

            if (loadMapFn && getStorageFn && cred?.sid) {
                let map = await loadMapFn();
                if (map[cred.sid]) {
                    delete map[cred.sid];
                    const storage = getStorageFn();
                    if (storage) {
                        await storage.set({ gemini_credentials_map: map });
                        if (typeof chrome !== "undefined" && storage !== chrome.storage.local && chrome.storage.local) {
                            await chrome.storage.local.remove(["gemini_credentials_map", "gemini_credentials"]);
                        }
                    }
                }
            }
        } catch (_) { /* intentional: best-effort 401 cleanup */ }
    }

    /**
     * P1-032: server Retry-After hints never exceed the 30s backoff cap.
     */
    const MAX_RETRY_AFTER_MS = 30000;

    /**
     * P1-031: interruptible sleep for backoff waits.
     * Resolves true when the wait was cut short by abort, false when the full
     * delay elapsed. An optional isAborted predicate covers abort mechanisms
     * that are not AbortSignals (e.g. background per-slot abort flags).
     */
    async function interruptibleSleep(ms: number, signal?: AbortSignal | null, isAborted?: () => boolean): Promise<boolean> {
        if (ms <= 0) return !!signal?.aborted || !!isAborted?.();
        if (signal?.aborted || isAborted?.()) return true;
        return await new Promise<boolean>((resolve) => {
            let done = false;
            let poll: ReturnType<typeof setInterval> | null = null;
            const onAbort = () => finish(true);
            const cleanup = () => {
                if (poll !== null) { clearInterval(poll); poll = null; }
                clearTimeout(timer);
                try { signal?.removeEventListener?.("abort", onAbort); } catch (_) { /* noop */ }
            };
            const finish = (aborted: boolean) => {
                if (done) return;
                done = true;
                cleanup();
                resolve(aborted);
            };
            const timer = setTimeout(() => finish(!!signal?.aborted || !!isAborted?.()), ms);
            if (signal && typeof signal.addEventListener === "function") {
                signal.addEventListener("abort", onAbort, { once: true });
            }
            if (isAborted) {
                poll = setInterval(() => { if (isAborted()) finish(true); }, 50);
            }
        });
    }

    /**
     * P1-033: parse a Retry-After value as delta-seconds or HTTP-date (RFC 7231).
     * P1-032: result is clamped to MAX_RETRY_AFTER_MS.
     * Returns undefined when the value is absent, unparseable, or already in the past.
     */
    function parseRetryAfterMs(value: string | null | undefined): number | undefined {
        if (!value) return undefined;
        const s = parseInt(value, 10);
        if (!isNaN(s) && s > 0) return Math.min(s * 1000, MAX_RETRY_AFTER_MS);
        const t = Date.parse(value);
        if (!isNaN(t)) {
            const delta = t - Date.now();
            if (delta > 0) return Math.min(delta, MAX_RETRY_AFTER_MS);
        }
        return undefined;
    }

    /**
     * Handles HTTP 429 rate limit backoff and wait.
     * P1-031: the backoff sleep is interruptible via params.signal; when aborted,
     * returns { shouldRetry: false, aborted: true } so callers stop the retry chain
     * immediately instead of sleeping out the full delay.
     */
    async function handleHttp429(params: Http429Params): Promise<Http429Result> {
        const { resp, retryCount = 0, maxRetries = 3, label = "request", signal = null, retryAfterMs: explicitRetryAfterMs } = params;
        if (resp.status !== 429 || retryCount >= maxRetries) return { shouldRetry: false };
        if (signal?.aborted) return { shouldRetry: false, aborted: true };

        // P1-039: an explicit hint wins when the receiver cannot read response headers
        // (e.g. background batchFetcher); otherwise parse the Retry-After header.
        // P1-033: Retry-After may be delta-seconds or an HTTP-date (RFC 7231).
        // P1-032: the server hint is clamped to the 30s cap, it no longer bypasses it.
        const headerVal = resp.headers?.get ? resp.headers.get("retry-after") : null;
        const retryAfterMs = (typeof explicitRetryAfterMs === "number" && explicitRetryAfterMs > 0)
            ? Math.min(explicitRetryAfterMs, MAX_RETRY_AFTER_MS)
            : parseRetryAfterMs(headerVal);
        const delayMs = calculateBackoff(retryCount, {
            initialDelayMs: 2000,
            maxDelayMs: 30000,
            jitterMs: 1000,
            retryAfterMs,
        });

        console.warn(`[Gemini Exporter Client] ${label} 429 rate limited, backoff ${delayMs}ms (attempt ${retryCount + 1}/${maxRetries})`);
        const wasAborted = await interruptibleSleep(delayMs, signal);
        if (wasAborted) return { shouldRetry: false, aborted: true };

        return {
            shouldRetry: true,
            delayMs,
            nextRetryCount: retryCount + 1
        };
    }

export {
    handleHttp400,
    handleHttp401,
    handleHttp429,
    interruptibleSleep,
    parseRetryAfterMs
};

export const GeminiClientRetryPolicy: GeminiClientRetryPolicyModule = {
    handleHttp400,
    handleHttp401,
    handleHttp429,
    interruptibleSleep,
    parseRetryAfterMs
};

if (typeof globalThis !== 'undefined') (globalThis as any).GeminiClientRetryPolicy = GeminiClientRetryPolicy;
if (typeof module === 'object' && module.exports) module.exports = GeminiClientRetryPolicy;

export default GeminiClientRetryPolicy;

