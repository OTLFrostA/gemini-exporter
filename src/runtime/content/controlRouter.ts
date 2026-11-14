import { registerCleanup } from './cleanupRegistry.js';
import { getExtensionVersion } from '../../shared/utils/constants.js';
import type { SourcePlatform } from '../../shared/platformHosts.js';

export interface ContentControlRouterOptions {
    readonly providerId: SourcePlatform;
    readonly isActive: () => boolean;
    readonly resolveAccountId: () => Promise<string | null>;
    readonly conversationIdFromPath: (pathname: string) => string | null;
}

/** Shared control-plane IPC handler for isolated content scripts.
 * Answers ping without network I/O and pairs account resolution atomically with the URL snapshot.
 */
export function registerContentControlRouter(options: ContentControlRouterOptions): void {
    const listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void): boolean => {
        if (!message || typeof message !== 'object' || !('action' in message)
            || (message.action !== 'ping' && message.action !== 'getAccountContext')) return false;
        let responded = false;
        const respond = (value: unknown) => {
            if (!responded) {
                responded = true;
                sendResponse(value);
            }
        };
        void (async () => {
            try {
                if (sender.id !== chrome.runtime.id) throw new Error('Foreign extension sender');
                if (!options.isActive()) throw new Error('Content script superseded');
                if (message.action === 'ping') {
                    respond({ ok: true, version: getExtensionVersion() });
                    return;
                }
                const snapshotHref = location.href;
                const snapshotPathname = location.pathname;
                const accountId = await options.resolveAccountId();
                if (!options.isActive() || location.href !== snapshotHref || location.pathname !== snapshotPathname) {
                    throw new Error('Page changed while resolving account');
                }
                const pathname = snapshotHref ? new URL(snapshotHref).pathname : snapshotPathname;
                respond({
                    ok: true,
                    accountContext: accountId ? { accountId, providerId: options.providerId } : null,
                    conversationId: options.conversationIdFromPath(pathname),
                });
            } catch (error) {
                respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
            }
        })();
        return true;
    };
    chrome.runtime.onMessage.addListener(listener);
    registerCleanup(() => chrome.runtime.onMessage.removeListener(listener));
}
