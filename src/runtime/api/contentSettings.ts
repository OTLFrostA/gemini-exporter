import type { GlobalSettings } from '../../l2/settings.js';

const SETTINGS_KEY = 'gemini_exporter_v2_settings';

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Read-only Content-world settings projection over chrome.storage.local, without L3a IndexedDB or Web Locks. */
export async function readContentSettings(): Promise<GlobalSettings> {
    const [data, legacy] = await Promise.all([
        chrome.storage.local.get<Record<string, unknown>>(SETTINGS_KEY),
        chrome.storage.local.get<Record<string, unknown>>('gemini_suppress_direct_write_prompt'),
    ]);
    const raw = object(data[SETTINGS_KEY]) ? data[SETTINGS_KEY] : {};
    const enabledDisk = typeof raw.enabledDisk === 'boolean' ? raw.enabledDisk : false;
    const defaultFormat = raw.defaultFormat === 'markdown' || raw.defaultFormat === 'html'
        || raw.defaultFormat === 'pdf' || raw.defaultFormat === 'docx' || raw.defaultFormat === 'json'
        ? raw.defaultFormat : 'markdown';
    const exportDelivery = raw.exportDelivery === 'browserDownload' || raw.exportDelivery === 'folderWriter'
        ? raw.exportDelivery : (enabledDisk ? 'folderWriter' : 'browserDownload');
    const pos = raw.badgePosition;
    const badgePosition = object(pos) && typeof pos.left === 'number' && Number.isFinite(pos.left)
        && typeof pos.top === 'number' && Number.isFinite(pos.top) ? { left: pos.left, top: pos.top } : undefined;
    return {
        defaultFormat,
        skipExported: typeof raw.skipExported === 'boolean' ? raw.skipExported : true,
        includeAssets: typeof raw.includeAssets === 'boolean' ? raw.includeAssets : false,
        enabledDisk,
        exportDelivery,
        developerMode: typeof raw.developerMode === 'boolean' ? raw.developerMode : false,
        ...(raw.theme === 'dark' || raw.theme === 'light' ? { theme: raw.theme } : {}),
        ...(raw.language === 'zh' || raw.language === 'en' ? { language: raw.language } : {}),
        ...(badgePosition ? { badgePosition } : {}),
        ...(typeof raw.lastSeenFeatureVersion === 'string' ? { lastSeenFeatureVersion: raw.lastSeenFeatureVersion } : {}),
        ...(raw.takeoutPromptCompleted === true ? { takeoutPromptCompleted: true } : {}),
        ...(raw.ratingPromptDismissed === true ? { ratingPromptDismissed: true } : {}),
        ...(raw.directWritePromptCompleted === true || legacy.gemini_suppress_direct_write_prompt === true
            ? { directWritePromptCompleted: true } : {}),
    };
}

export function isContentLiveSaveEffective(settings: GlobalSettings, directoryAvailable: boolean): boolean {
    return settings.enabledDisk && settings.exportDelivery === 'folderWriter'
        && settings.defaultFormat === 'markdown' && directoryAvailable;
}
