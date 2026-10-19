/** Only Migration interprets this marker; Storage owns physical Chrome IO. */
export function markV2Initialized(): Promise<void> {
    return chrome.storage.local.set({ gemini_exporter_v2_initialized: true });
}
