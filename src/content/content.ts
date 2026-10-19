import { ensureV2Ready } from '../core/api/runtimeReady.js';
import { initBootstrap } from './bootstrap.js';
import { MessageRouter } from './messageRouter.js';
import { MessageBridge } from './messageBridge.js';
import { BadgeView } from './badgeView.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { invalidateAccountContext } from './accountContext.js';
import { runCleanups, registerCleanup } from './cleanupRegistry.js';

if (typeof window !== 'undefined') {
    runCleanups();
    invalidateAccountContext();
    let active = true;
    registerCleanup(() => { active = false; invalidateAccountContext(); });
    initBootstrap();
    MessageRouter.init();
    LiveSaveCoordinator.init({ badge: BadgeView });
    registerCleanup(LiveSaveCoordinator.cleanup);
    MessageBridge.init({ onDetailChanged: key => {
        void LiveSaveCoordinator.executeLiveSave(key).catch(error => console.warn('[Runtime] Live Save failed', error));
    } });
    // Capture source events at document_start; their L2/Registry ports await readiness.
    void ensureV2Ready().then(() => {
        if (!active) return;
        const mountBadge = () => {
            if (active) BadgeView.ensureBadge({ onClick: () => { void chrome.runtime.sendMessage({ action: 'openOptions' }); } });
        };
        if (document.readyState !== 'loading') mountBadge();
        else {
            document.addEventListener('DOMContentLoaded', mountBadge, { once: true });
            registerCleanup(() => document.removeEventListener('DOMContentLoaded', mountBadge));
        }
        registerCleanup(() => document.getElementById('geminiExportBadge')?.remove());
    }).catch(error => console.error('[Runtime] Content initialization failed', error));
}
