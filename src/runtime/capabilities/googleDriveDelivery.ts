import { isRecord } from '../../shared/utils/typeGuards.js';

export const driveFolderName = 'Gemini Exporter';

const api = 'https://www.googleapis.com';
const scope = 'https://www.googleapis.com/auth/drive.file';
const folderType = 'application/vnd.google-apps.folder';
const isFileId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]+$/.test(id);

export function isDriveDeliveryConfigured(): boolean {
    const oauth = chrome.runtime.getManifest().oauth2;
    return !!oauth?.client_id && oauth.scopes?.length === 1 && oauth.scopes[0] === scope
        && typeof chrome.identity?.getAuthToken === 'function';
}

export async function connectDriveDelivery(signal: AbortSignal, interactive: boolean) {
    if (!isDriveDeliveryConfigured()) throw new Error('Google Drive OAuth is not configured');
    const { token, grantedScopes } = await chrome.identity.getAuthToken({ interactive, scopes: [scope] });
    if (!token || (grantedScopes && !grantedScopes.includes(scope))) throw new Error('Google Drive authorization required');
    async function request(url: string, init: RequestInit = {}) {
        const headers = new Headers(init.headers);
        headers.set('Authorization', 'Bearer ' + token);
        const response = await fetch(url, { ...init, headers, signal: init.signal ?? signal, redirect: 'error', credentials: 'omit' });
        if (response.status === 401 && token) await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
        if (!response.ok) throw new Error('Google Drive HTTP ' + response.status);
        return response;
    }
    const about = await request(api + '/drive/v3/about?fields=user(emailAddress)');
    const account: unknown = await about.json();
    if (!isRecord(account) || !isRecord(account.user) || typeof account.user.emailAddress !== 'string'
        || !account.user.emailAddress) throw new Error('Google Drive account unavailable');
    const email = account.user.emailAddress;
    async function findOrCreateFolder(uploadSignal: AbortSignal): Promise<string> {
        const query = new URLSearchParams({
            q: `'root' in parents and trashed = false and name = '${driveFolderName}' and mimeType = '${folderType}'`,
            spaces: 'drive', fields: 'nextPageToken,files(id,capabilities(canAddChildren))', orderBy: 'createdTime',
        });
        do {
            const page: unknown = await (await request(api + '/drive/v3/files?' + query, { signal: uploadSignal })).json();
            if (!isRecord(page) || !Array.isArray(page.files)) throw new Error('Invalid Drive directory listing');
            for (const file of page.files) {
                if (isRecord(file) && isFileId(file.id) && isRecord(file.capabilities) && file.capabilities.canAddChildren === true)
                    return file.id;
            }
            if (!page.nextPageToken) break;
            if (typeof page.nextPageToken !== 'string') throw new Error('Invalid Drive directory listing');
            query.set('pageToken', page.nextPageToken);
        } while (true);
        const created: unknown = await (await request(api + '/drive/v3/files?fields=id', {
            method: 'POST', signal: uploadSignal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: driveFolderName, mimeType: folderType, parents: ['root'] }),
        })).json();
        if (!isRecord(created) || !isFileId(created.id)) throw new Error('Google Drive did not confirm the export folder');
        return created.id;
    }
    return {
        email,
        async upload(name: string, data: Blob, uploadSignal: AbortSignal) {
            if (!data.size) throw new Error('Empty export file');
            const parent = await navigator.locks.request('drive-export-folder:' + email.toLowerCase(),
                { signal: uploadSignal }, () => findOrCreateFolder(uploadSignal));
            const response = await request(api + '/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
                method: 'POST', signal: uploadSignal, headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': data.type },
                body: JSON.stringify({ name, mimeType: data.type.split(';')[0], parents: [parent] }),
            });
            const location = response.headers.get('Location');
            if (!location) throw new Error('Google Drive did not return an upload session');
            const session = new URL(location);
            if (session.origin !== api || session.pathname !== '/upload/drive/v3/files' || session.username || session.password)
                throw new Error('Unexpected Google Drive upload session');
            const saved = await request(session.href, { method: 'PUT', body: data, signal: uploadSignal });
            const result: unknown = await saved.json();
            if (!isRecord(result) || !isFileId(result.id)) throw new Error('Google Drive did not confirm the file ID');
            const fields = 'id,name,size,mimeType,parents,trashed';
            const file: unknown = await (await request(api + '/drive/v3/files/' + result.id + '?supportsAllDrives=true&fields=' + fields,
                { signal: uploadSignal })).json();
            if (!isRecord(file) || file.id !== result.id || file.name !== name || file.size !== String(data.size)
                || file.mimeType !== data.type.split(';')[0] || file.trashed !== false || !Array.isArray(file.parents)
                || file.parents.length !== 1 || file.parents[0] !== parent)
                throw new Error('Google Drive could not verify the uploaded file and folder');
            return 'https://drive.google.com/open?id=' + result.id + '&authuser=' + encodeURIComponent(email);
        },
    };
}
