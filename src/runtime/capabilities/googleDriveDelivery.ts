import { isRecord } from '../../shared/utils/typeGuards.js';

import { pickDriveFolder } from './driveFolderPicker.js';

const api = 'https://www.googleapis.com';
const scope = 'https://www.googleapis.com/auth/drive.file';
const folderType = 'application/vnd.google-apps.folder';
const isFileId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]+$/.test(id);

export function isDriveDeliveryConfigured(): boolean {
    const oauth = chrome.runtime.getManifest().oauth2;
    return !!oauth?.client_id && oauth.scopes?.length === 1 && oauth.scopes[0] === scope
        && typeof chrome.identity?.getAuthToken === 'function';
}

export async function connectDriveDelivery(signal: AbortSignal) {
    if (!isDriveDeliveryConfigured()) throw new Error('Google Drive OAuth is not configured');
    const { token, grantedScopes } = await chrome.identity.getAuthToken({ interactive: true, scopes: [scope] });
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
    return {
        email,
        async chooseFolder(frame: HTMLIFrameElement, dialog: HTMLDialogElement) {
            const id = await pickDriveFolder(token, signal, frame, dialog);
            if (!id) return;
            const fields = 'id,name,mimeType,trashed,capabilities(canAddChildren)';
            const file: unknown = await (await request(api + '/drive/v3/files/' + id + '?supportsAllDrives=true&fields=' + fields)).json();
            if (!isRecord(file) || file.id !== id || typeof file.name !== 'string' || file.mimeType !== folderType
                || file.trashed !== false || !isRecord(file.capabilities) || file.capabilities.canAddChildren !== true)
                throw new Error('Choose a writable Drive folder');
            return { id, name: file.name };
        },
        async upload(parent: string, name: string, data: Blob, uploadSignal: AbortSignal) {
            if (!data.size) throw new Error('Empty export file');
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
                || file.parents.length !== 1 || !isFileId(file.parents[0]) || (parent !== 'root' && !file.parents.includes(parent)))
                throw new Error('Google Drive could not verify the uploaded file and folder');
            return 'https://drive.google.com/open?id=' + result.id + '&authuser=' + encodeURIComponent(email);
        },
    };
}
