import { defaultCloudSyncEngine } from '../../application/vault/cloudSyncEngine.js';
import { isAccountId } from '../../l2/accountRegistry.js';

let initialized = false;

/** Subscribe Background L2 commits to the durable Cloud Sync outbox once per Worker lifetime. */
export function initCloudSyncBackground(): void {
    if (initialized) return;
    initialized = true;
    defaultCloudSyncEngine.installAutoEnqueueListener();
}

/** Trigger background outbox reconciliation when an extension context broadcasts `domainChanged`. */
export function handleCloudSyncMessage(message: unknown, sender?: chrome.runtime.MessageSender): void {
    if (!sender || sender.id !== chrome.runtime.id) {
        return;
    }
    const extOrigin = typeof chrome.runtime?.getURL === 'function' ? chrome.runtime.getURL('') : `chrome-extension://${chrome.runtime.id}/`;
    const fromExtensionOrigin = typeof sender.url === 'string' && sender.url.startsWith(extOrigin);
    if (!fromExtensionOrigin && sender.tab) {
        return;
    }
    if (sender.url && !fromExtensionOrigin) {
        return;
    }
    if (!message || typeof message !== 'object' || !('action' in message)) {
        return;
    }
    if (message.action === 'domainChanged' && 'accountId' in message && isAccountId(message.accountId)) {
        const accountId = message.accountId;
        void defaultCloudSyncEngine.reconcilePostToggleAccount(accountId).catch(error => {
            console.warn('[CloudSync] Post-toggle reconciliation failed:', error);
        });
    }
}
