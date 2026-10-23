import { getAccount } from '../../l3a/storageService.js';
import { isAccountId } from '../../l2/accountRegistry.js';
import { ensureV2Ready } from '../api/runtimeReady.js';
import type { TabStatusResult } from '../types/utils.js';
import { discoverChatGPTAccounts } from './chatgptDiscovery.js';
import { discoverClaudeAccounts } from './claudeDiscovery.js';

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
function matches(response: unknown, accountId: string, providerId: string): boolean {
    if (!response || typeof response !== 'object') return false;
    const value = response as { ok?: unknown; accountContext?: { accountId?: unknown; providerId?: unknown } };
    return value.ok === true && value.accountContext?.accountId === accountId && value.accountContext.providerId === providerId;
}
/** Route only through a Content document bound to the selected provider Account. */
export async function resolveAccountTab(accountId: string): Promise<chrome.tabs.Tab> {
    if (!isAccountId(accountId)) throw new TypeError('Tab routing requires an Account UUID');
    await ensureV2Ready();
    const account = await getAccount(accountId);
    if (!account || !['gemini', 'chatgpt'].includes(account.providerId)) throw new Error('Account has no supported Content Script');
    const tabs = await chrome.tabs.query({ url: account.providerId === 'chatgpt'
        ? ['https://chatgpt.com/*', 'https://chat.openai.com/*'] : 'https://gemini.google.com/*' });
    tabs.sort((a, b) => Number(!!b.active) - Number(!!a.active));
    for (const tab of tabs) {
        if (tab.id === undefined) continue;
        try {
            if (matches(await sendTabMessage(tab.id, { action: 'getAccountContext' }, 3000), accountId, account.providerId)) return tab;
        } catch { /* Closed, navigating or uninjected tabs cannot be execution targets. */ }
    }
    throw new Error('No open Provider Tab matches this Account');
}
/** Resolve verified Gemini Content bindings or a granted ChatGPT session; never infer identity from a URL slot. */
export async function resolveScanTarget(preferredAccountId?: string): Promise<string> {
    await ensureV2Ready();
    const accounts = new Set<string>();
    const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
    for (const tab of tabs) {
        if (tab.id === undefined) continue;
        try {
            const response = await sendTabMessage(tab.id, { action: 'getAccountContext' }, 3000);
            if (!response || typeof response !== 'object' || !('accountContext' in response)) continue;
            const context = response.accountContext;
            if (!context || typeof context !== 'object' || !('accountId' in context) || !isAccountId(context.accountId)) continue;
            const account = await getAccount(context.accountId);
            if (account?.providerId === 'gemini' && account.providerAccountId !== 'default'
                && matches(response, account.id, 'gemini')) accounts.add(account.id);
        } catch { /* Unavailable Content is not a scan source. */ }
    }
    const preferred = preferredAccountId ? await getAccount(preferredAccountId) : null;
    // A selected Gemini source needs no ChatGPT network access.
    if (preferred?.providerId === 'gemini' && accounts.has(preferred.id)) return preferred.id;
    try {
        for (const account of await discoverChatGPTAccounts()) accounts.add(account.id);
    } catch (error) {
        if (preferred?.providerId === 'chatgpt') throw error;
    }
    try {
        for (const account of await discoverClaudeAccounts()) accounts.add(account.id);
    } catch (error) {
        if (preferred?.providerId === 'claude') throw error;
    }
    if (preferredAccountId && accounts.has(preferredAccountId)) return preferredAccountId;
    if (preferred?.providerId === 'chatgpt') throw new Error('Open ChatGPT, log in and connect the selected account before scanning.');
    if (preferred?.providerId === 'claude') throw new Error('Open Claude, log in and connect the selected account before scanning.');
    if (accounts.size === 1) return [...accounts][0];
    throw new Error(accounts.size ? 'Multiple provider accounts are connected. Select the account to scan.'
        : 'Open Gemini, ChatGPT or Claude and connect an account before scanning.');
}
export async function getGeminiTab(accountId?: string): Promise<chrome.tabs.Tab | null> {
    if (!accountId) throw new TypeError('Tab routing requires an Account UUID');
    return resolveAccountTab(accountId);
}
export async function sendToGeminiTab(message: unknown, accountId?: string, timeoutMs?: number): Promise<unknown> {
    if (!accountId) throw new TypeError('Tab routing requires an Account UUID');
    const tab = await resolveAccountTab(accountId);
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new TypeError('Expected Provider message');
    // The selected Content handler checks this UUID again immediately before execution.
    return sendTabMessage(tab.id!, { ...message, accountId }, timeoutMs);
}
export async function checkGeminiStatus(accountId?: string): Promise<TabStatusResult> {
    try { return { status: 'CONNECTED', tab: await getGeminiTab(accountId) }; }
    catch (error) { return { status: 'ERROR', tab: null, error: error instanceof Error ? error.message : String(error) }; }
}
export async function getAITab(providerId = 'gemini', accountId?: string): Promise<chrome.tabs.Tab | null> {
    if (!accountId || (await getAccount(accountId))?.providerId !== providerId) throw new Error('Provider/account mismatch');
    return getGeminiTab(accountId);
}
export async function sendToAITab(providerId: string, message: unknown, accountId?: string, timeoutMs?: number): Promise<unknown> {
    if (!accountId || (await getAccount(accountId))?.providerId !== providerId) throw new Error('Provider/account mismatch');
    return sendToGeminiTab(message, accountId, timeoutMs);
}
async function requestTabNavigation(message: { action: 'openGeminiPage' } | { action: 'reloadGeminiTab'; tabId?: number }): Promise<unknown> {
    const response: unknown = await chrome.runtime.sendMessage(message);
    if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true) {
        throw new Error(response && typeof response === 'object' && 'error' in response
            ? String(response.error) : 'Provider Tab navigation failed');
    }
    return response;
}
export function openGeminiPage(): Promise<unknown> { return requestTabNavigation({ action: 'openGeminiPage' }); }
export function reloadGeminiTab(tabId?: number): Promise<unknown> { return requestTabNavigation({ action: 'reloadGeminiTab', tabId }); }
