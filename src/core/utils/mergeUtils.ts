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
