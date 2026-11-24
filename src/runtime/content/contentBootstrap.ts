import { ensureContentReady } from '../api/contentReady.js';
import { invalidateAccountContext, setAccountChangedHandler } from './accountContext.js';
import { contentBadge } from './badgePort.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { registerCleanup, runCleanups } from './cleanupRegistry.js';
import { hookHistoryEvents } from './pageObserver.js';
import { installContentRuntimeHost } from './installContentHost.js';

interface ContentBootstrapOptions {
    readonly label: string;
    readonly beforeRouteHooks?: (isActive: () => boolean) => void;
    readonly onRouteOrAccountChanged?: () => void;
    readonly onMounted?: () => void;
}

/** Shared isolated-world lifecycle harness across all four AI platform content scripts. */
export function startContentBootstrap(options: ContentBootstrapOptions): { isActive: () => boolean } {
    installContentRuntimeHost();
    runCleanups();
    invalidateAccountContext();
    let active = true;
    const isActive = () => active;
    registerCleanup(() => { active = false; invalidateAccountContext(); });
    const badge = contentBadge();
    LiveSaveCoordinator.init({ badge });
    registerCleanup(LiveSaveCoordinator.cleanup);

    options.beforeRouteHooks?.(isActive);

    const handleRouteOrAccountChange = () => {
        if (badge) void badge.refreshAccount().catch(error => console.warn(`[${options.label} badge]`, error));
        options.onRouteOrAccountChanged?.();
    };
    setAccountChangedHandler(handleRouteOrAccountChange);
    hookHistoryEvents(handleRouteOrAccountChange);

    void ensureContentReady().then(() => {
        if (!active) return;
        const mount = () => {
            if (!active) return;
            badge?.ensureBadge();
            options.onMounted?.();
        };
        if (document.readyState !== 'loading') mount();
        else {
            document.addEventListener('DOMContentLoaded', mount, { once: true });
            registerCleanup(() => document.removeEventListener('DOMContentLoaded', mount));
        }
        registerCleanup(() => document.getElementById('geminiExportBadge')?.remove());
    }).catch(error => console.warn(`[${options.label} initialization]`, error));

    return { isActive };
}
