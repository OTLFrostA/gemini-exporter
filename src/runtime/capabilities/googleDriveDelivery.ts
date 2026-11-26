import { isRecord } from '../../shared/utils/typeGuards.js';

const api = 'https://www.googleapis.com';
const scope = 'https://www.googleapis.com/auth/drive.file';

export function isDriveDeliveryConfigured(): boolean {
    const oauth = chrome.runtime.getManifest().oauth2;
    return !!oauth?.client_id && oauth.scopes?.length === 1 && oauth.scopes[0] === scope
        && typeof chrome.identity?.getAuthToken === 'function';
}

/** One foreground export. The token and destination identity live only in this invocation. */
export async function prepareDriveDelivery(signal: AbortSignal, confirmAccount: (email: string) => boolean) {
    if (!isDriveDeliveryConfigured()) throw new Error('Google Drive OAuth is not configured');
    const { token: grantedToken, grantedScopes } = await chrome.identity.getAuthToken({ interactive: true, scopes: [scope] });
    if (!grantedToken || (grantedScopes && !grantedScopes.includes(scope))) throw new Error('Google Drive authorization required');
    const token = grantedToken;
    async function request(url: string, init: RequestInit = {}) {
        signal.throwIfAborted();
        const headers = new Headers(init.headers);
        headers.set('Authorization', 'Bearer ' + token);
        const response = await fetch(url, { ...init, headers, signal, redirect: 'error', credentials: 'omit' });
        if (response.status === 401) await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
        if (!response.ok) throw new Error('Google Drive HTTP ' + response.status);
        return response;
    }
    const about = await request(api + '/drive/v3/about?fields=user(emailAddress)');
    const account: unknown = await about.json();
    if (!isRecord(account) || !isRecord(account.user) || typeof account.user.emailAddress !== 'string'
        || !account.user.emailAddress) throw new Error('Google Drive account unavailable');
    signal.throwIfAborted();
    if (!confirmAccount(account.user.emailAddress)) return null;

    return async (name: string, data: Blob): Promise<string> => {
        const response = await request(api + '/upload/drive/v3/files?uploadType=resumable&fields=id', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': data.type },
            body: JSON.stringify({ name, mimeType: data.type.split(';')[0] }),
        });
        const location = response.headers.get('Location');
        if (!location) throw new Error('Google Drive did not return an upload session');
        const session = new URL(location);
        if (session.origin !== api || session.pathname !== '/upload/drive/v3/files' || session.username || session.password)
            throw new Error('Unexpected Google Drive upload session');
        const saved = await request(session.href, { method: 'PUT', body: data });
        const result: unknown = await saved.json();
        if (!isRecord(result) || typeof result.id !== 'string' || !/^[\w-]+$/.test(result.id))
            throw new Error('Google Drive did not confirm the file ID');
        return 'https://drive.google.com/open?id=' + encodeURIComponent(result.id);
    };
}
