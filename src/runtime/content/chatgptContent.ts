import { chatgptAccountObservation } from '../../l1/client/chatgpt/accountObservation.js';
import { chatGPTConversationIdFromPath } from '../../l1/sniffer/chatgpt/observation.js';
import { initChatGPTMessageBridge } from '../../l1/sniffer/chatgpt/messageBridge.js';
import { resolveCurrentAccount } from './accountContext.js';
import { registerContentControlRouter } from './controlRouter.js';
import { startContentBootstrap } from './contentBootstrap.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { registerCleanup } from './cleanupRegistry.js';

const { isActive } = startContentBootstrap({ label: 'ChatGPT' });

async function currentAccount() {
    const response = await fetch('/api/auth/session', { credentials: 'include' });
    const observation = response.ok ? chatgptAccountObservation(await response.json()) : null;
    const context = await resolveCurrentAccount(observation);
    return context && observation ? { ...observation, id: context.accountId } : null;
}

registerContentControlRouter({
    providerId: 'chatgpt',
    isActive,
    resolveAccountId: async () => (await currentAccount())?.id ?? null,
    conversationIdFromPath: chatGPTConversationIdFromPath,
});

initChatGPTMessageBridge({
    isActive,
    currentAccount,
    onSaveRequested: LiveSaveCoordinator.executeLiveSave,
    registerCleanup,
});
