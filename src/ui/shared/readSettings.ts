import { getSettings, type GlobalSettings } from '../../application/settings/index.js';
import { useSettings } from './settings.js';

export async function readSettings(): Promise<GlobalSettings> {
    const settings = await getSettings();
    useSettings(settings);
    return settings;
}
