import { getStorageKeys, withConversationLock } from './conversationCatalogStore.js';
export type ConversationAvailability = 'available' | 'deleted' | 'unlisted' | 'unknown';
const cache = new Map<string, Record<string, ConversationAvailability>>();
/** Sync observations are execution state, separate from the canonical Index/Detail. */
export async function getConversationAvailability(accountId: string): Promise<Record<string, ConversationAvailability>> {
    getStorageKeys(accountId);
    const key = `conversation_availability_${accountId}`;
    const data = await chrome.storage.local.get<Record<string, unknown>>([key]);
    const value = data[key];
    const map: Record<string, ConversationAvailability> = {};
    if (value && typeof value === 'object' && !Array.isArray(value)) for (const [id, state] of Object.entries(value)) {
        if (state === 'available' || state === 'deleted' || state === 'unlisted' || state === 'unknown') map[id] = state;
    }
    cache.set(accountId, map);
    return map;
}
export function cachedConversationAvailability(accountId: string): Readonly<Record<string, ConversationAvailability>> { return cache.get(accountId) ?? {}; }
export async function setConversationAvailability(accountId: string, id: string, state: ConversationAvailability): Promise<void> {
    await withConversationLock(async () => {
        const map = await getConversationAvailability(accountId);
        map[id] = state;
        await chrome.storage.local.set({ [`conversation_availability_${accountId}`]: map });
    });
}
