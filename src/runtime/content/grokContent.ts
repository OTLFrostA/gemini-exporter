import { grokUuid } from '../../l1/parsers/grok/source.js';
import { initGrokMessageBridge } from '../../l1/sniffer/grok/messageBridge.js';
import { observeGrokAccount } from '../../l1/client/grok/accountObservation.js';
import { ensureContentReady } from '../api/contentReady.js';
import { invalidateAccountContext, resolveCurrentAccount, setAccountChangedHandler } from './accountContext.js';
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
const conversationId = () => {
    const id = /^\/c\/([^/]+)\/?$/.exec(location.pathname)?.[1];
    return grokUuid(id) ? id : null;
};

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

const onMessage = (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object' || !('action' in message)
        || !['ping', 'getAccountContext'].includes(String(message.action))) return false;
    void currentAccount().then(account => respond({ ok: true,
        accountContext: account ? { accountId: account.id, providerId: 'grok' } : null, conversationId: conversationId() }))
        .catch(error => respond({ ok: false, error: String(error) }));
    return true;
};
chrome.runtime.onMessage.addListener(onMessage);
registerCleanup(() => chrome.runtime.onMessage.removeListener(onMessage));
