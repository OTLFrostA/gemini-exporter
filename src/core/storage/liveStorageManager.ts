// src/core/storage/liveStorageManager.ts - Live Auto-Save IndexedDB persistence and configuration
import type { LiveConversationRecord, LiveSaveConfig } from '../../types/liveSave.js';

const DB_NAME = 'gemini_exporter_live_idb';
const DB_VERSION = 1;
const STORE_CONVERSATIONS = 'conversations';
const STORE_SETTINGS = 'settings';
const KEY_CONFIG = 'live_save_config';
const KEY_DIR_HANDLE = 'live_save_dir_handle';

export const DEFAULT_LIVE_CONFIG: LiveSaveConfig = {
    enabledDb: true,
    enabledDisk: false,
    format: 'markdown',
    includeAssets: true,
    updateIndex: true
};

function openLiveDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            return reject(new Error('IndexedDB is not available in current environment'));
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
                db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
                db.createObjectStore(STORE_SETTINGS);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveLiveConversation(record: Partial<LiveConversationRecord> & { id: string }): Promise<boolean> {
    if (!record || !record.id) return false;
    try {
        const db = await openLiveDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CONVERSATIONS, 'readwrite');
            const store = tx.objectStore(STORE_CONVERSATIONS);
            const now = Date.now();
            const normalized: LiveConversationRecord = {
                id: String(record.id).replace(/^c_/, '').trim(),
                title: record.title || 'Untitled',
                messages: Array.isArray(record.messages) ? record.messages : [],
                timestamp: record.timestamp || now,
                updatedAt: record.updatedAt || now,
                savedAt: now,
                turnCount: Array.isArray(record.messages) ? record.messages.length : 0,
                accountSlot: record.accountSlot || 'u0',
                format: record.format || 'markdown',
                hasImages: !!record.hasImages
            };
            store.put(normalized);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[LiveStorageManager] Failed to save conversation snapshot:', e);
        return false;
    }
}

export async function getLiveConversation(id: string): Promise<LiveConversationRecord | null> {
    if (!id) return null;
    const nid = String(id).replace(/^c_/, '').trim();
    try {
        const db = await openLiveDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CONVERSATIONS, 'readonly');
            const store = tx.objectStore(STORE_CONVERSATIONS);
            const req = store.get(nid);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn('[LiveStorageManager] Failed to get live conversation:', e);
        return null;
    }
}

export async function listLiveConversations(): Promise<LiveConversationRecord[]> {
    try {
        const db = await openLiveDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CONVERSATIONS, 'readonly');
            const store = tx.objectStore(STORE_CONVERSATIONS);
            const req = store.getAll();
            req.onsuccess = () => {
                const results: LiveConversationRecord[] = req.result || [];
                results.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
                resolve(results);
            };
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn('[LiveStorageManager] Failed to list live conversations:', e);
        return [];
    }
}

export async function removeLiveConversation(id: string): Promise<boolean> {
    if (!id) return false;
    const nid = String(id).replace(/^c_/, '').trim();
    try {
        const db = await openLiveDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CONVERSATIONS, 'readwrite');
            const store = tx.objectStore(STORE_CONVERSATIONS);
            store.delete(nid);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[LiveStorageManager] Failed to remove live conversation:', e);
        return false;
    }
}

export async function clearLiveConversations(): Promise<boolean> {
    try {
        const db = await openLiveDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CONVERSATIONS, 'readwrite');
            const store = tx.objectStore(STORE_CONVERSATIONS);
            store.clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[LiveStorageManager] Failed to clear live conversations:', e);
        return false;
    }
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
