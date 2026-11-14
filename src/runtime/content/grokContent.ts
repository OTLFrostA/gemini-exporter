import { grokConversationIdFromPath } from '../../l1/sniffer/grok/observation.js';
import { initGrokMessageBridge } from '../../l1/sniffer/grok/messageBridge.js';
import { observeGrokAccount } from '../../l1/client/grok/accountObservation.js';
import { resolveCurrentAccount } from './accountContext.js';
import { registerContentControlRouter } from './controlRouter.js';
import { startContentBootstrap } from './contentBootstrap.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { registerCleanup } from './cleanupRegistry.js';
import { readContentSettings, isContentLiveSaveEffective } from '../api/contentSettings.js';

async function currentAccount() {
    const observation = await observeGrokAccount();
    const context = await resolveCurrentAccount(observation);
    return context && observation ? { ...observation, id: context.accountId } : null;
}
const conversationId = () => grokConversationIdFromPath(location.pathname);

let notifyRouteChanged: (() => void) | undefined;
const { isActive } = startContentBootstrap({
    label: 'Grok',
    onRouteOrAccountChanged: () => notifyRouteChanged?.(),
    onMounted: () => notifyRouteChanged?.(),
});

const bridge = initGrokMessageBridge({
    isActive,
    currentAccount,
    currentConversationId: conversationId,
    isSaveEnabled: async () => isContentLiveSaveEffective(await readContentSettings(), true),
    onSaveRequested: LiveSaveCoordinator.executeLiveSave,
    registerCleanup,
});
notifyRouteChanged = bridge.onRouteChanged;

registerContentControlRouter({
    providerId: 'grok',
    isActive,
    resolveAccountId: async () => (await currentAccount())?.id ?? null,
    conversationIdFromPath: grokConversationIdFromPath,
});
