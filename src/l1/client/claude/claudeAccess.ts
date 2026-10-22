import { ProviderRegistry } from '../providerRegistry.js';
import { ClaudeProvider } from './claudeProvider.js';

export const CLAUDE_ORIGIN = 'https://claude.ai/*';

export async function hasClaudeAccess(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return false;
    try { return await chrome.permissions.contains({ origins: [CLAUDE_ORIGIN] }); }
    catch { return false; }
}

/** Must be called directly from the Connect Claude button's user gesture. */
export async function requestClaudeAccess(): Promise<boolean> {
    if (await hasClaudeAccess()) return true;
    if (typeof chrome === 'undefined' || !chrome.permissions?.request) return false;
    try { return await chrome.permissions.request({ origins: [CLAUDE_ORIGIN] }); }
    catch { return false; }
}
export async function ensureClaudeRegistered(): Promise<boolean> {
    if (!await hasClaudeAccess()) return false;
    if (!ProviderRegistry.get('claude')) ProviderRegistry.register(new ClaudeProvider());
    return true;
}

const allowedPath = /^\/api\/organizations(?:\/[\da-f-]{36}\/chat_conversations(?:\/[\da-f-]{36})?(?:\?tree=true&rendering_mode=messages&render_all_tools=true)?)?$/i;

/**
 * Execute authenticated, same-origin API reads in a logged-in Claude tab.
 * No cookies or tokens ever cross the extension boundary; only JSON is returned.
 * An expected organization is rechecked in the same injected execution.
 */
export async function readClaudeSource(path: string, expectedOrganization?: string): Promise<unknown> {
    if (!allowedPath.test(path) || expectedOrganization !== undefined
        && !/^[\da-f-]{36}$/i.test(expectedOrganization)) throw new TypeError('Invalid Claude API request');
    if (!await hasClaudeAccess()) throw new Error('Claude host permission unavailable');
    const tabs = await chrome.tabs.query({ url: [CLAUDE_ORIGIN] });
    const ordered = tabs.filter(tab => tab.id !== undefined).sort((a, b) => Number(!!b.active) - Number(!!a.active));
    if (!ordered.length) throw new Error('Open Claude and log in before continuing');
    let lastError: unknown;
    for (const tab of ordered) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id! }, world: 'ISOLATED',
                func: async (requestedPath: string, organization?: string) => {
                    const getJson = async (resource: string) => {
                        const response = await fetch(resource, { credentials: 'include',
                            headers: { Accept: 'application/json' } });
                        if (!response.ok) throw new Error('Claude API HTTP ' + response.status);
                        return response.json() as Promise<unknown>;
                    };
                    if (organization) {
                        const organizations = await getJson('/api/organizations');
                        if (!Array.isArray(organizations) || !organizations.some(
                            org => org && typeof org === 'object' && org.uuid === organization))
                            throw new Error('Claude organization/account changed');
                    }
                    return getJson(requestedPath);
                },
                args: [path, expectedOrganization],
            });
            if (results.length !== 1 || results[0]?.result === undefined)
                throw new Error('Claude source returned no data');
            return results[0].result;
        } catch (error) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new Error('Claude tab source unavailable');
}
