import type { GlobalSettings } from '../application/settings/index.js';

export const SETTINGS_KEY = 'gemini_exporter_v2_settings';
export async function getStoredSettings(): Promise<Partial<GlobalSettings>> {
    const data = await chrome.storage.local.get<{ [SETTINGS_KEY]?: Partial<GlobalSettings> }>(SETTINGS_KEY);
    return data[SETTINGS_KEY] ?? {};
}
export async function patchStoredSettings(patch: Partial<GlobalSettings>): Promise<void> {
    await navigator.locks.request(SETTINGS_KEY, async () => {
        const current = await getStoredSettings();
        await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...patch } });
    });
}
