import { claudeConversationIdFromPath, claudeUuid } from '../../l1/sniffer/claude/observation.js';
import { initClaudeMessageBridge } from '../../l1/sniffer/claude/messageBridge.js';
import { observeClaudeAccount } from '../../l1/client/claude/accountObservation.js';
import { contentRuntimeHost } from '../../l1/contentPorts.js';
import { resolveCurrentAccount, configureAccountAdapter } from './accountContext.js';
import { createClaudeAccountAdapter } from './adapters/claudeAccountAdapter.js';
import { registerContentControlRouter } from './controlRouter.js';
import { startContentBootstrap } from './contentBootstrap.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { registerCleanup } from './cleanupRegistry.js';
import { readContentSettings } from '../api/contentSettings.js';
import { createClaudeVisitSave } from './claudeVisitSave.js';

configureAccountAdapter(createClaudeAccountAdapter());

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

// Initial history can be server-rendered, without a list request. Visible links
// prove only these index rows; they do not establish time ordering or Coverage.
let sidebarTimer: ReturnType<typeof setTimeout> | undefined;
let sidebarSignature = '';
const captureSidebar = async () => {
    const rows = [...document.querySelectorAll<HTMLAnchorElement>('a[data-row-main-button][href*="/chat/"],nav a[href*="/chat/"],aside a[href*="/chat/"]')]
        .map(a => ({ id: new URL(a.href).pathname.split('/chat/')[1], title: a.textContent?.trim() }))
        .filter((row): row is { id: string; title: string } => claudeUuid(row.id) && !!row.title);
    const signature = JSON.stringify(rows);
    if (!rows.length || signature === sidebarSignature) return;
    const account = await currentAccount();
    if (!account || !isActive()) return;
    await contentRuntimeHost().ingestion.ingestIndexes(account.id, [...new Map(rows.map(row => [row.id, row])).values()].map(row => ({
        conversationId: row.id, fields: { title: row.title, titleSource: 'provider' as const },
    })));
    sidebarSignature = signature;
};
const sidebarObserver = new MutationObserver(() => {
    clearTimeout(sidebarTimer);
    sidebarTimer = setTimeout(() => { void captureSidebar().catch(console.warn); }, 500);
});
sidebarObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
void captureSidebar().catch(console.warn);
registerCleanup(() => { sidebarObserver.disconnect(); clearTimeout(sidebarTimer); });
