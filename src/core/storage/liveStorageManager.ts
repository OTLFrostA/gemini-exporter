// src/core/storage/liveStorageManager.ts - Live Auto-Save configuration and Directory Handle persistence
import type { LiveSaveConfig } from '../../types/liveSave.js';
import {
    getStoredDirHandle,
    saveStoredDirHandle,
    clearStoredDirHandle
} from './idbHandleStore.js';

export const DEFAULT_LIVE_CONFIG: LiveSaveConfig = {
    enabledDisk: false,
    format: 'markdown',
    includeAssets: true
};

const KEY_CONFIG = 'live_save_config';
let _memConfig: LiveSaveConfig = { ...DEFAULT_LIVE_CONFIG };

export async function getLiveConfig(): Promise<LiveSaveConfig> {
    // 1. SSoT: chrome.storage.local is the canonical source shared across Content Script, Options, and Background
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
            const d = await chrome.storage.local.get([KEY_CONFIG]);
            if (d && d[KEY_CONFIG]) {
                _memConfig = { ...DEFAULT_LIVE_CONFIG, ...d[KEY_CONFIG] };
                // P1-051: return a defensive copy, never the live internal reference.
                return { ..._memConfig };
            }
        } catch {
            /* intentional fallback */
        }
    }
    return { ..._memConfig };
}

// P1-050: serialize concurrent setLiveConfig read-modify-writes so two patches
// cannot read the same stale base and clobber each other's fields.
let _configChain: Promise<any> = Promise.resolve();
function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
    const p = _configChain.then(fn, fn);
    _configChain = p.then(() => undefined, () => undefined);
    return p;
}

export async function setLiveConfig(patch: Partial<LiveSaveConfig>): Promise<LiveSaveConfig> {
    return withConfigLock(async () => {
        const current = await getLiveConfig();
        const updated: LiveSaveConfig = { ...current, ...patch };

        // 1. SSoT: Save to chrome.storage.local first (P1-050: disk before memory,
        // so a failed write can never leave memory and disk diverged).
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                await chrome.storage.local.set({ [KEY_CONFIG]: updated });
            } catch (err) {
                console.warn('[LiveStorageManager] Failed to set config in chrome.storage.local:', err);
                // Memory keeps the last persisted value; report the effective config.
                return { ..._memConfig };
            }
        }
        _memConfig = { ...updated };
        return { ..._memConfig };
    });
}

export async function saveLiveDirHandle(handle: any): Promise<boolean> {
    // P1-052: persist to IDB first; only publish to the in-memory controller after
    // the disk write succeeds, otherwise a restart would lose the directory that
    // memory claims is configured.
    const ok = await saveStoredDirHandle(handle);
    if (ok && typeof globalThis !== 'undefined' && (globalThis as any).DirHandleController?.setDirHandle) {
        (globalThis as any).DirHandleController.setDirHandle(handle);
    }
    return ok;
}

export async function getLiveDirHandle(): Promise<any> {
    if (typeof globalThis !== 'undefined' && (globalThis as any).DirHandleController?.getDirHandle) {
        const memHandle = (globalThis as any).DirHandleController.getDirHandle();
        if (memHandle) return memHandle;
    }
    return getStoredDirHandle();
}

export async function clearLiveDirHandle(): Promise<boolean> {
    // P1-052: delete from IDB first; only clear the in-memory handle after the
    // disk delete succeeds, otherwise a failed delete resurrects the old handle
    // on restart while memory claims it is gone.
    const ok = await clearStoredDirHandle();
    if (ok && typeof globalThis !== 'undefined' && (globalThis as any).DirHandleController?.setDirHandle) {
        (globalThis as any).DirHandleController.setDirHandle(null);
    }
    return ok;
}

export const LiveStorageManager = {
    DEFAULT_LIVE_CONFIG,
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
