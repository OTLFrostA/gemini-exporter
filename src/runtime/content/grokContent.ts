import { grokConversationIdFromPath } from '../../l1/sniffer/grok/observation.js';
import { initGrokMessageBridge } from '../../l1/sniffer/grok/messageBridge.js';
import { observeGrokAccount } from '../../l1/client/grok/accountObservation.js';
import { ensureContentReady } from '../api/contentReady.js';
import { invalidateAccountContext, resolveCurrentAccount, setAccountChangedHandler } from './accountContext.js';
import { registerContentControlRouter } from './controlRouter.js';
import { BadgeView } from '../../ui/badge/badgeView.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { registerCleanup, runCleanups } from './cleanupRegistry.js';
import { hookHistoryEvents } from './pageObserver.js';
import { readContentSettings, isContentLiveSaveEffective } from '../api/contentSettings.js';

runCleanups();
invalidateAccountContext();
let active = true;
registerCleanup(() => { active = false; invalidateAccountContext(); });
LiveSaveCoordinator.init({ badge: BadgeView });
registerCleanup(LiveSaveCoordinator.cleanup);

async function currentAccount() {
    const observation = await observeGrokAccount();
    const context = await resolveCurrentAccount(observation);
    return context && observation ? { ...observation, id: context.accountId } : null;
}
const conversationId = () => grokConversationIdFromPath(location.pathname);

const bridge = initGrokMessageBridge({
    isActive: () => active,
    currentAccount,
    currentConversationId: conversationId,
    isSaveEnabled: async () => isContentLiveSaveEffective(await readContentSettings(), true),
    onSaveRequested: LiveSaveCoordinator.executeLiveSave,
    registerCleanup,
});

function routeChanged() {
    void BadgeView.refreshAccount().catch(console.warn);
    bridge.onRouteChanged();
}
setAccountChangedHandler(routeChanged);
hookHistoryEvents(routeChanged);
void ensureContentReady().then(() => {
    const mount = () => { if (active) { BadgeView.ensureBadge(); routeChanged(); } };
    if (document.readyState !== 'loading') mount();
    else {
        document.addEventListener('DOMContentLoaded', mount, { once: true });
        registerCleanup(() => document.removeEventListener('DOMContentLoaded', mount));
    }
}).catch(console.warn);

registerContentControlRouter({
    providerId: 'grok',
    isActive: () => active,
    resolveAccountId: async () => (await currentAccount())?.id ?? null,
    conversationIdFromPath: grokConversationIdFromPath,
});
