/** Runtime invalidation only: UI rereads committed L3a facts; no Domain payload crosses this channel. */
export function notifyDomainChanged(accountId: string): void {
    try {
        if (typeof chrome === 'undefined' || typeof chrome.runtime?.sendMessage !== 'function') return;
        void Promise.resolve(chrome.runtime.sendMessage({ action: 'domainChanged', accountId })).catch(() => {});
    } catch { /* No open extension view is a normal outcome after a successful commit. */ }
}
