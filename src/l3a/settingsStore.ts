import type { GlobalSettings } from '../l2/settings.js';

export const SETTINGS_KEY = 'gemini_exporter_v2_settings';
/** Content scripts can read chrome.storage.local, so credentials never stay in Settings. */
const RETIRED_SETTINGS_KEYS = ['cloudSyncAccessCode'];

function withoutRetired(settings: Partial<GlobalSettings>): Partial<GlobalSettings> {
    return Object.fromEntries(Object.entries(settings).filter(([key]) => !RETIRED_SETTINGS_KEYS.includes(key)));
}

export async function getStoredSettings(): Promise<Partial<GlobalSettings>> {
    // Keep the canonical single-key Settings read: the first-paint theme bootstrap
    // and UI must observe the same awaited read before applying the stored theme.
    const [data, legacy] = await Promise.all([
        chrome.storage.local.get<{ [SETTINGS_KEY]?: Partial<GlobalSettings> }>(SETTINGS_KEY),
        chrome.storage.local.get<{ gemini_suppress_direct_write_prompt?: boolean }>('gemini_suppress_direct_write_prompt'),
    ]);
    // Honor the v1 one-time acknowledgement without replaying the tip after upgrading.
    return { ...withoutRetired(data[SETTINGS_KEY] ?? {}),
        ...(legacy.gemini_suppress_direct_write_prompt ? { directWritePromptCompleted: true } : {}) };
}
/** Every patch rewrites the whole key, which also erases retired fields left by older builds. */
export async function patchStoredSettings(patch: Partial<GlobalSettings>): Promise<void> {
    await navigator.locks.request(SETTINGS_KEY, async () => {
        const current = await getStoredSettings();
        await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...patch } });
    });
}
