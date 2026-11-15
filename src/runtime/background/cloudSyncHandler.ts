import { defaultCloudSyncEngine } from '../../application/cloud/cloudSyncEngine.js';
import { ensureV2Ready } from './readiness.js';
import { assertExtensionSender, object } from './contentSender.js';
import { startKeepAlive } from './keepAlive.js';

let initialized = false;

/** Subscribe Background L2 commits to the durable Cloud Sync outbox once per Worker lifetime. */
export function initCloudSyncBackground(): void {
    if (initialized) return;
    initialized = true;
    defaultCloudSyncEngine.installAutoEnqueueListener();
}

/**
 * Extension-page-only IPC port (Options / Popup; never web Content Scripts)
 * allowing foreground actions to hand off background outbox flushes to the Worker.
 */
export function handleCloudSyncMessage(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (value: unknown) => void,
): boolean {
    if (!message || typeof message !== 'object' || !('action' in message) || message.action !== 'cloudSyncControl') {
        return false;
    }
    void (async () => {
        try {
            assertExtensionSender(sender);
            if (sender.tab) {
                throw new Error('Cloud Sync control IPC is restricted to extension pages');
            }
            await ensureV2Ready();
            const req = object(message);
            const stopKeepAlive = startKeepAlive();
            try {
                if (req.command === 'flushOutbox') {
                    const result = await defaultCloudSyncEngine.flushOutbox();
                    respond({ ok: true, result });
                    return;
                }
                if (req.command === 'syncNow') {
                    const result = await defaultCloudSyncEngine.syncNow();
                    respond({ ok: true, result });
                    return;
                }
                if (req.command === 'status') {
                    const result = await defaultCloudSyncEngine.getStatusSnapshot();
                    respond({ ok: true, result });
                    return;
                }
                throw new TypeError('Unknown cloudSyncControl command');
            } finally {
                stopKeepAlive();
            }
        } catch (error) {
            respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    })();
    return true;
}
