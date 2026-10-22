import { chatgptAccountObservation } from '../../l1/client/chatgpt/accountObservation.js';
import { CHATGPT_SOURCE_EVENT, chatGPTConversationId, chatGPTRequest, confirmedChatGPTDeletion } from '../../l1/sniffer/chatgpt/observation.js';
import { parseChatGPTConversation } from '../../l1/parsers/chatgpt/parseConversation.js';
import type { ChatGPTApiConversationWithId } from '../../l1/parsers/chatgpt/chatgptTypes.js';
import { getOrCreateAccount } from '../api/accountRegistry.js';
import { ingestDetail, ingestDeletedConversation } from '../api/domainIngestion.js';

async function currentAccount() {
    const response = await fetch('/api/auth/session', { credentials: 'include' });
    const observation = response.ok ? chatgptAccountObservation(await response.json()) : null;
    return observation ? getOrCreateAccount('chatgpt', observation.providerAccountId, observation.email, observation.displayName) : null;
}
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object' || !('action' in message)) return false;
    if (message.action !== 'getAccountContext' && message.action !== 'ping') return false;
    void currentAccount().then(account => {
        const id = location.pathname.split('/c/')[1]?.split('/')[0];
        respond({ ok: true, accountContext: account ? { accountId: account.id, providerId: 'chatgpt' } : null,
            conversationId: chatGPTConversationId(id) ? id : null });
    }).catch(error => respond({ ok: false, error: String(error) }));
    return true;
});

let queue = Promise.resolve();
window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== CHATGPT_SOURCE_EVENT) return;
    const raw: unknown = event.data.payload;
    queue = queue.catch(() => {}).then(async () => {
        if (!raw || typeof raw !== 'object' || !('url' in raw) || typeof raw.url !== 'string'
            || !('kind' in raw) || !('conversationId' in raw) || !chatGPTConversationId(raw.conversationId)
            || !('requestIdentity' in raw) || typeof raw.requestIdentity !== 'string' || !('responseBody' in raw)) return;
        const method = raw.kind === 'detail' ? 'GET' : raw.kind === 'delete' ? ('method' in raw && raw.method === 'DELETE' ? 'DELETE' : 'PATCH') : raw.kind === 'stream' ? 'POST' : '';
        const request = chatGPTRequest(raw.url, method);
        if (!request || request.conversationId && request.conversationId !== raw.conversationId) return;
        const account = await currentAccount();
        if (!account || account.providerAccountId !== raw.requestIdentity) return;
        const key = { accountId: account.id, conversationId: raw.conversationId };
        if (request.kind === 'delete') {
            if ('requestBody' in raw && confirmedChatGPTDeletion(raw.requestBody, raw.responseBody, method)) await ingestDeletedConversation(account.id, key.conversationId);
            return;
        }
        if (request.kind === 'detail') {
            if (!raw.responseBody || typeof raw.responseBody !== 'object' || Array.isArray(raw.responseBody)) return;
            const body = raw.responseBody;
            if ('id' in body && body.id !== key.conversationId || 'conversation_id' in body && body.conversation_id !== key.conversationId) return;
            const parsed = parseChatGPTConversation({ account, conversation: { ...body, id: key.conversationId } as ChatGPTApiConversationWithId, assetsByNode: new Map() });
            const admission = await ingestDetail(account.id, key.conversationId, parsed.conversation.detail, parsed.conversation.index);
            if (!admission.accepted || !admission.changed) return;
        }
        // The worker rechecks the sending document's current Account. A stream
        // completion refreshes through the production provider before saving.
        const response: unknown = await chrome.runtime.sendMessage({ action: 'runLiveSave', key, refreshDetail: request.kind === 'stream' });
        if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true) throw new Error('ChatGPT source refresh/Live Save failed');
    }).catch(error => console.warn('[ChatGPT capture]', error));
});
