import { readStreamCoverage, type StreamCoverage } from '../domain/streamCoverage.js';
import { getStorageKeys, withConversationLock } from './conversationCatalogStore.js';
import { assertSchemaWritable } from './schemaState.js';

/** Physical account bucket; each stream contains exactly the L2 StreamCoverage schema. */
export async function getCoverage(accountId: string, streamId: string): Promise<StreamCoverage | null> {
    const key = getStorageKeys(accountId).coverageKey;
    const bucket = (await chrome.storage.local.get<Record<string, unknown>>([key]))[key];
    return readStreamCoverage(bucket && typeof bucket === 'object' ? Reflect.get(bucket, streamId) : undefined);
}
export async function transactCoverage<T>(accountId: string, streamId: string,
    update: (current: StreamCoverage | null) => { value: T; coverage?: StreamCoverage }): Promise<T> {
    return withConversationLock(async () => {
        await assertSchemaWritable();
        const key = getStorageKeys(accountId).coverageKey;
        const raw = (await chrome.storage.local.get<Record<string, unknown>>([key]))[key];
        const bucket = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        const result = update(readStreamCoverage(Reflect.get(bucket, streamId)));
        if (result.coverage) await chrome.storage.local.set({ [key]: { ...bucket, [streamId]: result.coverage } });
        return result.value;
    });
}
