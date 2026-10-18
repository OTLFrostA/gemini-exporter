import type { DirHandleControllerContract, DirectoryHandle } from '../../types/ui.js';
import { t } from '../uiCommon.js';
import { getErrorMessage } from '../../core/utils/messaging.js';

import { getDirectoryHandle, setDirectoryHandle, clearDirectoryHandle } from '../../core/storage/storageService.js';
export async function getStoredDirHandle(): Promise<DirectoryHandle | null> {
    const handle = await getDirectoryHandle();
    if (!handle) return null;
    if (!('queryPermission' in handle) || typeof handle.queryPermission !== 'function'
        || !('requestPermission' in handle) || typeof handle.requestPermission !== 'function') {
        throw new Error('Stored directory does not support permission checks');
    }
    return handle as DirectoryHandle;
}
export async function saveStoredDirHandle(handle: DirectoryHandle | null): Promise<void> {
    if (handle) await setDirectoryHandle(handle);
    else await clearDirectoryHandle();
}

let currentDirHandle: DirectoryHandle | null = null;
let pendingPermissionHandle: DirectoryHandle | null = null;

export async function verifyDirPermission(handle: DirectoryHandle | null, options?: { allowRequest?: boolean }): Promise<boolean> {
    const r = await verifyDirPermissionDetailed(handle, options);
    return r.ok;
}

interface DirVerifyResult { ok: boolean; notFound: boolean; }

async function verifyDirPermissionDetailed(handle: DirectoryHandle | null, options?: { allowRequest?: boolean }): Promise<DirVerifyResult> {
    if (!handle) return { ok: false, notFound: false };
    try {
        const opts = { mode: 'readwrite' } as const;
        const hasActivation = typeof navigator !== 'undefined' &&
            !!navigator.userActivation && navigator.userActivation.isActive;
        if ((await handle.queryPermission(opts)) !== 'granted') {
            if ((options && options.allowRequest) || hasActivation) {
                if ((await handle.requestPermission(opts)) !== 'granted') {
                    return { ok: false, notFound: false };
                }
            } else {
                return { ok: false, notFound: false };
            }
        }
        // Physical existence check: even if permission is granted, if directory was deleted from disk,
        // querying keys() throws NotFoundError immediately.
        for await (const _ of handle.keys()) {
            break;
        }
        return { ok: true, notFound: false };
    } catch (e: unknown) {
        const notFound = (e instanceof Error && e.name === 'NotFoundError') || getErrorMessage(e).includes('not be found');
        if (notFound) {
            console.warn('[DirHandleController] Target directory was deleted from disk:', e);
        }
        return { ok: false, notFound };
    }
}

export async function restoreSavedDirHandle(): Promise<DirectoryHandle | null> {
    try {
        const handle = await getStoredDirHandle();
        if (handle) {
            const r = await verifyDirPermissionDetailed(handle);
            if (!r.ok) {
                currentDirHandle = null;
                if (r.notFound) {
                    // Delete stale handle from storage when directory no longer exists on disk
                    await saveStoredDirHandle(null);
                    pendingPermissionHandle = null;
                    console.warn('[DirHandle] Restored handle invalid or deleted on disk, cleared from storage');
                } else {
                    // Browser degraded permission to 'prompt'; preserve handle for 1-click reauthorization
                    pendingPermissionHandle = handle;
                    console.info('[DirHandle] Stored handle permission is prompt. Preserving handle for 1-click reauthorization.');
                }
                return null;
            }
            currentDirHandle = handle;
            pendingPermissionHandle = null;
            return handle;
        }
    } catch (e) {
        console.warn('Failed to restore dir handle:', e);
    }
    return null;
}

export function getPendingPermissionHandle(): DirectoryHandle | null {
    return pendingPermissionHandle;
}

export async function reauthorizeDirHandle(): Promise<boolean> {
    const handle = pendingPermissionHandle || (await getStoredDirHandle());
    if (!handle) return false;
    try {
        const opts = { mode: 'readwrite' } as const;
        if (typeof handle.requestPermission === 'function') {
            const perm = await handle.requestPermission(opts);
            if (perm === 'granted') {
                currentDirHandle = handle;
                pendingPermissionHandle = null;
                await saveStoredDirHandle(handle);
                return true;
            }
        }
    } catch (err) {
        console.warn('[DirHandle] reauthorizeDirHandle failed:', err);
    }
    return false;
}

export async function requestDirHandle(): Promise<DirectoryHandle> {
    if (typeof window === 'undefined' || !window.showDirectoryPicker) {
        throw new Error(typeof t === 'function' ? t('browserNoDirPicker') : '当前浏览器不支持 FileSystem Access API 目录选择');
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    currentDirHandle = handle;
    pendingPermissionHandle = null;
    await saveStoredDirHandle(handle);
    return handle;
}

export function getDirHandle(): DirectoryHandle | null {
    return currentDirHandle;
}

export function setDirHandle(handle: DirectoryHandle | null): void {
    currentDirHandle = handle;
    if (handle) pendingPermissionHandle = null;
}

export const DirHandleController: DirHandleControllerContract = {
    saveStoredDirHandle,
    getStoredDirHandle,
    verifyDirPermission,
    restoreSavedDirHandle,
    requestDirHandle,
    getDirHandle,
    setDirHandle,
    getPendingPermissionHandle,
    reauthorizeDirHandle
};

export default DirHandleController;
