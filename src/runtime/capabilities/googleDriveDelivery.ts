import { readDriveExportAccount, saveDriveExportAccount } from '../../l3a/storageService.js';
import { DriveAuthError, authorizeDriveAccount } from './driveAccountAuthorization.js';
import { isRecord } from '../../shared/utils/typeGuards.js';

export { DriveAuthError, isDriveDeliveryConfigured, requestDrivePermissions } from './driveAccountAuthorization.js';

const driveFolderName = 'Gemini Exporter';

const api = 'https://www.googleapis.com';
export class DriveAuthorizationExpired extends Error {}
const folderType = 'application/vnd.google-apps.folder';
const isFileId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]+$/.test(id);

export async function connectDriveDelivery(signal: AbortSignal, mode: 'switch' | 'connect' | 'restore') {
    const preferred = mode === 'switch' ? undefined : await readDriveExportAccount();
    if (mode === 'restore' && !preferred) throw new Error('Connect a Google Drive account first');
    signal.throwIfAborted();
    const token = await authorizeDriveAccount(mode, preferred);
    signal.throwIfAborted();
    async function request(url: string, init: RequestInit = {}) {
        const headers = new Headers(init.headers);
        headers.set('Authorization', 'Bearer ' + token);
        const response = await fetch(url, { ...init, headers, signal: init.signal ?? signal, redirect: 'error', credentials: 'omit' });
        if (response.status === 401) throw new DriveAuthorizationExpired('Google Drive authorization expired');
        if (!response.ok) throw new Error('Google Drive HTTP ' + response.status);
        return response;
    }
    const about = await request(api + '/drive/v3/about?fields=user(emailAddress)');
    const account: unknown = await about.json();
    if (!isRecord(account) || !isRecord(account.user) || typeof account.user.emailAddress !== 'string'
        || !account.user.emailAddress) throw new Error('Google Drive account unavailable');
    const email = account.user.emailAddress;
    if (mode === 'restore' && preferred && preferred.toLowerCase() !== email.toLowerCase()) {
        throw new DriveAuthError('account_mismatch', 'Google returned a different Drive account');
    }
    signal.throwIfAborted();
    if (!preferred || preferred.toLowerCase() !== email.toLowerCase()) await saveDriveExportAccount(email);
    const lockPrefix = 'drive-export:' + email.toLowerCase() + ':';
    const quote = (value: string) => "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    async function findChild(parent: string, name: string, folder: boolean, uploadSignal: AbortSignal): Promise<string | undefined> {
        const typeFilter = folder ? 'mimeType = ' + quote(folderType)
            : "not mimeType contains 'application/vnd.google-apps.'";
        const query = new URLSearchParams({
            q: `${quote(parent)} in parents and trashed = false and name = ${quote(name)} and ${typeFilter}`,
            spaces: 'drive', fields: 'nextPageToken,files(id,capabilities(canAddChildren,canModifyContent))', orderBy: 'createdTime',
        });
        do {
            const page: unknown = await (await request(api + '/drive/v3/files?' + query, { signal: uploadSignal })).json();
            if (!isRecord(page) || !Array.isArray(page.files)) throw new Error('Invalid Drive directory listing');
            for (const item of page.files) {
                if (isRecord(item) && isFileId(item.id) && isRecord(item.capabilities)
                    && item.capabilities[folder ? 'canAddChildren' : 'canModifyContent'] === true) return item.id;
            }
            if (page.nextPageToken === undefined) return;
            if (typeof page.nextPageToken !== 'string' || !page.nextPageToken) throw new Error('Invalid Drive directory listing');
            query.set('pageToken', page.nextPageToken);
        } while (true);
    }

    function findOrCreateFolder(parent: string, name: string, uploadSignal: AbortSignal): Promise<string> {
        return navigator.locks.request(lockPrefix + JSON.stringify([parent, name]), { signal: uploadSignal }, async () => {
            const existing = await findChild(parent, name, true, uploadSignal);
            if (existing) return existing;
            const created: unknown = await (await request(api + '/drive/v3/files?fields=id', {
                method: 'POST', signal: uploadSignal, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, mimeType: folderType, parents: [parent] }),
            })).json();
            if (!isRecord(created) || !isFileId(created.id)) throw new Error('Google Drive did not confirm the export folder');
            return created.id;
        });
    }

    async function uploadFile(parent: string, name: string, data: Blob, uploadSignal: AbortSignal) {
        const existing = await findChild(parent, name, false, uploadSignal);
        const path = '/upload/drive/v3/files' + (existing ? '/' + existing : '');
        const response = await request(api + path + '?uploadType=resumable&supportsAllDrives=true&fields=id', {
            method: existing ? 'PATCH' : 'POST', signal: uploadSignal,
            headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': data.type },
            body: JSON.stringify({ name, mimeType: data.type.split(';')[0], ...(existing ? {} : { parents: [parent] }) }),
        });
        const location = response.headers.get('Location');
        if (!location) throw new Error('Google Drive did not return an upload session');
        const session = new URL(location);
        if (session.origin !== api || session.pathname !== path || session.username || session.password)
            throw new Error('Unexpected Google Drive upload session');
        const saved = await request(session.href, { method: 'PUT', body: data, signal: uploadSignal });
        const result: unknown = await saved.json();
        if (!isRecord(result) || !isFileId(result.id) || (existing && result.id !== existing)) throw new Error('Google Drive did not confirm the file ID');
        const fields = 'id,name,size,mimeType,parents,trashed';
        const file: unknown = await (await request(api + '/drive/v3/files/' + result.id + '?supportsAllDrives=true&fields=' + fields,
            { signal: uploadSignal })).json();
        if (!isRecord(file) || file.id !== result.id || file.name !== name || file.size !== String(data.size)
            || file.mimeType !== data.type.split(';')[0] || file.trashed !== false || !Array.isArray(file.parents)
            || file.parents.length !== 1 || file.parents[0] !== parent)
            throw new Error('Google Drive could not verify the uploaded file and folder');
    }

    const folderUrl = (id: string) => 'https://drive.google.com/drive/folders/' + id + '?authuser=' + encodeURIComponent(email);

    return {
        email,
        async findExportFolderUrl() {
            const id = await findChild('root', driveFolderName, true, signal);
            return id ? folderUrl(id) : undefined;
        },
        async upload(relativePath: string, data: Blob, uploadSignal: AbortSignal) {
            const parts = relativePath.split('/');
            const name = parts.pop();
            if (!name) throw new Error('Missing Drive file name');
            const exportFolder = await findOrCreateFolder('root', driveFolderName, uploadSignal);
            let parent = exportFolder;
            for (const part of parts) parent = await findOrCreateFolder(parent, part, uploadSignal);
            await navigator.locks.request(lockPrefix + JSON.stringify([parent, name]), { signal: uploadSignal },
                () => uploadFile(parent, name, data, uploadSignal));
            return folderUrl(exportFolder);
        },
    };
}
