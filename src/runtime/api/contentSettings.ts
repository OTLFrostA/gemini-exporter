import {
    SETTINGS_KEY,
    LEGACY_DIRECT_WRITE_PROMPT_KEY,
    normalizeGlobalSettings,
    isLiveSaveEffective,
    isAutoCaptureEnabled,
} from '../../shared/types/settings.js';
import type { GlobalSettings } from '../../l2/settings.js';

/** Read-only Content-world settings projection over chrome.storage.local, without L3a IndexedDB or Web Locks. */
export async function readContentSettings(): Promise<GlobalSettings> {
    const [data, legacy] = await Promise.all([
        chrome.storage.local.get<Record<string, unknown>>(SETTINGS_KEY),
        chrome.storage.local.get<Record<string, unknown>>(LEGACY_DIRECT_WRITE_PROMPT_KEY),
    ]);
    return normalizeGlobalSettings(data[SETTINGS_KEY], legacy[LEGACY_DIRECT_WRITE_PROMPT_KEY]);
}

export const isContentLiveSaveEffective = isLiveSaveEffective;
export const isContentAutoCaptureEnabled = isAutoCaptureEnabled;
