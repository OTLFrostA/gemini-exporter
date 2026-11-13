import { claudeUuid } from '../../l1/sniffer/claude/observation.js';
import { initClaudeMessageBridge } from '../../l1/sniffer/claude/messageBridge.js';
import { observeClaudeAccount } from '../../l1/client/claude/accountObservation.js';
import { ensureContentReady } from '../api/contentReady.js';
import { resolveCurrentAccount, invalidateAccountContext, setAccountChangedHandler } from './accountContext.js';
import { BadgeView } from '../../ui/badge/badgeView.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { registerCleanup, runCleanups } from './cleanupRegistry.js';
import { hookHistoryEvents } from './pageObserver.js';
import { readContentSettings } from '../api/contentSettings.js';
import { createClaudeVisitSave } from './claudeVisitSave.js';

runCleanups();
invalidateAccountContext();
let active = true;
registerCleanup(() => { active = false; invalidateAccountContext(); });
LiveSaveCoordinator.init({ badge: BadgeView });
registerCleanup(LiveSaveCoordinator.cleanup);
const refreshAccount = () => { void BadgeView.refreshAccount().catch(error => console.warn('[Claude badge]', error)); };
const visitSave = createClaudeVisitSave({
    path: () => location.pathname,
    settings: readContentSettings,
    account: currentAccount,
    save: LiveSaveCoordinator.executeLiveSave,
});
let visitTimer: ReturnType<typeof setTimeout> | undefined;
function routeChanged() {
    refreshAccount();
    visitSave.observe(location.pathname);
    clearTimeout(visitTimer);
    visitTimer = setTimeout(() => { if (active) void visitSave.save().catch(error => console.warn('[Claude visit save]', error)); }, 750);
}
setAccountChangedHandler(routeChanged);
hookHistoryEvents(routeChanged);
registerCleanup(() => clearTimeout(visitTimer));
void ensureContentReady().then(() => {
    const mount = () => { if (active) { BadgeView.ensureBadge(); routeChanged(); } };
    if (document.readyState !== 'loading') mount();
    else {
        document.addEventListener('DOMContentLoaded', mount, { once: true });
        registerCleanup(() => document.removeEventListener('DOMContentLoaded', mount));
    }
}).catch(error => console.warn('[Claude initialization]', error));

async function currentAccount() {
    const observation = await observeClaudeAccount();
    const context = await resolveCurrentAccount(observation);
    return context && observation ? { ...observation, id: context.accountId } : null;
}

const onMessage = (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object' || !('action' in message)) return false;
    if (message.action !== 'getAccountContext' && message.action !== 'ping') return false;
    void currentAccount().then(account => {
        const id = location.pathname.split('/chat/')[1]?.split('/')[0];
        respond({ ok: true, accountContext: account ? { accountId: account.id, providerId: 'claude' } : null,
            conversationId: claudeUuid(id) ? id : null });
    }).catch(error => respond({ ok: false, error: String(error) }));
    return true;
};
chrome.runtime.onMessage.addListener(onMessage);
registerCleanup(() => chrome.runtime.onMessage.removeListener(onMessage));

initClaudeMessageBridge({
    isActive: () => active,
    currentAccount,
    onNativeDetailAccepted: cid => visitSave.nativeDetail(cid),
    onSaveRequested: LiveSaveCoordinator.executeLiveSave,
    registerCleanup,
});
