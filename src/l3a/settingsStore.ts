import type { GlobalSettings } from '../application/settings/index.js';

export const SETTINGS_KEY = 'gemini_exporter_v2_settings';
export async function getStoredSettings(): Promise<Partial<GlobalSettings>> {
    // Honor the v1 one-time acknowledgement without replaying the same tip after upgrading.
    const data = await chrome.storage.local.get<{
        [SETTINGS_KEY]?: Partial<GlobalSettings>;
        gemini_suppress_direct_write_prompt?: boolean;
    }>([SETTINGS_KEY, 'gemini_suppress_direct_write_prompt']);
    return { ...(data[SETTINGS_KEY] ?? {}),
        ...(data.gemini_suppress_direct_write_prompt ? { directWritePromptCompleted: true as const } : {}) };
}
export async function patchStoredSettings(patch: Partial<GlobalSettings>): Promise<void> {
    await navigator.locks.request(SETTINGS_KEY, async () => {
        const current = await getStoredSettings();
        await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...patch } });
    });
}
