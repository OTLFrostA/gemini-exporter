import { handleDomainIngestionMessage } from './domainStorageHandler.js';
import { handleAccountRegistryMessage } from './accountRegistryHandler.js';
import { initSessionAccessLevel, initUninstallUrl, initLifecycleListeners } from './lifecycle.js';
import { initTabActionListeners } from './tabAction.js';
import { ensureV2Ready } from './readiness.js';
import { assertExtensionSender, object, requireCurrentContentAccount } from './contentSender.js';
import { listIndexes } from '../core/storage/storageService.js';
import { readConversationKey } from '../core/domain/conversationKey.js';
import { runLiveSave } from './liveSaveHandler.js';

initSessionAccessLevel();
initLifecycleListeners();
initUninstallUrl();
initTabActionListeners();

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (handleDomainIngestionMessage(message, sender, respond)) return true;
    if (handleAccountRegistryMessage(message, sender, respond)) return true;
    if (!message || typeof message !== 'object' || !('action' in message)
        || !['ensureV2Ready', 'getLocalIndexCount', 'runLiveSave', 'openOptions', 'openGeminiPage', 'reloadGeminiTab'].includes(String(message.action))) return false;
    void (async () => {
        try {
            assertExtensionSender(sender);
            const request = object(message);
            if (request.action === 'openOptions') { await chrome.runtime.openOptionsPage(); respond({ ok: true }); return; }
            if (request.action === 'openGeminiPage') {
                const tab = await chrome.tabs.create({ url: 'https://gemini.google.com/app' });
                respond({ ok: true, tabId: tab.id }); return;
            }
            if (request.action === 'reloadGeminiTab') {
                if (typeof request.tabId !== 'number') throw new TypeError('Expected target Tab ID');
                const tab = await chrome.tabs.get(request.tabId);
                if (!tab.url || new URL(tab.url).origin !== 'https://gemini.google.com') throw new Error('Not a Gemini Tab');
                await chrome.tabs.reload(request.tabId); respond({ ok: true }); return;
            }
            await ensureV2Ready();
            if (request.action === 'ensureV2Ready') { respond({ ok: true }); return; }
            const key = request.action === 'runLiveSave' ? readConversationKey(request.key) : null;
            const account = await requireCurrentContentAccount(sender, key ? key.accountId : request.accountId);
            if (key) respond({ ok: true, result: await runLiveSave(key) });
            else respond({ ok: true, count: (await listIndexes(account.id)).length });
        } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
    })();
    return true;
});
