import { ensureV2Ready } from '../core/api/runtimeReady.js';
import { initBootstrap } from './bootstrap.js';
import { MessageRouter } from './messageRouter.js';
import { MessageBridge } from './messageBridge.js';
import { BadgeView } from './badgeView.js';
import { LiveSaveObserver } from './liveSaveObserver.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { invalidateAccountContext } from './accountContext.js';
import { runCleanups, registerCleanup } from './cleanupRegistry.js';

if (typeof window !== 'undefined') {
    runCleanups();
    invalidateAccountContext();
    let active = true;
    registerCleanup(() => { active = false; invalidateAccountContext(); });
    void ensureV2Ready().then(() => {
        if (!active) return;
        initBootstrap();
        MessageRouter.init();
        LiveSaveCoordinator.init({ badge: BadgeView });
        registerCleanup(LiveSaveCoordinator.cleanup);
        LiveSaveObserver.init({ onTurnComplete: (id, reason) => {
            void LiveSaveCoordinator.executeLiveSave(id, reason).catch(error => console.warn('[Runtime] Live Save failed', error));
        } });
        registerCleanup(LiveSaveObserver.cleanup);
        MessageBridge.init({ onStreamStart: LiveSaveObserver.notifyStreamStart,
            onStreamComplete: LiveSaveObserver.notifyStreamComplete });
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
