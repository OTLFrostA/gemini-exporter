import { resolveTitle, isTitleSource, type TitleSource } from './titleAuthority.js';
import { readConversationKey, sameConversationKey, type ConversationKey } from './conversationKey.js';

export interface DomainConversationIndex {
    key: ConversationKey;
    title?: string;
    titleSource?: TitleSource;
    createdAt?: number;
    updatedAt?: number;
}
export type ConversationIndexPatch = Partial<Omit<DomainConversationIndex, 'key'>>;
const keys = new Set(['key', 'title', 'titleSource', 'createdAt', 'updatedAt']);
export function restoreConversationIndex(value: unknown): DomainConversationIndex {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid conversation index');
    const raw = value as Record<string, unknown>;
    const key = readConversationKey(raw.key);
    const { title, titleSource, createdAt, updatedAt } = raw;
    if (Object.keys(raw).some(k => !keys.has(k))
        || (title === undefined) !== (titleSource === undefined)
        || title !== undefined && (typeof title !== 'string' || !title || title !== title.trim() || typeof titleSource !== 'string' || !isTitleSource(titleSource))
        || createdAt !== undefined && (typeof createdAt !== 'number' || !Number.isFinite(createdAt))
        || updatedAt !== undefined && (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt))) throw new TypeError('Invalid conversation index schema');
    return { key, ...(title !== undefined ? { title: title as string, titleSource: titleSource as TitleSource } : {}),
        ...(createdAt !== undefined ? { createdAt: createdAt as number } : {}), ...(updatedAt !== undefined ? { updatedAt: updatedAt as number } : {}) };
}

/** Missing facts preserve values. At the same title authority, the latest admission wins. */
export function mergeConversationIndex(old: DomainConversationIndex | undefined, incoming: DomainConversationIndex): DomainConversationIndex {
    if (!old) return restoreConversationIndex(incoming);
    if (!sameConversationKey(old.key, incoming.key)) throw new TypeError('Conversation index identity mismatch');
    const chosen = resolveTitle([old, incoming].flatMap(index => index.title && index.titleSource
        ? [{ value: index.title, source: index.titleSource }] : []));
    const title = chosen ? { title: chosen.value, titleSource: chosen.source } : {};
    const createdAt = old.createdAt === undefined ? incoming.createdAt : incoming.createdAt === undefined ? old.createdAt : Math.min(old.createdAt, incoming.createdAt);
    const updatedAt = old.updatedAt === undefined ? incoming.updatedAt : incoming.updatedAt === undefined ? old.updatedAt : Math.max(old.updatedAt, incoming.updatedAt);
    return { key: { ...old.key }, ...(title.title !== undefined ? { title: title.title, titleSource: title.titleSource! } : {}),
        ...(createdAt !== undefined ? { createdAt } : {}), ...(updatedAt !== undefined ? { updatedAt } : {}) };
}
export function indexActivityTime(index: Pick<DomainConversationIndex, 'updatedAt'>): number | undefined { return index.updatedAt; }
export function compareConversationIndexes(a: DomainConversationIndex, b: DomainConversationIndex): number {
    const left = a.updatedAt, right = b.updatedAt;
    if (left === undefined) return right === undefined ? 0 : 1;
    return right === undefined ? -1 : right - left;
}
