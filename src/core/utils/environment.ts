// src/core/utils/environment.ts - Runtime environment detection (unpacked dev vs production)

/**
 * Determines whether the extension is running in an unpacked local development environment.
 * In Chrome/Chromium, extensions published via the Chrome Web Store always have an `update_url`
 * injected into their manifest by Google. Unpacked extensions loaded locally (via developer mode)
 * do not have `update_url`.
 */
export function isLocalDevelopment(): boolean {
    try {
        if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.getManifest !== 'function') {
            return true; // Non-extension / test environment fallback
        }
        const manifest = chrome.runtime.getManifest();
        if (!manifest) return true;

        // Query parameter override for testing/debugging
        if (typeof window !== 'undefined' && window.location && window.location.search) {
            const params = new URLSearchParams(window.location.search);
            if (params.get('dev') === '1') return true;
            if (params.get('prod') === '1') return false;
        }

        // Web Store extensions have update_url; unpacked extensions do not.
        return !manifest.update_url;
    } catch {
        return false;
    }
}
