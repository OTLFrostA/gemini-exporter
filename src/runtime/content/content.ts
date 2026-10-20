import { ensureV2Ready } from '../api/runtimeReady.js';
import { initBootstrap } from '../../l1/client/gemini/bootstrap.js';
import { MessageRouter } from './messageRouter.js';
import { MessageBridge } from '../../l1/sniffer/gemini/messageBridge.js';
import { BadgeView } from '../../ui/badge/badgeView.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { invalidateAccountContext, setAccountChangedHandler } from './accountContext.js';
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
    setAccountChangedHandler(() => { void BadgeView.refreshAccount().catch(error => console.warn('[Runtime] Badge account refresh failed', error)); });
    MessageBridge.init({ onIndexesCommitted: accountId => { void BadgeView.refreshIndexCount(accountId); }, onDetailChanged: key => {
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
