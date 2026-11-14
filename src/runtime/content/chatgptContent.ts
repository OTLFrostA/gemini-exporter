import { chatgptAccountObservation } from '../../l1/client/chatgpt/accountObservation.js';
import { chatGPTConversationIdFromPath } from '../../l1/sniffer/chatgpt/observation.js';
import { initChatGPTMessageBridge } from '../../l1/sniffer/chatgpt/messageBridge.js';
import { ensureContentReady } from '../api/contentReady.js';
import { resolveCurrentAccount, invalidateAccountContext, setAccountChangedHandler } from './accountContext.js';
import { registerContentControlRouter } from './controlRouter.js';
import { BadgeView } from '../../ui/badge/badgeView.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { registerCleanup, runCleanups } from './cleanupRegistry.js';
import { hookHistoryEvents } from './pageObserver.js';

runCleanups();
invalidateAccountContext();
let active = true;
registerCleanup(() => { active = false; invalidateAccountContext(); });
LiveSaveCoordinator.init({ badge: BadgeView });
registerCleanup(LiveSaveCoordinator.cleanup);
const refreshAccount = () => { void BadgeView.refreshAccount().catch(error => console.warn('[ChatGPT badge]', error)); };
setAccountChangedHandler(refreshAccount);
hookHistoryEvents(refreshAccount);
void ensureContentReady().then(() => {
    const mount = () => { if (active) BadgeView.ensureBadge(); };
    if (document.readyState !== 'loading') mount();
    else {
        document.addEventListener('DOMContentLoaded', mount, { once: true });
        registerCleanup(() => document.removeEventListener('DOMContentLoaded', mount));
    }
}).catch(error => console.warn('[ChatGPT initialization]', error));

async function currentAccount() {
    const response = await fetch('/api/auth/session', { credentials: 'include' });
    const observation = response.ok ? chatgptAccountObservation(await response.json()) : null;
    const context = await resolveCurrentAccount(observation);
    return context && observation ? { ...observation, id: context.accountId } : null;
}

registerContentControlRouter({
    providerId: 'chatgpt',
    isActive: () => active,
    resolveAccountId: async () => (await currentAccount())?.id ?? null,
    conversationIdFromPath: chatGPTConversationIdFromPath,
});

initChatGPTMessageBridge({
    isActive: () => active,
    currentAccount,
    onSaveRequested: LiveSaveCoordinator.executeLiveSave,
    registerCleanup,
});
