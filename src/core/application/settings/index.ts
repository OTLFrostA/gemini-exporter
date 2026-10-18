import { getStoredSettings, patchStoredSettings } from '../../storage/storageService.js';
import type { ExportFormat } from '../export/types.js';

export interface GlobalSettings {
    defaultFormat: ExportFormat;
    useZip: boolean;
    skipExported: boolean;
    includeAssets: boolean;
    enabledDisk: boolean;
    developerMode: boolean;
    language?: 'zh' | 'en';
    badgePosition?: { left: number; top: number };
    tourAutoHandled?: true;
    lastSeenFeatureVersion?: string;
    takeoutPromptCompleted?: true;
    directWritePromptShown?: true;
    ratingPromptShown?: true;
}

export async function getSettings(): Promise<GlobalSettings> {
    return { defaultFormat: 'markdown', useZip: true, skipExported: true,
        includeAssets: true, enabledDisk: false, developerMode: false,
        ...await getStoredSettings() };
}
export function updateSettings(patch: Partial<GlobalSettings>): Promise<void> {
    return patchStoredSettings(patch);
}
export function isLiveSaveEffective(settings: GlobalSettings, directoryAvailable: boolean): boolean {
    return settings.enabledDisk && settings.defaultFormat === 'markdown' && directoryAvailable;
}
