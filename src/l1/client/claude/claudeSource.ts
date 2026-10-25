import { hasPlatformAccess } from '../platformAccess.js';
import { PLATFORM_HOSTS } from '../../../shared/platformHosts.js';
export const CLAUDE_ORIGIN = PLATFORM_HOSTS.claude.pages[0];
export function hasClaudeAccess(): Promise<boolean> { return hasPlatformAccess('claude'); }
const allowedPath = /^\/api\/organizations(?:\/[\da-f-]{36}\/chat_conversations(?:\/[\da-f-]{36})?(?:\?tree=true&rendering_mode=messages&render_all_tools=true)?)?$/i;

/**
 * Execute authenticated, same-origin API reads in a logged-in Claude tab.
 * No cookies or tokens ever cross the extension boundary; only JSON is returned.
 * An expected organization is rechecked in the same injected execution.
 */
export async function readClaudeSource(path: string, expectedOrganization?: string): Promise<unknown> {
    if (!(allowedPath.test(path) || /^\/api\/organizations\/[\da-f-]{36}\/chat_conversations_v2\?limit=100&offset=\d+&consistency=strong$/i.test(path)) || expectedOrganization !== undefined
        && !/^[\da-f-]{36}$/i.test(expectedOrganization)) throw new TypeError('Invalid Claude API request');
    if (!await hasClaudeAccess()) throw new Error('Claude host permission unavailable');
    const tabs = await chrome.tabs.query({ url: [CLAUDE_ORIGIN] });
    const ordered = tabs.sort((a, b) => Number(!!b.active) - Number(!!a.active))
        .flatMap(tab => tab.id === undefined ? [] : [tab.id]);
    if (!ordered.length) throw new Error('Open Claude and log in before continuing');
    let lastError: unknown;
    for (const tabId of ordered) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId }, world: 'ISOLATED',
                func: async (requestedPath: string, organization?: string) => {
                    const getJson = async (resource: string): Promise<unknown> => {
                        const response = await fetch(resource, { credentials: 'include',
                            headers: { Accept: 'application/json' } });
                        if (!response.ok) throw new Error('Claude API HTTP ' + response.status);
                        return response.json();
                    };
                    if (organization) {
                        const cookieOrg = document.cookie.split(';').map(part => part.trim())
                            .find(part => part.startsWith('lastActiveOrg='))?.slice('lastActiveOrg='.length);
                        if (cookieOrg && decodeURIComponent(cookieOrg) !== organization)
                            throw new Error('Active Claude organization differs from selected account');
                        const organizations = await getJson('/api/organizations');
                        if (!Array.isArray(organizations) || !organizations.some(
                            org => org && typeof org === 'object' && org.uuid === organization))
                            throw new Error('Claude organization/account changed');
                    }
                    return getJson(requestedPath);
                },
                args: expectedOrganization === undefined ? [path] : [path, expectedOrganization],
            });
            if (results.length !== 1 || results[0]?.result === undefined)
                throw new Error('Claude source returned no data');
            return results[0].result;
        } catch (error) {
            if (error instanceof Error && /HTTP 429/.test(error.message)) throw error;
            lastError = error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error('Claude tab source unavailable');
}
