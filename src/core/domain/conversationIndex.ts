import { TITLE_AUTHORITY_RANK, isTitleSource, type TitleSource } from './titleAuthority.js';

/** Canonical metadata. Account ownership belongs to the repository scope, never this record. */
export interface DomainConversationIndex {
    providerId: string;
    id: string;
    /** Empty when no usable title has been established; presentation supplies its own label. */
    title: string;
    titleSource: TitleSource;
    /** Source-authored creation/activity times in epoch milliseconds; never local observation time. */
    createdAt?: number;
    updatedAt?: number;
    url?: string;
    cloudAvailability: 'unknown' | 'available' | 'unlisted' | 'deleted';
    /** Historical import fact, independent of the current title and cloud availability. */
    hasTakeoutImport: boolean;
    /** Largest observed number of individual messages. Not a declared total or a turn count. */
    messageCount?: number;
}

export type ConversationIndexPatch = Partial<Omit<DomainConversationIndex, 'id' | 'providerId'>>;
const keys = new Set(['providerId', 'id', 'title', 'titleSource', 'createdAt', 'updatedAt', 'url',
    'cloudAvailability', 'hasTakeoutImport', 'messageCount']);

function isConversationUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value !== value.trim()) return false;
    try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; }
}

function isIndexRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Physical read/write boundary: exact schema, detached result, no historical interpretation. */
export function restoreConversationIndex(value: unknown): DomainConversationIndex {
    if (!isIndexRecord(value)) throw new TypeError('Invalid conversation index');
    const { providerId, id, title, titleSource, cloudAvailability, hasTakeoutImport,
        createdAt, updatedAt, url, messageCount } = value;
    if (Object.keys(value).some(key => !keys.has(key))
        || typeof providerId !== 'string' || !providerId || providerId !== providerId.trim()
        || typeof id !== 'string' || !id || id !== id.trim()
        || typeof title !== 'string' || title !== title.trim()
        || (title === '' ? titleSource !== 'default' : titleSource === 'default')
        || typeof titleSource !== 'string' || !isTitleSource(titleSource)
        || (cloudAvailability !== 'unknown' && cloudAvailability !== 'available'
            && cloudAvailability !== 'unlisted' && cloudAvailability !== 'deleted')
        || typeof hasTakeoutImport !== 'boolean'
        || (createdAt !== undefined && (typeof createdAt !== 'number' || !Number.isFinite(createdAt)))
        || (updatedAt !== undefined && (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)))
        || (url !== undefined && !isConversationUrl(url))
        || (messageCount !== undefined && (typeof messageCount !== 'number' || !Number.isSafeInteger(messageCount) || messageCount < 0))) {
        throw new TypeError('Invalid conversation index schema');
    }
    return { providerId, id, title, titleSource, cloudAvailability, hasTakeoutImport,
        ...(createdAt !== undefined ? { createdAt } : {}),
        ...(updatedAt !== undefined ? { updatedAt } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(messageCount !== undefined ? { messageCount } : {}) };
}

/** Typed facts only. Title authority and import history survive weaker observations. */
export function mergeConversationIndex(old: DomainConversationIndex | undefined, incoming: DomainConversationIndex): DomainConversationIndex {
    if (!old) return { ...incoming };
    if (old.id !== incoming.id || old.providerId !== incoming.providerId) throw new TypeError('Conversation index identity mismatch');
    const title = incoming.title && (!old.title || TITLE_AUTHORITY_RANK[incoming.titleSource] >= TITLE_AUTHORITY_RANK[old.titleSource]) ? incoming : old;
    const createdAt = old.createdAt === undefined ? incoming.createdAt : incoming.createdAt === undefined ? old.createdAt : Math.min(old.createdAt, incoming.createdAt);
    const updatedAt = old.updatedAt === undefined ? incoming.updatedAt : incoming.updatedAt === undefined ? old.updatedAt : Math.max(old.updatedAt, incoming.updatedAt);
    const messageCount = old.messageCount === undefined ? incoming.messageCount : incoming.messageCount === undefined ? old.messageCount : Math.max(old.messageCount, incoming.messageCount);
    return { providerId: old.providerId, id: old.id, title: title.title, titleSource: title.titleSource,
        cloudAvailability: old.cloudAvailability === 'deleted' && incoming.cloudAvailability !== 'available' ? 'deleted' : incoming.cloudAvailability === 'unknown' ? old.cloudAvailability : incoming.cloudAvailability,
        hasTakeoutImport: old.hasTakeoutImport || incoming.hasTakeoutImport,
        ...(createdAt !== undefined ? { createdAt } : {}), ...(updatedAt !== undefined ? { updatedAt } : {}),
        ...(incoming.url ?? old.url ? { url: incoming.url ?? old.url } : {}), ...(messageCount !== undefined ? { messageCount } : {}) };
}

/** One activity time drives ordering and freshness. Creation alone is not an update version. */
export function indexActivityTime(index: Pick<DomainConversationIndex, 'updatedAt'>): number | undefined {
    return index.updatedAt;
}
/** Stable array ordering supplies ties; local observation order is not a conversation timestamp. */
export function compareConversationIndexes(a: DomainConversationIndex, b: DomainConversationIndex): number {
    const left = indexActivityTime(a), right = indexActivityTime(b);
    if (left === undefined) return right === undefined ? 0 : 1;
    if (right === undefined) return -1;
    return right - left;
}
