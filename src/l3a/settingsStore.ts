import { SETTINGS_KEY, LEGACY_DIRECT_WRITE_PROMPT_KEY } from '../shared/types/settings.js';
import type { GlobalSettings } from '../l2/settings.js';

export { SETTINGS_KEY };

export async function getStoredSettings(): Promise<Partial<GlobalSettings>> {
    // Keep the canonical single-key Settings read: the first-paint theme bootstrap
    // and UI must observe the same awaited read before applying the stored theme.
    const [data, legacy] = await Promise.all([
        chrome.storage.local.get<{ [SETTINGS_KEY]?: Partial<GlobalSettings> }>(SETTINGS_KEY),
        chrome.storage.local.get<{ [LEGACY_DIRECT_WRITE_PROMPT_KEY]?: boolean }>(LEGACY_DIRECT_WRITE_PROMPT_KEY),
    ]);
    // Honor the v1 one-time acknowledgement without replaying the tip after upgrading.
    return { ...(data[SETTINGS_KEY] ?? {}),
        ...(legacy[LEGACY_DIRECT_WRITE_PROMPT_KEY] ? { directWritePromptCompleted: true } : {}) };
}
export async function patchStoredSettings(patch: Partial<GlobalSettings>): Promise<void> {
    await navigator.locks.request(SETTINGS_KEY, async () => {
        const current = await getStoredSettings();
        await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...patch } });
    });
}

const driveAccountKey = 'driveExportAccountEmail';
export async function readDriveExportAccount(): Promise<string | undefined> {
    const email: unknown = (await chrome.storage.local.get(driveAccountKey))[driveAccountKey];
    if (email === undefined) return;
    if (typeof email !== 'string' || !email) throw new Error('Invalid saved Drive account');
    return email;
}

export async function saveDriveExportAccount(email: string): Promise<void> {
    await chrome.storage.local.set({ [driveAccountKey]: email });
}
