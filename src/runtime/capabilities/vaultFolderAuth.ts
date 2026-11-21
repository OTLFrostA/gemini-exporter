import { OperationError } from '../../shared/errors/operationError.js';
import { isDirectoryHandle, type DirectoryHandle } from '../../shared/types/directoryHandle.js';
import { getStoredLocalVaultHandle } from '../../l3a/vaultStorageService.js';

/** Open the browser directory picker inside a user click gesture. */
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
    return handle;
}
