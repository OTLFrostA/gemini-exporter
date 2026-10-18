import { ensureV2Ready } from './readiness.js';
import { getSettings, updateSettings } from '../core/application/settings/index.js';
import { FEEDBACK_URL } from '../core/utils/constants.js';

export { FEEDBACK_URL };

/**
 * Configure chrome.storage.session access level so content scripts can access
 * memory-scoped CSRF credentials without disk persistence.
 */
export function initSessionAccessLevel(): void {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
            chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
        }
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:lifecycle]', e);
    }
}

export function initUninstallUrl(): void {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.setUninstallURL) {
        try {
            chrome.runtime.setUninstallURL(FEEDBACK_URL, () => {
                if (chrome.runtime.lastError) {
                    console.warn('[Gemini Exporter] Failed to set uninstall URL:', chrome.runtime.lastError.message);
                }
            });
        } catch (err) {
            console.warn('[Gemini Exporter] Error calling setUninstallURL:', err);
        }
    }
}

export function initLifecycleListeners(): void {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onInstalled) return;

    chrome.runtime.onInstalled.addListener((details) => {
        initUninstallUrl();
        void (async () => {
            await ensureV2Ready();
            const currentVersion = chrome.runtime.getManifest().version;
            if (details.reason === 'install') {
                await updateSettings({ lastSeenFeatureVersion: currentVersion });
                await chrome.runtime.openOptionsPage();
            } else if (details.reason === 'update') {
                const settings = await getSettings();
                const patch = { tourAutoHandled: true as const,
                    ...(!settings.lastSeenFeatureVersion && details.previousVersion
                        && /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(details.previousVersion)
                        ? { lastSeenFeatureVersion: details.previousVersion } : {}) };
                await updateSettings(patch);
            }
        })().catch(error => console.error('[Runtime] Installation initialization failed', error));
    });
}
