import { requestPlatformAccess } from '../../l1/client/platformAccess.js';
import { syncPlatformContentScripts } from './platformInjection.js';

export async function requestGeminiConnection(): Promise<boolean> {
    const granted = await requestPlatformAccess('gemini');
    if (granted) await syncPlatformContentScripts('gemini');
    return granted;
}
