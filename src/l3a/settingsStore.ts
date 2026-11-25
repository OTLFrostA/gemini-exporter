import { SETTINGS_KEY, LEGACY_DIRECT_WRITE_PROMPT_KEY } from '../shared/types/settings.js';
import type { GlobalSettings } from '../l2/settings.js';
import { readDriveExportConnection } from '../shared/types/driveExport.js';

export { SETTINGS_KEY };

export async function getStoredSettings(): Promise<Partial<GlobalSettings>> {
    // Keep the canonical single-key Settings read: the first-paint theme bootstrap
    // and UI must observe the same awaited read before applying the stored theme.
    const [data, legacy] = await Promise.all([
        chrome.storage.local.get<{ [SETTINGS_KEY]?: Partial<GlobalSettings> }>(SETTINGS_KEY),
        chrome.storage.local.get<{ [LEGACY_DIRECT_WRITE_PROMPT_KEY]?: boolean }>(LEGACY_DIRECT_WRITE_PROMPT_KEY),
    ]);
    // Honor the v1 one-time acknowledgement without replaying the tip after upgrading.
    const raw = data[SETTINGS_KEY] ?? {};
    return { ...raw,
        ...(raw.driveExport !== undefined ? { driveExport: readDriveExportConnection(raw.driveExport) } : {}),
        ...(legacy[LEGACY_DIRECT_WRITE_PROMPT_KEY] ? { directWritePromptCompleted: true } : {}) };
}
export async function patchStoredSettings(patch: Partial<GlobalSettings>): Promise<void> {
    await navigator.locks.request(SETTINGS_KEY, async () => {
        const current = await getStoredSettings();
        await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...patch } });
    });
}
