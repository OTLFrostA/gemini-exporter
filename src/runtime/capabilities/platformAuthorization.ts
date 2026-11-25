import { hasPlatformAccess, requestPlatformsAccess } from '../../l1/client/platformAccess.js';
import { PLATFORM_HOSTS, platformSignInUrl, type SourcePlatform } from '../../shared/platformHosts.js';
import { readBoundAccountContext } from '../../shared/types/accountContextReply.js';
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
        const activation = await Promise.allSettled(tabs.flatMap(tab => tab.id === undefined ? [] : [preparePlatformTab(platform, tab.id)]));
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
        // The active Gemini tab may still be loading or signed out while another
        // open document already has a verified account binding.
        tabs.sort((a, b) => Number(b.active) - Number(a.active));
        const candidates = await Promise.allSettled(tabs.map(async ({ id }) => {
            if (id === undefined) return null;
            const context = readBoundAccountContext(await sendTabMessage(id, { action: 'getAccountContext' }, 3000), platform);
            if (!context) return null;
            const account = await getAccount(context.accountId);
            return account?.providerId === platform && account.providerAccountId !== 'default' ? account.id : null;
        }));
        const bound = candidates.find(candidate => candidate.status === 'fulfilled' && candidate.value !== null);
        return bound?.status === 'fulfilled' ? bound.value : null;
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

/** Extension navigation remains available after an asynchronous native permission prompt. */
export async function openPlatformSignIn(platform: SourcePlatform, active = true): Promise<void> {
    await chrome.tabs.create({ url: platformSignInUrl(platform), active });
}
