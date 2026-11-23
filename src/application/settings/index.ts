import { getStoredSettings, patchStoredSettings } from '../../l3a/storageService.js';
import { isLiveSaveEffective } from '../../shared/types/settings.js';
import type { GlobalSettings } from '../../l2/settings.js';
export { isLiveSaveEffective, type GlobalSettings };

export async function getSettings(): Promise<GlobalSettings> {
    const stored = await getStoredSettings();
    return { defaultFormat: 'markdown', skipExported: true,
        includeAssets: false, enabledDisk: false, developerMode: false,
        ...stored,
        // Existing Live Save users continue in folder mode; new users default to browser download.
        exportDelivery: stored.exportDelivery ?? (stored.enabledDisk ? 'folderWriter' : 'browserDownload') };
}
export function updateSettings(patch: Partial<GlobalSettings>): Promise<void> {
    return patchStoredSettings(patch);
}
