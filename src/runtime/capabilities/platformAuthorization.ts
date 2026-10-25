import { hasPlatformAccess, requestPlatformsAccess } from '../../l1/client/platformAccess.js';
import { PLATFORM_HOSTS, type SourcePlatform } from '../../shared/platformHosts.js';
import { preparePlatformTab, syncPlatformContentScripts } from './platformInjection.js';
import { discoverChatGPTAccounts } from './chatgptDiscovery.js';
import { discoverGrokAccounts } from './grokDiscovery.js';
import { discoverClaudeAccounts } from './claudeDiscovery.js';
import { getAccount } from '../api/accountRegistry.js';
import { sendTabMessage } from './tabService.js';

export { hasPlatformAccess, requestPlatformsAccess as requestPlatformAuthorization };

/** Authorization works without a signed-in tab. Existing documents activate in place. */
export async function activatePlatformAccess(platforms: readonly SourcePlatform[]): Promise<boolean> {
    const results = await Promise.allSettled(platforms.map(async platform => {
        await syncPlatformContentScripts(platform);
        const tabs = await chrome.tabs.query({ url: [...PLATFORM_HOSTS[platform].pages] });
        const activation = await Promise.allSettled(tabs.filter(tab => tab.id !== undefined)
            .map(tab => preparePlatformTab(platform, tab.id!)));
        if (activation.some(result => result.status === 'rejected')) throw new Error('Source tab activation failed');
    }));
    return results.every(result => result.status === 'fulfilled');
}

/** Best-effort account selection after authorization; login is not an authorization prerequisite. */
export async function findAuthorizedAccount(platforms: readonly SourcePlatform[]): Promise<string | null> {
    const results = await Promise.allSettled(platforms.map(async platform => {
        if (!await hasPlatformAccess(platform)) return null;
        const tabs = await chrome.tabs.query({ url: [...PLATFORM_HOSTS[platform].pages] });
        if (!tabs.length) return null;
        if (platform === 'chatgpt') return (await discoverChatGPTAccounts())[0]?.id ?? null;
        if (platform === 'grok') return (await discoverGrokAccounts())[0]?.id ?? null;
        if (platform === 'claude') return (await discoverClaudeAccounts())[0]?.id ?? null;
        const source = tabs.find(tab => tab.active) ?? tabs[0];
        if (source.id === undefined) return null;
        const response = await sendTabMessage(source.id, { action: 'getAccountContext' }, 3000);
        if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true
            || !('accountContext' in response) || !response.accountContext || typeof response.accountContext !== 'object') return null;
        const context = response.accountContext;
        if (!('providerId' in context) || context.providerId !== platform
            || !('accountId' in context) || typeof context.accountId !== 'string') return null;
        const account = await getAccount(context.accountId);
        return account?.providerId === platform && account.providerAccountId !== 'default' ? account.id : null;
    }));
    return results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])[0] ?? null;
}

export function observePlatformAccess(listener: () => void): () => void {
    chrome.permissions?.onAdded?.addListener(listener);
    chrome.permissions?.onRemoved?.addListener(listener);
    return () => {
        chrome.permissions?.onAdded?.removeListener(listener);
        chrome.permissions?.onRemoved?.removeListener(listener);
    };
}
