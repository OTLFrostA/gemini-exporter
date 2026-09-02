// src/ui/controllers/dirHandleController.js - Directory Handle Persistence & Permission Controller
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DirHandleController = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    const IDB_NAME = 'gemini_exporter_idb';
    const IDB_STORE = 'handles';
    const IDB_KEY = 'export_dir_handle';
    let currentDirHandle = null;

    function openHandleDB() {
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

    async function saveStoredDirHandle(handle) {
        try {
            const db = await openHandleDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.warn('Failed to save dir handle to IndexedDB:', e);
            return false;
        }
    }

    async function getStoredDirHandle() {
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

    async function verifyDirPermission(handle) {
        if (!handle) return false;
        try {
            const opts = { mode: 'readwrite' };
            if ((await handle.queryPermission(opts)) === 'granted') return true;
            if ((await handle.requestPermission(opts)) === 'granted') return true;
            return false;
        } catch {
            return false;
        }
    }

    async function restoreSavedDirHandle() {
        try {
            const handle = await getStoredDirHandle();
            if (handle) {
                currentDirHandle = handle;
                return handle;
            }
        } catch (e) {
            console.warn('Failed to restore dir handle:', e);
        }
        return null;
    }

    async function requestDirHandle() {
        if (typeof window === 'undefined' || !window.showDirectoryPicker) {
            throw new Error(typeof I18n !== 'undefined' ? I18n.t('browserNoDirPicker') : '当前浏览器不支持 FileSystem Access API 目录选择');
        }
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        currentDirHandle = handle;
        await saveStoredDirHandle(handle);
        return handle;
    }

    function getDirHandle() {
        return currentDirHandle;
    }

    function setDirHandle(handle) {
        currentDirHandle = handle;
    }

    return {
        saveStoredDirHandle,
        getStoredDirHandle,
        verifyDirPermission,
        restoreSavedDirHandle,
        requestDirHandle,
        getDirHandle,
        setDirHandle
    };
}));
