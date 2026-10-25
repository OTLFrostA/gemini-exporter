import { hasPlatformAccess } from '../platformAccess.js';
import { grokUuid } from '../../parsers/grok/source.js';
export function hasGrokAccess(): Promise<boolean> { return hasPlatformAccess('grok'); }
export function validGrokRead(path: string, body?: { responseIds: string[] }): boolean {
    if (body) return /^\/rest\/app-chat\/conversations\/[\da-f-]{36}\/load-responses$/i.test(path)
        && body.responseIds.length > 0 && body.responseIds.length <= 100 && body.responseIds.every(grokUuid);
    return path === '/rest/auth/get-user'
        || /^\/rest\/app-chat\/conversations\?pageSize=60(?:&pageToken=[\da-f-]{36})?$/i.test(path)
        || /^\/rest\/app-chat\/conversations_v2\/[\da-f-]{36}\?includeWorkspaces=true&includeTaskResult=true$/i.test(path)
        || /^\/rest\/app-chat\/conversations\/[\da-f-]{36}\/response-node\?includeThreads=true$/i.test(path);
}
/** Only read APIs, including Grok's POST batch reader, execute in the authenticated tab. */
export async function readGrokSource(path: string, expectedUser?: string, body?: { responseIds: string[] }): Promise<unknown> {
    if (!validGrokRead(path, body) || expectedUser !== undefined && !grokUuid(expectedUser)) throw new TypeError('Invalid Grok API read');
    if (!await hasGrokAccess()) throw new Error('Grok host permission unavailable');
    const tabs = (await chrome.tabs.query({ url: ['https://grok.com/*'] }))
        .sort((a, b) => Number(!!b.active) - Number(!!a.active))
        .flatMap(tab => tab.id === undefined ? [] : [tab.id]);
    let failure: unknown = new Error('Open Grok and log in before continuing');
    for (const tabId of tabs) {
        try {
            const results = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED',
                func: async (resource: string, owner: string | null, payload: { responseIds: string[] } | null) => {
                    const get = async (path: string, body?: { responseIds: string[] }): Promise<unknown> => {
                        const r = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' },
                            ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
                        if (!r.ok) throw new Error('Grok API HTTP ' + r.status);
                        return r.json() as Promise<unknown>;
                    };
                    const verify = async () => {
                        const user = await get('/rest/auth/get-user');
                        if (!user || typeof user !== 'object' || !('userId' in user) || user.userId !== owner) throw new Error('Grok account changed');
                    };
                    if (owner) await verify();
                    const result = await get(resource, payload ?? undefined);
                    if (owner) await verify();
                    return result;
                }, args: [path, expectedUser ?? null, body ?? null] });
            if (results.length !== 1 || results[0]?.result === undefined) throw new Error('Grok source returned no data');
            return results[0].result;
        } catch (error) { if (error instanceof Error && /HTTP 429/.test(error.message)) throw error; failure = error; }
    }
    throw failure;
}
