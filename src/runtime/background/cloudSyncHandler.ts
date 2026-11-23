import { defaultCloudSyncEngine } from '../../application/vault/cloudSyncEngine.js';

let initialized = false;

/** Subscribe Background L2 commits to the durable Cloud Sync outbox once per Worker lifetime. */
export function initCloudSyncBackground(): void {
    if (initialized) return;
    initialized = true;
    defaultCloudSyncEngine.installAutoEnqueueListener();
}

/** Trigger background outbox reconciliation when an extension context broadcasts `domainChanged`. */
export function handleCloudSyncMessage(message: unknown): boolean {
    if (!message || typeof message !== 'object' || !('action' in message)) {
        return false;
    }
    if (message.action === 'domainChanged' && 'accountId' in message && typeof message.accountId === 'string') {
        const accountId = message.accountId;
        void defaultCloudSyncEngine.reconcilePostToggleAccount(accountId).catch(error => {
            console.warn('[CloudSync] Post-toggle reconciliation failed:', error);
        });
    }
    return false;
}
