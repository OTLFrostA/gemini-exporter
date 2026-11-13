/** Content-world readiness IPC client. Never imports Worker upgrade or IndexedDB modules. */
export async function ensureContentReady(): Promise<void> {
    const response: unknown = await chrome.runtime.sendMessage({ action: 'ensureV2Ready' });
    if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true) {
        throw new Error(response && typeof response === 'object' && 'error' in response ? String(response.error) : 'Runtime unavailable');
    }
}
