import type { DirectoryHandle } from '../../core/engine/writers/directoryHandle.js';
import { ensureV2Ready } from '../../core/api/runtimeReady.js';
import { getDirectoryHandle, setDirectoryHandle, clearDirectoryHandle } from '../../core/storage/storageService.js';

let current: DirectoryHandle | null = null;
let pending: DirectoryHandle | null = null;
export async function getStoredDirHandle(): Promise<DirectoryHandle | null> {
    await ensureV2Ready();
    return await getDirectoryHandle() as DirectoryHandle | null;
}
export async function saveStoredDirHandle(handle: DirectoryHandle | null): Promise<boolean> {
    await ensureV2Ready();
    if (handle) await setDirectoryHandle(handle); else await clearDirectoryHandle();
    return true;
}
export async function verifyDirPermission(handle: DirectoryHandle | null, options?: { allowRequest?: boolean }): Promise<boolean> {
    if (!handle) return false;
    if (options?.allowRequest && navigator.userActivation?.isActive) return await handle.requestPermission({ mode: 'readwrite' }) === 'granted';
    return await handle.queryPermission({ mode: 'readwrite' }) === 'granted';
}
export async function restoreSavedDirHandle(): Promise<DirectoryHandle | null> {
    const handle = await getStoredDirHandle();
    if (await verifyDirPermission(handle)) { current = handle; pending = null; }
    else { current = null; pending = handle; }
    return current;
}
export function getPendingPermissionHandle(): DirectoryHandle | null { return pending; }
export async function reauthorizeDirHandle(): Promise<boolean> {
    // Use a previously restored handle so requestPermission stays in the click gesture.
    const handle = pending || current;
    if (!handle) return false;
    if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') return false;
    await saveStoredDirHandle(handle);
    current = handle; pending = null;
    return true;
}
export async function requestDirHandle(): Promise<DirectoryHandle> {
    // The picker must be the first async operation in the user's click.
    if (!window.showDirectoryPicker) throw new Error('Directory picker unavailable');
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Directory permission not granted');
    await saveStoredDirHandle(handle);
    current = handle; pending = null;
    return handle;
}
export function getDirHandle(): DirectoryHandle | null { return current; }
export function setDirHandle(handle: DirectoryHandle | null): void { current = handle; pending = null; }
export const DirHandleController = { getStoredDirHandle, saveStoredDirHandle, verifyDirPermission,
    restoreSavedDirHandle, getPendingPermissionHandle, reauthorizeDirHandle, requestDirHandle, getDirHandle, setDirHandle };
export default DirHandleController;
