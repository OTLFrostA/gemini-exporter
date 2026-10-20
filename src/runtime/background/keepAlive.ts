/**
 * Pings chrome.runtime to prevent Manifest V3 service worker inactivity termination
 * during long-running tasks.
 */
export function startKeepAlive(): () => void {
    // KeepAlive is strictly scoped to the running export and only useful
    // when the corresponding Chrome API exists in this Worker.
    if (typeof chrome === 'undefined' || !chrome.runtime?.getPlatformInfo) return () => {};
    const interval = setInterval(() => {
        try {
            if (chrome.runtime.getPlatformInfo) {
                chrome.runtime.getPlatformInfo(() => {});
            }
        } catch (e) {
            if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:keepAlive]', e);
        }
    }, 20000);
    return () => clearInterval(interval);
}
