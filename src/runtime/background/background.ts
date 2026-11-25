import { installApplicationHost } from '../api/applicationHost.js';
import { installDomainStorage } from '../api/domainStorage.js';

import { syncAllPlatformContentScripts } from '../capabilities/platformInjection.js';
import { installProviderHost } from '../api/providerHost.js';
import { handleDomainIngestionMessage } from './domainStorageHandler.js';
import { handleAccountRegistryMessage } from './accountRegistryHandler.js';
import { initCloudSyncBackground, handleCloudSyncMessage } from './cloudSyncHandler.js';
import { initBackgroundDiagnosticCapture, handleDiagnosticMessage, recordBackgroundDiagnostic } from './diagnosticBuffer.js';
import { initSessionAccessLevel, initUninstallUrl, initLifecycleListeners } from './lifecycle.js';
import { initGeminiCredentialCapture } from './geminiCredentialCapture.js';
import { initTabActionListeners } from './tabAction.js';
import { ensureV2Ready } from './readiness.js';
import { assertContentSender, assertExtensionSender, object, requireCurrentContentAccount } from './contentSender.js';
import { getAccount, listIndexes } from '../../l3a/storageService.js';
import { isAccountId } from '../../l2/accountRegistry.js';
import { readConversationKey } from '../../l2/conversationKey.js';
import { runLiveSave } from './liveSaveHandler.js';
import { updateSettings } from '../../application/settings/index.js';

installDomainStorage();
installApplicationHost();
installProviderHost();

initSessionAccessLevel();
initBackgroundDiagnosticCapture();
initLifecycleListeners();
initUninstallUrl();
initTabActionListeners();
initGeminiCredentialCapture();
initCloudSyncBackground();
const syncSourceAccess = () => { void syncAllPlatformContentScripts().catch(error => console.warn('[Platform injection]', error)); };
syncSourceAccess();
chrome.permissions?.onAdded?.addListener(syncSourceAccess);
chrome.permissions?.onRemoved?.addListener(syncSourceAccess);

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (handleDiagnosticMessage(message, sender, respond)) return true;
    if (handleDomainIngestionMessage(message, sender, respond)) return true;
    if (handleAccountRegistryMessage(message, sender, respond)) return true;
    handleCloudSyncMessage(message, sender);
    if (!message || typeof message !== 'object' || !('action' in message)
        || !['ensureV2Ready', 'getLocalIndexCount', 'updateBadgePosition', 'runLiveSave', 'openOptions', 'openGeminiPage', 'reloadGeminiTab'].includes(String(message.action))) return false;
    void (async () => {
        try {
            assertExtensionSender(sender);
            const request = object(message);
            if (request.action === 'openOptions') {
                let accountId: string | null = null;
                if (request.accountId != null) {
                    if (!isAccountId(request.accountId)) throw new TypeError('Expected Account UUID');
                    await ensureV2Ready();
                    if (sender.tab) {
                        // A tab can navigate during the click; never select its stale account.
                        try { accountId = (await requireCurrentContentAccount(sender, request.accountId)).id; }
                        catch { accountId = null; }
                    } else {
                        accountId = (await getAccount(request.accountId))?.id ?? null;
                    }
                }
                // Session-only handoff works for both newly opened and already open Options tabs.
                await chrome.storage.session.set({ openOptionsAccountId: accountId });
                await chrome.runtime.openOptionsPage();
                respond({ ok: true }); return;
            }
            if (request.action === 'openGeminiPage') {
                const extOrigin = typeof chrome.runtime?.getURL === 'function' ? chrome.runtime.getURL('') : `chrome-extension://${chrome.runtime.id}/`;
                if (sender.tab && !(typeof sender.url === 'string' && sender.url.startsWith(extOrigin))) throw new Error('Extension page required');
                const tab = await chrome.tabs.create({ url: 'https://gemini.google.com/app' });
                respond({ ok: true, tabId: tab.id }); return;
            }
            if (request.action === 'reloadGeminiTab') {
                const extOrigin = typeof chrome.runtime?.getURL === 'function' ? chrome.runtime.getURL('') : `chrome-extension://${chrome.runtime.id}/`;
                if (sender.tab && !(typeof sender.url === 'string' && sender.url.startsWith(extOrigin))) throw new Error('Extension page required');
                if (typeof request.tabId !== 'number') throw new TypeError('Expected target Tab ID');
                const tab = await chrome.tabs.get(request.tabId);
                if (!tab.url || new URL(tab.url).origin !== 'https://gemini.google.com') throw new Error('Not a Gemini Tab');
                await chrome.tabs.reload(request.tabId); respond({ ok: true }); return;
            }
            await ensureV2Ready();
            if (request.action === 'ensureV2Ready') { respond({ ok: true }); return; }
            if (request.action === 'updateBadgePosition') {
                assertContentSender(sender);
                const position = object(request.position);
                if (Object.keys(position).some(key => key !== 'left' && key !== 'top')
                    || typeof position.left !== 'number' || !Number.isFinite(position.left)
                    || typeof position.top !== 'number' || !Number.isFinite(position.top)) {
                    throw new TypeError('Expected finite Badge position coordinates');
                }
                await updateSettings({ badgePosition: { left: position.left, top: position.top } });
                respond({ ok: true }); return;
            }
            const key = request.action === 'runLiveSave' ? readConversationKey(request.key) : null;
            const account = await requireCurrentContentAccount(sender, key ? key.accountId : request.accountId);
            if (request.refreshDetail !== undefined && typeof request.refreshDetail !== 'boolean') throw new TypeError('Expected refreshDetail boolean');
            if (key) respond({ ok: true, result: await runLiveSave(key, request.refreshDetail === true) });
            else respond({ ok: true, count: (await listIndexes(account.id)).length });
        } catch (error) {
            recordBackgroundDiagnostic({
                source: 'background',
                severity: 'error',
                code: 'BACKGROUND_MESSAGE_FAILED',
                message: error instanceof Error ? error.message : String(error),
                details: { action: message && typeof message === 'object' && 'action' in message ? String(Reflect.get(message, 'action')) : null },
                error,
                ...(typeof sender.tab?.url === 'string' ? { tabUrl: sender.tab.url } : {}),
            });
            respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    })();
    return true;
});
