import { getOrCreateAccount } from '../api/accountRegistry.js';
import { hasChatGPTAccess, ensureChatGPTRegistered, requestChatGPTAccess } from '../../l1/client/chatgpt/chatgptAccess.js';
import { chatgptAccountObservation } from '../../l1/client/chatgpt/accountObservation.js';
import type { Account } from '../../l2/accountRegistry.js';
import { syncChatGPTContentScripts } from './chatgptInjection.js';

/** Called directly by the Connect button, preserving its user gesture. */
export function requestChatGPTConnection(): Promise<boolean> { return requestChatGPTAccess(); }

/** Optional host access is granted explicitly in Options; discovery never prompts. */
export async function discoverChatGPTAccounts(): Promise<Account[]> {
    if (!await hasChatGPTAccess()) return [];
    const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
    if (!tabs.length) return [];
    const response = await fetch('https://chatgpt.com/api/auth/session', { credentials: 'include' });
    if (!response.ok) throw new Error(`ChatGPT session failed: ${response.status}`);
    const session: unknown = await response.json();
    const observation = chatgptAccountObservation(session);
    if (!observation || !session || typeof session !== 'object'
        || !('accessToken' in session) || typeof session.accessToken !== 'string' || !session.accessToken) return [];
    await ensureChatGPTRegistered();
    await syncChatGPTContentScripts();
    return [await getOrCreateAccount(observation.providerId, observation.providerAccountId,
        observation.email, observation.displayName)];
}
