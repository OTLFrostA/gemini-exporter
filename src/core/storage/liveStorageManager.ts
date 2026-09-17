// src/core/storage/liveStorageManager.ts - Live Auto-Save configuration and Directory Handle persistence
import type { LiveSaveConfig } from '../../types/liveSave.js';
import { __resolveModule } from '../utils/moduleOverrides.js';
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
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
            const d = await chrome.storage.local.get([KEY_CONFIG]);
            if (d && d[KEY_CONFIG]) {
                _memConfig = { ...DEFAULT_LIVE_CONFIG, ...d[KEY_CONFIG] };
                return { ..._memConfig };
            }
        } catch {
        }
    }
    return { ..._memConfig };
}

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

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                await chrome.storage.local.set({ [KEY_CONFIG]: updated });
            } catch (err) {
                console.warn('[LiveStorageManager] Failed to set config in chrome.storage.local:', err);
                return { ..._memConfig };
            }
        }
        _memConfig = { ...updated };
        return { ..._memConfig };
    });
}

export async function saveLiveDirHandle(handle: any): Promise<boolean> {
    const ok = await saveStoredDirHandle(handle);
    const dhc = __resolveModule('DirHandleController', null);
    if (ok && dhc?.setDirHandle) {
        dhc.setDirHandle(handle);
    }
    return ok;
}

export async function getLiveDirHandle(): Promise<any> {
    const dhc = __resolveModule('DirHandleController', null);
    if (dhc?.getDirHandle) {
        const memHandle = dhc.getDirHandle();
        if (memHandle) return memHandle;
    }
    return getStoredDirHandle();
}

export async function clearLiveDirHandle(): Promise<boolean> {
    const ok = await clearStoredDirHandle();
    const dhc = __resolveModule('DirHandleController', null);
    if (ok && dhc?.setDirHandle) {
        dhc.setDirHandle(null);
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

export default LiveStorageManager;
