import { OperationError } from '../../shared/errors/operationError.js';
import { isDirectoryHandle, type DirectoryHandle } from '../../shared/types/directoryHandle.js';
import { getStoredLocalVaultHandle, setStoredLocalVaultHandle } from '../../l3a/cloudSyncStore.js';

export type VaultDirectoryStatus =
    | { readonly state: 'missing' }
    | { readonly state: 'prompt'; readonly folderName: string }
    | { readonly state: 'granted'; readonly folderName: string; readonly handle: DirectoryHandle };

export async function inspectVaultDirectoryStatus(): Promise<VaultDirectoryStatus> {
    const handle = await getStoredLocalVaultHandle();
    if (!handle) return { state: 'missing' };
    try {
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
            return { state: 'granted', folderName: handle.name, handle };
        }
        return { state: 'prompt', folderName: handle.name };
    } catch {
        return { state: 'prompt', folderName: handle.name };
    }
}

/** Open the browser directory picker inside a user click gesture and persist the chosen Vault folder. */
export async function pickVaultDirectoryHandle(): Promise<DirectoryHandle> {
    if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
        throw new OperationError('DIRECTORY_UNAVAILABLE', 'Directory picker unavailable');
    }
    const picked = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (!isDirectoryHandle(picked)) {
        throw new OperationError('DIRECTORY_UNAVAILABLE', 'Picked directory handle lacks permission API');
    }
    const perm = await picked.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
        throw new OperationError('DIRECTORY_PERMISSION_REQUIRED', 'Directory readwrite permission not granted');
    }
    await setStoredLocalVaultHandle(picked);
    return picked;
}

/** Re-request `readwrite` permission on a previously chosen Local Vault folder inside a click gesture. */
export async function reauthorizeVaultDirectoryHandle(): Promise<DirectoryHandle> {
    const handle = await getStoredLocalVaultHandle();
    if (!handle) {
        throw new OperationError('DIRECTORY_PERMISSION_REQUIRED', 'No local vault folder selected yet');
    }
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
        throw new OperationError('DIRECTORY_PERMISSION_DENIED', 'Folder permission denied');
    }
    await setStoredLocalVaultHandle(handle);
    return handle;
}
