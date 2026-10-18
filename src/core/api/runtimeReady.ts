/** Extension pages and Content await the same worker readiness boundary. */
export async function ensureV2Ready(): Promise<void> {
    if (typeof location !== 'undefined' && location.protocol === 'chrome-extension:') await initializeExtensionProviders();
    const response: unknown = await chrome.runtime.sendMessage({ action: 'ensureV2Ready' });
    if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true) {
        throw new Error(response && typeof response === 'object' && 'error' in response ? String(response.error) : 'Runtime unavailable');
    }
}

/** Register production L1 in each executing Extension Context, independent of UI imports. */
export async function initializeExtensionProviders(): Promise<void> {
    const [{ ProviderRegistry }, { defaultGeminiProvider }] = await Promise.all([
        import('../provider/providerRegistry.js'), import('../provider/gemini/geminiProvider.js'),
    ]);
    ProviderRegistry.register(defaultGeminiProvider);
}
