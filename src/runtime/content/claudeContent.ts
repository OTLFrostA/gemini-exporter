import { claudeConversationIdFromPath } from '../../l1/sniffer/claude/observation.js';
import { initClaudeMessageBridge } from '../../l1/sniffer/claude/messageBridge.js';
import { observeClaudeAccount } from '../../l1/client/claude/accountObservation.js';
import { resolveCurrentAccount } from './accountContext.js';
import { registerContentControlRouter } from './controlRouter.js';
import { startContentBootstrap } from './contentBootstrap.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { registerCleanup } from './cleanupRegistry.js';
import { readContentSettings } from '../api/contentSettings.js';
import { createClaudeVisitSave } from './claudeVisitSave.js';

async function currentAccount() {
    const observation = await observeClaudeAccount();
    const context = await resolveCurrentAccount(observation);
    return context && observation ? { ...observation, id: context.accountId } : null;
}

const visitSave = createClaudeVisitSave({
    path: () => location.pathname,
    settings: readContentSettings,
    account: currentAccount,
    save: LiveSaveCoordinator.executeLiveSave,
});
let visitTimer: ReturnType<typeof setTimeout> | undefined;
let isActiveRef: () => boolean = () => false;
function scheduleVisitSave() {
    visitSave.observe(location.pathname);
    clearTimeout(visitTimer);
    visitTimer = setTimeout(() => {
        if (isActiveRef()) void visitSave.save().catch(error => console.warn('[Claude visit save]', error));
    }, 750);
}

const { isActive } = startContentBootstrap({
    label: 'Claude',
    onRouteOrAccountChanged: scheduleVisitSave,
    onMounted: scheduleVisitSave,
});
isActiveRef = isActive;
registerCleanup(() => clearTimeout(visitTimer));

registerContentControlRouter({
    providerId: 'claude',
    isActive,
    resolveAccountId: async () => (await currentAccount())?.id ?? null,
    conversationIdFromPath: claudeConversationIdFromPath,
});

initClaudeMessageBridge({
    isActive,
    currentAccount,
    onNativeDetailAccepted: cid => visitSave.nativeDetail(cid),
    onSaveRequested: LiveSaveCoordinator.executeLiveSave,
    registerCleanup,
});
