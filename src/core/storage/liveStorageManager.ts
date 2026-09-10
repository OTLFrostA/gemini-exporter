// src/core/storage/liveStorageManager.ts - Live Auto-Save IndexedDB persistence and configuration
import type { LiveConversationRecord, LiveSaveConfig } from '../../types/liveSave.js';

const DB_NAME = 'gemini_exporter_live_idb';
const DB_VERSION = 2;
const STORE_CONVERSATIONS = 'conversations';
const STORE_SETTINGS = 'settings';
const KEY_CONFIG = 'live_save_config';
const KEY_DIR_HANDLE = 'live_save_dir_handle';

export const DEFAULT_LIVE_CONFIG: LiveSaveConfig = {
    enabledDisk: false,
    format: 'markdown',
    includeAssets: true
};

function openLiveDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            return reject(new Error('IndexedDB is not available in current environment'));
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            // Purge legacy conversations object store to ensure zero conversation text remains in browser
            if (db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
                try {
                    db.deleteObjectStore(STORE_CONVERSATIONS);
                } catch {
                    /* ignore */
                }
            }
            if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
                db.createObjectStore(STORE_SETTINGS);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * @deprecated Legacy stub. Conversation text is no longer retained in browser storage.
 */
export async function saveLiveConversation(_record: Partial<LiveConversationRecord> & { id: string }): Promise<boolean> {
    return false;
}

export async function getLiveConversation(_id: string): Promise<LiveConversationRecord | null> {
    return null;
}

export async function listLiveConversations(): Promise<LiveConversationRecord[]> {
    return [];
}

export async function removeLiveConversation(_id: string): Promise<boolean> {
    return true;
}

export async function clearLiveConversations(): Promise<boolean> {
    return true;
}

export async function getLiveConfig(): Promise<LiveSaveConfig> {
    try {
        const db = await openLiveDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_SETTINGS, 'readonly');
            const store = tx.objectStore(STORE_SETTINGS);
            const req = store.get(KEY_CONFIG);
            req.onsuccess = () => {
                const stored = req.result;
                resolve({ ...DEFAULT_LIVE_CONFIG, ...(stored || {}) });
            };
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        // Fallback to chrome.storage.local or defaults
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                const d = await chrome.storage.local.get([KEY_CONFIG]);
                if (d && d[KEY_CONFIG]) {
                    return { ...DEFAULT_LIVE_CONFIG, ...d[KEY_CONFIG] };
                }
            } catch {
                /* intentional */
            }
        }
        return { ...DEFAULT_LIVE_CONFIG };
    }
}

export async function setLiveConfig(patch: Partial<LiveSaveConfig>): Promise<LiveSaveConfig> {
    const current = await getLiveConfig();
    const updated: LiveSaveConfig = { ...current, ...patch };
    try {
        const db = await openLiveDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_SETTINGS, 'readwrite');
            const store = tx.objectStore(STORE_SETTINGS);
            store.put(updated, KEY_CONFIG);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[LiveStorageManager] Failed to set config in IDB:', e);
    }
    // Also mirror to chrome.storage.local for cross-context visibility (e.g. Content Script & Options)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
            await chrome.storage.local.set({ [KEY_CONFIG]: updated });
        } catch {
            /* intentional */
        }
    }
    return updated;
}

export async function saveLiveDirHandle(handle: any): Promise<boolean> {
    try {
        const db = await openLiveDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_SETTINGS, 'readwrite');
            const store = tx.objectStore(STORE_SETTINGS);
            store.put(handle, KEY_DIR_HANDLE);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[LiveStorageManager] Failed to save dir handle:', e);
        return false;
    }
}

export async function getLiveDirHandle(): Promise<any> {
    try {
        const db = await openLiveDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_SETTINGS, 'readonly');
            const store = tx.objectStore(STORE_SETTINGS);
            const req = store.get(KEY_DIR_HANDLE);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn('[LiveStorageManager] Failed to get live dir handle:', e);
        return null;
    }
}

export async function clearLiveDirHandle(): Promise<boolean> {
    try {
        const db = await openLiveDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_SETTINGS, 'readwrite');
            const store = tx.objectStore(STORE_SETTINGS);
            store.delete(KEY_DIR_HANDLE);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[LiveStorageManager] Failed to clear live dir handle:', e);
        return false;
    }
}

export const LiveStorageManager = {
    DEFAULT_LIVE_CONFIG,
    saveLiveConversation,
    getLiveConversation,
    listLiveConversations,
    removeLiveConversation,
    clearLiveConversations,
    getLiveConfig,
    setLiveConfig,
    saveLiveDirHandle,
    getLiveDirHandle,
    clearLiveDirHandle
};

declare global {
    var LiveStorageManager: any;
}

if (typeof globalThis !== 'undefined') {
    (globalThis as any).LiveStorageManager = LiveStorageManager;
}

export default LiveStorageManager;
