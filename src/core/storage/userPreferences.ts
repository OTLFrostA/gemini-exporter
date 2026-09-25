// src/core/storage/userPreferences.ts - Isolated KV user preferences and UI state
import { STORAGE_KEYS } from "../utils/constants.js";
import { isVersionGreater as utilsIsVersionGreater } from "../utils/pathUtils.js";

export async function getDevMode(): Promise<boolean> {
    const data = await chrome.storage.local.get([STORAGE_KEYS.DEV_MODE]);
    return !!data[STORAGE_KEYS.DEV_MODE];
}

export async function setDevMode(enabled: boolean): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.DEV_MODE]: !!enabled });
}

export async function isTourCompleted(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return false;
    try {
        const data = await chrome.storage.local.get([STORAGE_KEYS.HAS_COMPLETED_TOUR]);
        return !!data[STORAGE_KEYS.HAS_COMPLETED_TOUR];
    } catch {
        return false;
    }
}

export async function setTourCompleted(completed: boolean = true): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.HAS_COMPLETED_TOUR]: !!completed });
    } catch (e) {
        console.warn("[GemExporter:storage] Storage operation failed:", e);
    }
}

/**
 * Compare two semantic versions: returns true if v1 > v2.
 * E.g. isVersionGreater('1.5.0', '1.4.3') => true
 */
export function isVersionGreater(v1: string, v2: string): boolean {
    return utilsIsVersionGreater(v1, v2);
}

export async function getLastSeenFeatureVersion(): Promise<string> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return '0.0.0';
    try {
        const data = await chrome.storage.local.get([STORAGE_KEYS.LAST_SEEN_FEATURE_VERSION]);
        return String(data[STORAGE_KEYS.LAST_SEEN_FEATURE_VERSION] || '0.0.0');
    } catch {
        return '0.0.0';
    }
}

export async function setLastSeenFeatureVersion(version: string): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SEEN_FEATURE_VERSION]: version });
    } catch (e) {
        console.warn("[GemExporter:storage] Storage operation failed:", e);
    }
}

export async function isTakeoutPromptCompleted(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return false;
    try {
        const data = await chrome.storage.local.get([STORAGE_KEYS.HAS_COMPLETED_TAKEOUT_PROMPT]);
        return !!data[STORAGE_KEYS.HAS_COMPLETED_TAKEOUT_PROMPT];
    } catch {
        return false;
    }
}

export async function setTakeoutPromptCompleted(completed: boolean = true): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.HAS_COMPLETED_TAKEOUT_PROMPT]: !!completed });
    } catch (e) {
        console.warn("[GemExporter:storage] Storage operation failed:", e);
    }
}

export async function isDirectWritePromptSuppressed(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return false;
    try {
        const data = await chrome.storage.local.get([STORAGE_KEYS.SUPPRESS_DIRECT_WRITE_PROMPT]);
        return !!data?.[STORAGE_KEYS.SUPPRESS_DIRECT_WRITE_PROMPT];
    } catch (e) {
        console.warn("[GemExporter:storage] Storage operation failed:", e);
        return false;
    }
}

export async function setDirectWritePromptSuppressed(suppressed: boolean = true): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.SUPPRESS_DIRECT_WRITE_PROMPT]: !!suppressed });
    } catch (e) {
        console.warn("[GemExporter:storage] Storage operation failed:", e);
    }
}

export async function getZipPreference(defaultValue: boolean = true): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return defaultValue;
    try {
        const data = await chrome.storage.local.get([STORAGE_KEYS.ZIP]);
        if (typeof (data as any)?.[STORAGE_KEYS.ZIP] !== 'undefined') {
            return !!(data as any)[STORAGE_KEYS.ZIP];
        }
        return defaultValue;
    } catch {
        return defaultValue;
    }
}

export async function setZipPreference(useZip: boolean): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.ZIP]: !!useZip });
    } catch (e) {
        console.warn("[GemExporter:storage] Storage operation failed:", e);
    }
}

export async function setBadgePosition(pos: { left: number; top: number }): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.BADGE_POS]: pos });
    } catch (e) {
        console.warn("[GemExporter:storage] Storage operation failed:", e);
    }
}

export async function setLastSyncDiagnostics(diagnostics: any): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SYNC_DIAGNOSTICS]: diagnostics });
    } catch (e) {
        console.warn("[GemExporter:storage] Storage operation failed:", e);
    }
}

export async function setPendingTakeoutPrompt(payload: any): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_TAKEOUT_PROMPT]: payload });
    } catch (e) {
        console.warn("[GemExporter:storage] Storage operation failed:", e);
    }
}

export async function setLanguagePreference(lang: string): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.LANG]: lang });
    } catch (e) {
        console.warn("[GemExporter:storage] Storage operation failed:", e);
    }
}
