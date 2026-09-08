// retryPolicy.js - Centralized HTTP 400 XSRF recovery, 401 cleanup, and 429 backoff policy
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.GeminiClientRetryPolicy = factory();
    }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function() {
    'use strict';

    function getCredentialManager() {
        if (typeof GeminiClientCredentialManager !== 'undefined') return GeminiClientCredentialManager;
        if (typeof globalThis !== 'undefined' && globalThis.GeminiClientCredentialManager) return globalThis.GeminiClientCredentialManager;
        if (typeof require !== 'undefined') {
            try { return require('./credentialManager.js'); } catch (_) {}
        }
        return null;
    }

    /**
     * Attempts automatic XSRF credential recovery on HTTP 400
     */
    async function handleHttp400(params) {
        const { resp, snippet, cred, isRetried, getAtFromPage, getBlFromPage, loadCredMap, getCredStorage } = params;
        if (resp.status !== 400 || isRetried) return { shouldRetry: false };

        const mXsrf = snippet && snippet.includes('xsrf') ? snippet.match(/"xsrf"\s*,\s*"([^"]+)"/) : null;
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
                            if (typeof chrome !== 'undefined' && storage !== chrome.storage.local && chrome.storage.local) {
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
    async function handleHttp401(params) {
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
                        if (typeof chrome !== 'undefined' && storage !== chrome.storage.local && chrome.storage.local) {
                            await chrome.storage.local.remove(["gemini_credentials_map", "gemini_credentials"]);
                        }
                    }
                }
            }
        } catch (_) { /* intentional: best-effort 401 cleanup */ }
    }

    /**
     * Handles HTTP 429 rate limit backoff and wait
     */
    async function handleHttp429(params) {
        const { resp, retryCount = 0, maxRetries = 3, label = 'request' } = params;
        if (resp.status !== 429 || retryCount >= maxRetries) return { shouldRetry: false };

        const retryAfter = resp.headers?.get ? resp.headers.get('retry-after') : null;
        let delayMs = Math.min(30000, 2000 * Math.pow(2, retryCount) + Math.floor(Math.random() * 1000));
        if (retryAfter) {
            const s = parseInt(retryAfter, 10);
            if (!isNaN(s) && s > 0) delayMs = Math.max(delayMs, s * 1000);
        }

        console.warn(`[Gemini Exporter Client] ${label} 429 rate limited, backoff ${delayMs}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delayMs));

        return {
            shouldRetry: true,
            delayMs,
            nextRetryCount: retryCount + 1
        };
    }

    return {
        handleHttp400,
        handleHttp401,
        handleHttp429
    };
}));
