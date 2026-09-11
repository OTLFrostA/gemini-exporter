// src/ui/controllers/dirHandleController.ts - Directory Handle Persistence & Permission Controller
import type { DirHandleControllerContract } from '../../types/ui.js';
const t = (key: string, ...args: any[]): string => {
    const g: any = (typeof I18n !== 'undefined' ? I18n : (typeof globalThis !== 'undefined' ? (globalThis as any).I18n : null));
    return g && typeof g.t === 'function' ? g.t(key, ...args) : key;
};

const IDB_NAME = 'gemini_exporter_idb';
const IDB_STORE = 'handles';
const IDB_KEY = 'export_dir_handle';
let currentDirHandle: any = null;

function openHandleDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            return reject(new Error('IndexedDB is not available'));
        }
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveStoredDirHandle(handle: any): Promise<boolean> {
    try {
        const db = await openHandleDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            if (handle === null || handle === undefined) {
                tx.objectStore(IDB_STORE).delete(IDB_KEY);
            } else {
                tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
            }
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('Failed to save dir handle to IndexedDB:', e);
        return false;
    }
}

export async function getStoredDirHandle(): Promise<any> {
    try {
        const db = await openHandleDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn('Failed to get dir handle from IndexedDB:', e);
        return null;
    }
}

export async function verifyDirPermission(handle: any): Promise<boolean> {
    if (!handle) return false;
    try {
        const opts = { mode: 'readwrite' };
        if ((await handle.queryPermission(opts)) !== 'granted') {
            if ((await handle.requestPermission(opts)) !== 'granted') {
                return false;
            }
        }
        // Physical existence check:
        // Even if permission was granted, if the directory was deleted from the disk,
        // querying keys() will immediately throw a NotFoundError!
        for await (const _ of handle.keys()) {
            break;
        }
        return true;
    } catch (e: any) {
        if (e?.name === 'NotFoundError' || e?.message?.includes('not be found')) {
            console.warn('[DirHandleController] Target directory was deleted from disk:', e);
        }
        return false;
    }
}

export async function restoreSavedDirHandle(): Promise<any> {
    try {
        const handle = await getStoredDirHandle();
        if (handle) {
            const ok = await verifyDirPermission(handle);
            if (!ok) {
                currentDirHandle = null;
                // Delete stale handle from IndexedDB so we don't keep referencing a deleted directory!
                await saveStoredDirHandle(null);
                console.warn('[DirHandle] Restored handle invalid or deleted on disk, cleared from storage');
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
