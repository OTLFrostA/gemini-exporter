// src/ui/controllers/dirHandleController.ts - Directory Handle Persistence & Permission Controller
import type { DirHandleControllerContract } from '../../types/ui.js';
import { t } from '../uiCommon.js';

import { getStoredDirHandle, saveStoredDirHandle } from '../../core/storage/idbHandleStore.js';
export { getStoredDirHandle, saveStoredDirHandle };

let currentDirHandle: any = null;

export async function verifyDirPermission(handle: any, options?: { allowRequest?: boolean }): Promise<boolean> {
    const r = await verifyDirPermissionDetailed(handle, options);
    return r.ok;
}

interface DirVerifyResult { ok: boolean; notFound: boolean; }

async function verifyDirPermissionDetailed(handle: any, options?: { allowRequest?: boolean }): Promise<DirVerifyResult> {
    if (!handle) return { ok: false, notFound: false };
    try {
        const opts = { mode: 'readwrite' };
        // P1-119(a): never call requestPermission without a user gesture —
        // on restore it either throws or pops a confusing prompt. Restore
        // paths only query; a real user-gesture handler may pass
        // { allowRequest: true }, and transient activation is honored too.
        const hasActivation = typeof navigator !== 'undefined' &&
            !!(navigator as any).userActivation && (navigator as any).userActivation.isActive;
        if ((await handle.queryPermission(opts)) !== 'granted') {
            if ((options && options.allowRequest) || hasActivation) {
                if ((await handle.requestPermission(opts)) !== 'granted') {
                    return { ok: false, notFound: false };
                }
            } else {
                return { ok: false, notFound: false };
            }
        }
        // Physical existence check:
        // Even if permission was granted, if the directory was deleted from the disk,
        // querying keys() will immediately throw a NotFoundError!
        for await (const _ of handle.keys()) {
            break;
        }
        return { ok: true, notFound: false };
    } catch (e: any) {
        const notFound = e?.name === 'NotFoundError' || e?.message?.includes('not be found');
        if (notFound) {
            console.warn('[DirHandleController] Target directory was deleted from disk:', e);
        }
        return { ok: false, notFound };
    }
}

export async function restoreSavedDirHandle(): Promise<any> {
    try {
        const handle = await getStoredDirHandle();
        if (handle) {
            // Restore path: requestPermission is only attempted when the
            // browser reports transient user activation (see above).
            const r = await verifyDirPermissionDetailed(handle);
            if (!r.ok) {
                currentDirHandle = null;
                // P1-119(b): only drop the persisted handle on a CONFIRMED
                // NotFoundError. A transient 'prompt' permission state is not
                // proof the directory is gone — keep it for the next
                // user-gesture attempt instead of forcing a re-pick.
                if (r.notFound) {
                    // Delete stale handle from IndexedDB so we don't keep referencing a deleted directory!
                    await saveStoredDirHandle(null);
                    console.warn('[DirHandle] Restored handle invalid or deleted on disk, cleared from storage');
                }
                return null;
            }
            currentDirHandle = handle;
            return handle;
        }
    } catch (e) {
        console.warn('Failed to restore dir handle:', e);
    }
    return null;
}

export async function requestDirHandle(): Promise<any> {
    if (typeof window === 'undefined' || !(window as any).showDirectoryPicker) {
        throw new Error(typeof t === 'function' ? t('browserNoDirPicker') : '当前浏览器不支持 FileSystem Access API 目录选择');
    }
    const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    currentDirHandle = handle;
    await saveStoredDirHandle(handle);
    return handle;
}

export function getDirHandle(): any {
    return currentDirHandle;
}

export function setDirHandle(handle: any): void {
    currentDirHandle = handle;
}

export const DirHandleController: DirHandleControllerContract = {
    saveStoredDirHandle,
    getStoredDirHandle,
    verifyDirPermission,
    restoreSavedDirHandle,
    requestDirHandle,
    getDirHandle,
    setDirHandle
};

(DirHandleController as any).DirHandleController = DirHandleController;
(DirHandleController as any).default = DirHandleController;

if (typeof globalThis !== 'undefined') {
    (globalThis as any).DirHandleController = DirHandleController;
}
if (typeof module === 'object' && module.exports) {
    module.exports = DirHandleController;
}

export default DirHandleController;
