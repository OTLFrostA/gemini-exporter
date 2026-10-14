import { TITLE_AUTHORITY_RANK, type TitleSource } from './titleAuthority.js';

/** Canonical metadata. Account ownership belongs to the repository scope, never this record. */
export interface DomainConversationIndex {
    providerId: string;
    id: string;
    /** Empty when no usable title has been established; presentation supplies its own label. */
    title: string;
    titleSource: TitleSource;
    /** Conversation metadata times in epoch milliseconds; never inferred from body messages. */
    createdAt?: number;
    updatedAt?: number;
    /** Latest observed message timestamp, independent of provider list metadata updates. */
    lastMessageAt?: number;
    url?: string;
    cloudAvailability: 'unknown' | 'available' | 'unlisted' | 'deleted';
    /** Historical import fact, independent of the current title and cloud availability. */
    hasTakeoutImport: boolean;
    /** Largest observed number of individual messages. Not a declared total or a turn count. */
    messageCount?: number;
}

export type ConversationIndexPatch = Partial<Omit<DomainConversationIndex, 'id' | 'providerId'>>;
const keys = new Set(['providerId', 'id', 'title', 'titleSource', 'createdAt', 'updatedAt', 'lastMessageAt', 'url',
    'cloudAvailability', 'hasTakeoutImport', 'messageCount']);

function isConversationUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value !== value.trim()) return false;
    try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; }
}

/** Physical read/write boundary: exact schema, detached result, no historical interpretation. */
export function restoreConversationIndex(value: unknown): DomainConversationIndex {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid conversation index');
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(key => !keys.has(key))
        || typeof row.providerId !== 'string' || !row.providerId || row.providerId !== row.providerId.trim()
        || typeof row.id !== 'string' || !row.id || row.id !== row.id.trim()
        || typeof row.title !== 'string' || row.title !== row.title.trim()
        || (row.title === '' ? row.titleSource !== 'default' : row.titleSource === 'default')
        || typeof row.titleSource !== 'string' || !Object.hasOwn(TITLE_AUTHORITY_RANK, row.titleSource)
        || typeof row.cloudAvailability !== 'string' || !['unknown', 'available', 'unlisted', 'deleted'].includes(row.cloudAvailability)
        || typeof row.hasTakeoutImport !== 'boolean'
        || ['createdAt', 'updatedAt', 'lastMessageAt'].some(key => row[key] !== undefined && (typeof row[key] !== 'number' || !Number.isFinite(row[key])))
        || (row.url !== undefined && !isConversationUrl(row.url))
        || (row.messageCount !== undefined && (typeof row.messageCount !== 'number' || !Number.isSafeInteger(row.messageCount) || row.messageCount < 0))) {
        throw new TypeError('Invalid conversation index schema');
    }
    return { providerId: row.providerId, id: row.id, title: row.title, titleSource: row.titleSource as TitleSource,
        cloudAvailability: row.cloudAvailability as DomainConversationIndex['cloudAvailability'], hasTakeoutImport: row.hasTakeoutImport,
        ...(row.createdAt !== undefined ? { createdAt: row.createdAt as number } : {}),
        ...(row.updatedAt !== undefined ? { updatedAt: row.updatedAt as number } : {}),
        ...(row.lastMessageAt !== undefined ? { lastMessageAt: row.lastMessageAt as number } : {}),
        ...(row.url !== undefined ? { url: row.url as string } : {}),
        ...(row.messageCount !== undefined ? { messageCount: row.messageCount as number } : {}) };
}

/** Typed facts only. Title authority and import history survive weaker observations. */
export function mergeConversationIndex(old: DomainConversationIndex | undefined, incoming: DomainConversationIndex): DomainConversationIndex {
    if (!old) return { ...incoming };
    if (old.id !== incoming.id || old.providerId !== incoming.providerId) throw new TypeError('Conversation index identity mismatch');
    const title = incoming.title && (!old.title || TITLE_AUTHORITY_RANK[incoming.titleSource] >= TITLE_AUTHORITY_RANK[old.titleSource]) ? incoming : old;
    const createdAt = old.createdAt === undefined ? incoming.createdAt : incoming.createdAt === undefined ? old.createdAt : Math.min(old.createdAt, incoming.createdAt);
    const updatedAt = old.updatedAt === undefined ? incoming.updatedAt : incoming.updatedAt === undefined ? old.updatedAt : Math.max(old.updatedAt, incoming.updatedAt);
    const lastMessageAt = old.lastMessageAt === undefined ? incoming.lastMessageAt : incoming.lastMessageAt === undefined ? old.lastMessageAt : Math.max(old.lastMessageAt, incoming.lastMessageAt);
    const messageCount = old.messageCount === undefined ? incoming.messageCount : incoming.messageCount === undefined ? old.messageCount : Math.max(old.messageCount, incoming.messageCount);
    return { providerId: old.providerId, id: old.id, title: title.title, titleSource: title.titleSource,
        cloudAvailability: old.cloudAvailability === 'deleted' && incoming.cloudAvailability !== 'available' ? 'deleted' : incoming.cloudAvailability === 'unknown' ? old.cloudAvailability : incoming.cloudAvailability,
        hasTakeoutImport: old.hasTakeoutImport || incoming.hasTakeoutImport,
        ...(createdAt !== undefined ? { createdAt } : {}), ...(updatedAt !== undefined ? { updatedAt } : {}),
        ...(lastMessageAt !== undefined ? { lastMessageAt } : {}),
        ...(incoming.url ?? old.url ? { url: incoming.url ?? old.url } : {}), ...(messageCount !== undefined ? { messageCount } : {}) };
}

/** Latest activity for ordering/freshness; distinct underlying facts remain independently stored. */
export function indexActivityTime(index: Pick<DomainConversationIndex, 'updatedAt' | 'createdAt' | 'lastMessageAt'>): number | undefined {
    if (index.updatedAt === undefined) return index.lastMessageAt ?? index.createdAt;
    return index.lastMessageAt === undefined ? index.updatedAt : Math.max(index.updatedAt, index.lastMessageAt);
}
/** Stable array ordering supplies ties; local observation order is not a conversation timestamp. */
export function compareConversationIndexes(a: DomainConversationIndex, b: DomainConversationIndex): number {
    const left = indexActivityTime(a), right = indexActivityTime(b);
    if (left === undefined) return right === undefined ? 0 : 1;
    if (right === undefined) return -1;
    return right - left;
}
