import { getAccount } from '../../l3a/storageService.js';
import { isAccountId } from '../../l2/accountRegistry.js';
import { ensureV2Ready } from '../api/runtimeReady.js';
import type { TabStatusResult } from '../types/utils.js';

export async function sendTabMessage(tabId: number, message: unknown, timeout = 25000): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Provider Tab communication timed out')), timeout);
        chrome.tabs.sendMessage(tabId, message, response => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response);
        });
    });
}
function matches(response: unknown, accountId: string, providerId: string): boolean {
    if (!response || typeof response !== 'object') return false;
    const value = response as { ok?: unknown; accountContext?: { accountId?: unknown; providerId?: unknown } };
    return value.ok === true && value.accountContext?.accountId === accountId && value.accountContext.providerId === providerId;
}
/** Only Gemini currently has production Content injection. No slot or first-Tab fallback. */
export async function resolveAccountTab(accountId: string): Promise<chrome.tabs.Tab> {
    if (!isAccountId(accountId)) throw new TypeError('Tab routing requires an Account UUID');
    await ensureV2Ready();
    const account = await getAccount(accountId);
    if (!account || account.providerId !== 'gemini') throw new Error('Account has no supported Content Script');
    const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
    tabs.sort((a, b) => Number(!!b.active) - Number(!!a.active));
    for (const tab of tabs) {
        if (tab.id === undefined) continue;
        try {
            if (matches(await sendTabMessage(tab.id, { action: 'getAccountContext' }, 3000), accountId, account.providerId)) return tab;
        } catch { /* Closed, navigating or uninjected tabs cannot be execution targets. */ }
    }
    throw new Error('No open Provider Tab matches this Account');
}
/** Resolve only live, verified Content bindings; never infer identity from a URL slot. */
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
    if (preferredAccountId && accounts.has(preferredAccountId)) return preferredAccountId;
    if (accounts.size === 1) return [...accounts][0];
    throw new Error(accounts.size ? 'Multiple Gemini accounts are open. Select the account to scan.'
        : 'Open Gemini, log in and refresh the page before scanning.');
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
    if (providerId !== 'gemini') throw new Error('Provider has no production Content Script');
    return getGeminiTab(accountId);
}
export async function sendToAITab(providerId: string, message: unknown, accountId?: string, timeoutMs?: number): Promise<unknown> {
    if (providerId !== 'gemini') throw new Error('Provider has no production Content Script');
    return sendToGeminiTab(message, accountId, timeoutMs);
}
export function openGeminiPage(): Promise<unknown> { return chrome.runtime.sendMessage({ action: 'openGeminiPage' }); }
export function reloadGeminiTab(tabId?: number): Promise<unknown> { return chrome.runtime.sendMessage({ action: 'reloadGeminiTab', tabId }); }
export const TabService = { resolveScanTarget, resolveAccountTab, getGeminiTab, sendToGeminiTab, checkGeminiStatus,
    getAITab, sendToAITab, openGeminiPage, reloadGeminiTab };
export default TabService;
