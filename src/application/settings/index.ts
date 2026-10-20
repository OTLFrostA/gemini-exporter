import { getStoredSettings, patchStoredSettings } from '../../l3a/storageService.js';
import type { ExportFormat } from '../export/types.js';

export interface GlobalSettings {
    defaultFormat: ExportFormat;
    skipExported: boolean;
    includeAssets: boolean;
    enabledDisk: boolean;
    developerMode: boolean;
    theme?: 'dark' | 'light';
    language?: 'zh' | 'en';
    badgePosition?: { left: number; top: number };
    lastSeenFeatureVersion?: string;
    takeoutPromptCompleted?: true;
}

export async function getSettings(): Promise<GlobalSettings> {
    return { defaultFormat: 'markdown', skipExported: true,
        includeAssets: true, enabledDisk: false, developerMode: false,
        ...await getStoredSettings() };
}
export function updateSettings(patch: Partial<GlobalSettings>): Promise<void> {
    return patchStoredSettings(patch);
}
export function isLiveSaveEffective(settings: GlobalSettings, directoryAvailable: boolean): boolean {
    return settings.enabledDisk && settings.defaultFormat === 'markdown' && directoryAvailable;
}
