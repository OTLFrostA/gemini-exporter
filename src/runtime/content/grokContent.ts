import { grokConversationIdFromPath } from '../../l1/sniffer/grok/observation.js';
import { initGrokMessageBridge } from '../../l1/sniffer/grok/messageBridge.js';
import { observeGrokAccount } from '../../l1/client/grok/accountObservation.js';
import { resolveCurrentAccount, configureAccountAdapter } from './accountContext.js';
import { createGrokAccountAdapter } from './adapters/grokAccountAdapter.js';
import { registerContentControlRouter } from './controlRouter.js';
import { startContentBootstrap } from './contentBootstrap.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { registerCleanup } from './cleanupRegistry.js';
import { readContentSettings, isContentAutoCaptureEnabled } from '../api/contentSettings.js';

configureAccountAdapter(createGrokAccountAdapter());

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
    isSaveEnabled: async () => isContentAutoCaptureEnabled(await readContentSettings(), true),
    onSaveRequested: LiveSaveCoordinator.executeLiveSave,
    registerCleanup,
});
notifyRouteChanged = bridge.onRouteChanged;

let mutationTimer: ReturnType<typeof setTimeout> | undefined;
let responseSignature = '';
const responseObserver = new MutationObserver(records => {
    if (!records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        return target && !target.closest('#geminiExportBadge,[contenteditable="true"],textarea');
    })) return;
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
        if (!isActive()) return;
        const id = conversationId();
        const next = id + ':' + [...document.querySelectorAll('[id^="response-"]')]
            .map(element => [element.textContent, [...element.querySelectorAll('img')].map(img => img.src).join(',')].join(':')).join('\n');
        if (!id || next === responseSignature) return;
        responseSignature = next;
        void currentAccount().then(account => {
            if (isActive() && account && conversationId() === id) bridge.scheduleSave(id, account.providerAccountId);
        }).catch(console.warn);
    }, 1500);
});
responseObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
registerCleanup(() => { responseObserver.disconnect(); clearTimeout(mutationTimer); });

registerContentControlRouter({
    providerId: 'grok',
    isActive,
    resolveAccountId: async () => (await currentAccount())?.id ?? null,
    conversationIdFromPath: grokConversationIdFromPath,
});
