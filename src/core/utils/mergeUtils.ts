import { mergeConversationIndex, compareConversationIndexes, type DomainConversationIndex } from '../domain/conversationIndex.js';

export interface MergeConversationResult {
    merged: DomainConversationIndex;
    isChanged: boolean;
}
export function mergeConversation(old: DomainConversationIndex | undefined, incoming: DomainConversationIndex): MergeConversationResult {
    const merged = mergeConversationIndex(old, incoming);
    return { merged, isChanged: !old || JSON.stringify(old) !== JSON.stringify(merged) };
}
export interface DeduplicateResult { processed: DomainConversationIndex[]; changedCount: number }
/** Already-normalized metadata only. Never interprets provider, disk, or body fields. */
export function deduplicateConversations(list: readonly DomainConversationIndex[]): DeduplicateResult {
    const map = new Map<string, DomainConversationIndex>();
    let changedCount = 0;
    for (const item of list) {
        const key = JSON.stringify([item.providerId, item.id]);
        const result = mergeConversation(map.get(key), item);
        if (result.isChanged) changedCount++;
        map.set(key, result.merged);
    }
    return { processed: [...map.values()].sort(compareConversationIndexes), changedCount };
}
export interface TakeoutMergePlan { processed: DomainConversationIndex[]; addedCount: number; changed: number }
export function planTakeoutMerge(existing: readonly DomainConversationIndex[], incoming: readonly DomainConversationIndex[]): TakeoutMergePlan | null {
    const result = deduplicateConversations([...existing, ...incoming]);
    if (JSON.stringify(result.processed) === JSON.stringify(existing)) return null;
    const old = new Map(existing.map(item => [JSON.stringify([item.providerId, item.id]), item]));
    return { processed: result.processed, addedCount: result.processed.filter(item => !old.has(JSON.stringify([item.providerId, item.id]))).length,
        changed: result.processed.filter(item => JSON.stringify(item) !== JSON.stringify(old.get(JSON.stringify([item.providerId, item.id])))).length };
}
