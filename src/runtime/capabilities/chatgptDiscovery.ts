import { hasChatGPTAccess, ensureChatGPTRegistered } from '../../l1/client/chatgpt/chatgptAccess.js';
import { readChatGPTSession } from '../../l1/client/chatgpt/accountObservation.js';
import type { Account } from '../../l2/accountRegistry.js';
import { PLATFORM_HOSTS } from '../../shared/platformHosts.js';
import { admitDiscoveredPlatformAccounts } from './platformDiscovery.js';

/** Optional host access is granted explicitly in Options; discovery never prompts. */
export async function discoverChatGPTAccounts(): Promise<Account[]> {
    return admitDiscoveredPlatformAccounts({
        platform: 'chatgpt',
        hasAccess: hasChatGPTAccess,
        ensureRegistered: ensureChatGPTRegistered,
        discover: async () => {
            const tabs = await chrome.tabs.query({ url: [...PLATFORM_HOSTS.chatgpt.pages] });
            if (!tabs.length) return [];
            const response = await fetch('https://chatgpt.com/api/auth/session', { credentials: 'include' });
            if (!response.ok) throw new Error(`ChatGPT session failed: ${response.status}`);
            const session: unknown = await response.json();
            const { observation, accessToken } = readChatGPTSession(session);
            if (!observation || !accessToken) return [];
            return [{
                providerAccountId: observation.providerAccountId,
                email: observation.email,
                displayName: observation.displayName,
            }];
        },
    });
}
