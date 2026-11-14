import { PLATFORM_HOSTS, isSourcePlatform, platformDisplayName, type SourcePlatform } from '../../shared/platformHosts.js';
import { readBoundAccountContext } from '../../shared/types/accountContextReply.js';
import { preparePlatformTab } from './platformInjection.js';
import { ScanConnectionError } from './scanConnection.js';
import { OperationError } from '../../shared/errors/operationError.js';
import { getAccount } from '../../l3a/storageService.js';
import { isAccountId } from '../../l2/accountRegistry.js';
import { ensureV2Ready } from '../api/runtimeReady.js';
import { discoverChatGPTAccounts } from './chatgptDiscovery.js';
import { discoverGrokAccounts } from './grokDiscovery.js';
import { discoverClaudeAccounts } from './claudeDiscovery.js';

/** A routed Content tab has a concrete ID, including the valid ID zero. */
export interface AccountTab extends chrome.tabs.Tab { id: number }

export async function sendTabMessage(tabId: number, message: unknown, timeout = 25000): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        const settle = (error?: Error, response?: unknown) => {
            if (settled) return;
            settled = true;
            if (timer !== undefined) clearTimeout(timer);
            if (error) reject(error);
            else resolve(response);
        };
        if (timeout > 0) timer = setTimeout(() => settle(new Error('Provider Tab communication timed out')), timeout);
        try {
            chrome.tabs.sendMessage(tabId, message, response => {
                const error = chrome.runtime.lastError;
                if (error) settle(new Error(error.message || 'Provider Tab unavailable'));
                else if (response === undefined) settle(new Error('Provider Tab returned no response'));
                else settle(undefined, response);
            });
        } catch (error) {
            settle(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

function matchesBoundTab(response: unknown, accountId: string, providerId: string): boolean {
    const context = readBoundAccountContext(response, providerId);
    return context !== null && context.accountId === accountId;
}

function throwUnconnectedScanTarget(platform: SourcePlatform): never {
    const message = platform === 'gemini'
        ? 'Open Gemini, log in and refresh the page before scanning.'
        : `Open ${platformDisplayName(platform)}, log in and connect the selected account before scanning.`;
    throw new ScanConnectionError(platform, message);
}

/** Route only through a Content document bound to the selected provider Account. */
export async function resolveAccountTab(accountId: string): Promise<AccountTab> {
    if (!isAccountId(accountId)) throw new TypeError('Tab routing requires an Account UUID');
    await ensureV2Ready();
    const account = await getAccount(accountId);
    if (!account || !isSourcePlatform(account.providerId)) throw new Error('Account has no supported Content Script');
    const pages = PLATFORM_HOSTS[account.providerId].pages;
    const tabs = await chrome.tabs.query({ url: pages.length === 1 ? pages[0] : [...pages] });
    tabs.sort((a, b) => Number(!!b.active) - Number(!!a.active));
    for (const tab of tabs) {
        const id = tab.id;
        if (id === undefined) continue;
        try {
            if (matchesBoundTab(await sendTabMessage(id, { action: 'getAccountContext' }, 3000), accountId, account.providerId)) {
                return { ...tab, id };
            }
        } catch { /* Closed, navigating or uninjected tabs cannot be execution targets. */ }
    }
    throw new Error('No open Provider Tab matches this Account');
}

/** Resolve verified Gemini Content bindings or granted optional-platform sessions; never infer identity from a URL slot. */
export async function resolveScanTarget(preferredAccountId?: string): Promise<string> {
    await ensureV2Ready();
    const accounts = new Set<string>();
    const tabs = await chrome.tabs.query({ url: PLATFORM_HOSTS.gemini.pages[0] });
    for (const tab of tabs) {
        if (tab.id === undefined) continue;
        try {
            let response: unknown;
            try { response = await sendTabMessage(tab.id, { action: 'getAccountContext' }, 3000); }
            catch {
                // An open document may predate installation or its optional host grant.
                await preparePlatformTab('gemini', tab.id);
                response = await sendTabMessage(tab.id, { action: 'getAccountContext' }, 3000);
            }
            const context = readBoundAccountContext(response, 'gemini');
            if (!context || !isAccountId(context.accountId)) continue;
            const account = await getAccount(context.accountId);
            if (account?.providerId === 'gemini' && account.providerAccountId !== 'default'
                && account.id === context.accountId) accounts.add(account.id);
        } catch { /* Unavailable Content is not a scan source. */ }
    }
    const preferred = preferredAccountId ? await getAccount(preferredAccountId) : null;
    if (preferred?.providerId === 'gemini') {
        if (accounts.has(preferred.id)) return preferred.id;
        throwUnconnectedScanTarget('gemini');
    }
    const discoveries = [
        { providerId: 'chatgpt', run: discoverChatGPTAccounts },
        { providerId: 'claude', run: discoverClaudeAccounts },
        { providerId: 'grok', run: discoverGrokAccounts },
    ] as const;
    // Selected accounts never need to probe other platforms. Unselected discovery is independent.
    const selected = discoveries.some(source => source.providerId === preferred?.providerId) ? preferred?.providerId : null;
    const sources = selected ? discoveries.filter(source => source.providerId === selected) : discoveries;
    const results = await Promise.allSettled(sources.map(source => source.run()));
    for (const [index, outcome] of results.entries()) {
        if (outcome.status === 'rejected') {
            if (preferred?.providerId === sources[index].providerId) throw outcome.reason;
            continue;
        }
        for (const account of outcome.value) accounts.add(account.id);
    }
    if (preferredAccountId && accounts.has(preferredAccountId)) return preferredAccountId;
    if (preferred && isSourcePlatform(preferred.providerId)) {
        throwUnconnectedScanTarget(preferred.providerId);
    }
    if (accounts.size === 1) return [...accounts][0];
    throw new OperationError(accounts.size ? 'MULTIPLE_ACCOUNTS_CONNECTED' : 'NO_CONNECTED_ACCOUNT',
        accounts.size ? 'Multiple provider accounts are connected. Select the account to scan.'
            : 'Open Gemini, ChatGPT, Claude or Grok and connect an account before scanning.');
}

export async function sendToGeminiTab(message: unknown, accountId?: string, timeoutMs?: number): Promise<unknown> {
    if (!accountId) throw new TypeError('Tab routing requires an Account UUID');
    const tab = await resolveAccountTab(accountId);
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new TypeError('Expected Provider message');
    // The selected Content handler checks this UUID again immediately before execution.
    return sendTabMessage(tab.id, { ...message, accountId }, timeoutMs);
}

export async function getAITab(providerId = 'gemini', accountId?: string): Promise<AccountTab> {
    if (!accountId || (await getAccount(accountId))?.providerId !== providerId) throw new Error('Provider/account mismatch');
    return resolveAccountTab(accountId);
}

export async function sendToAITab(providerId: string, message: unknown, accountId?: string, timeoutMs?: number): Promise<unknown> {
    if (!accountId || (await getAccount(accountId))?.providerId !== providerId) throw new Error('Provider/account mismatch');
    return sendToGeminiTab(message, accountId, timeoutMs);
}
