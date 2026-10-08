import { matchResourceSets, resourceIdentity } from '../../parsers/shared/resources/resourceIdentity.js';
import { needsDomainBroker, callDomainBroker, encodeBytes, decodeBytes, decodeDomainRecord } from './transport.js';
import { assertSchemaWritable } from '../schemaState.js';
import type { DomainConversationDetail } from '../../domain/conversationDetail.js';
import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { normId } from '../../utils/pathUtils.js';
import { readStorageDomain } from './validate.js';
import { DOMAIN_DB_NAME, DOMAIN_DB_VERSION, DOMAIN_STORAGE_VERSION, DOMAIN_CONTRACT_VERSION, type DomainStorageIdentity, type DomainStorageRecord, type StoredDomainResource } from './contracts.js';

const CURRENT = 'conversations';
const HISTORY = 'revisions';
const BACKUP = 'legacy_imports';
const BYTE_CACHE = 'resource_bytes';
const REMOVED = 'removed_conversations';
const removedMemory = new Set<string>();
const byteMemory = new Map<string, Uint8Array>();
const memory = new Map<string, DomainStorageRecord>();
const history = new Map<string, DomainStorageRecord>();
export function __clearDomainMemory(): void { memory.clear(); history.clear(); byteMemory.clear(); removedMemory.clear(); }
export function __domainRevisions(): DomainStorageRecord[] { return [...history.values()].map(v => structuredClone(v)); }

export function storageIdentity(providerId: string, accountSlot: string, conversationId: string): DomainStorageIdentity {
    if (!providerId.trim() || !accountSlot.trim() || !conversationId.trim()) throw new TypeError('Invalid Domain storage identity');
    return { providerId, accountSlot: providerId === 'gemini' && accountSlot === 'default' ? 'u0' : accountSlot, conversationId: providerId === 'gemini' ? normId(conversationId) : conversationId };
}
export function domainStorageKey(identity: DomainStorageIdentity): string {
    const valid = storageIdentity(identity.providerId, identity.accountSlot, identity.conversationId);
    return JSON.stringify([valid.providerId, valid.accountSlot, valid.conversationId]);
}
function checked(record: DomainStorageRecord): DomainStorageRecord {
    if (!record || !['source', 'legacy-storage'].includes(record.origin)) throw new TypeError('Invalid Domain storage origin');
    if (record.storageVersion !== DOMAIN_STORAGE_VERSION || record.domainVersion !== DOMAIN_CONTRACT_VERSION) throw new TypeError('Unsupported Domain storage version');
    if (typeof record.revision !== 'string' || !record.revision || !Number.isFinite(record.savedAt)) throw new TypeError('Invalid Domain storage envelope');
    const conversation = readStorageDomain(record.conversation);
    if (domainStorageKey(record.identity) !== record.key || record.identity.providerId !== conversation.providerId || record.identity.conversationId !== (conversation.providerId === 'gemini' ? normId(conversation.id) : conversation.id)) throw new TypeError('Stored Domain identity mismatch');
    if (!Array.isArray(record.resources) || record.resources.some(r => !(r.bytes instanceof Uint8Array) || !r.bytes.byteLength || !conversation.assets.some(a => a.id === r.assetId)) || new Set(record.resources.map(r => r.assetId)).size !== record.resources.length) throw new TypeError('Invalid stored resource binding');
    if (!record.acquisitionHints || typeof record.acquisitionHints !== 'object' || Array.isArray(record.acquisitionHints)) throw new TypeError('Invalid stored acquisition context');
    for (const [id, hint] of Object.entries(record.acquisitionHints)) {
        if (!conversation.assets.some(a => a.id === id) || !hint || typeof hint !== 'object' || Array.isArray(hint)
            || Object.keys(hint).some(k => !['url', 'sourceUrl', 'src', 'candidates'].includes(k))
            || ['url', 'sourceUrl', 'src'].some(k => k in hint && typeof Reflect.get(hint, k) !== 'string')
            || (hint.candidates !== undefined && (!Array.isArray(hint.candidates) || hint.candidates.some(v => typeof v !== 'string')))) throw new TypeError('Invalid stored acquisition binding');
    }
    return { ...structuredClone(record), conversation };
}
export function openDomainDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DOMAIN_DB_NAME, DOMAIN_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(REMOVED)) db.createObjectStore(REMOVED, { keyPath: 'key' });
            if (!db.objectStoreNames.contains(BYTE_CACHE)) db.createObjectStore(BYTE_CACHE, { keyPath: 'key' }).createIndex('conversation', 'conversationKey');
            if (!db.objectStoreNames.contains(BACKUP)) db.createObjectStore(BACKUP, { keyPath: 'key' });
            if (!db.objectStoreNames.contains(CURRENT)) db.createObjectStore(CURRENT, { keyPath: 'key' });
            if (!db.objectStoreNames.contains(HISTORY)) db.createObjectStore(HISTORY, { keyPath: 'revision' }).createIndex('conversation', 'key');
        };
        request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
        request.onerror = () => reject(request.error);
    });
}
/** Resolve only on transaction commit, never on a put request's success. */
async function transaction<T>(mode: IDBTransactionMode, run: (current: IDBObjectStore, revisions: IDBObjectStore, result: (value: T) => void, removed: IDBObjectStore, byteCache: IDBObjectStore) => void): Promise<T> {
    const db = await openDomainDB();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction([CURRENT, HISTORY, REMOVED, BYTE_CACHE], mode);
            let result: T;
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => reject(tx.error || new Error('Domain storage transaction aborted'));
            tx.onerror = () => reject(tx.error || new Error('Domain storage transaction failed'));
            try { run(tx.objectStore(CURRENT), tx.objectStore(HISTORY), value => { result = value; }, tx.objectStore(REMOVED), tx.objectStore(BYTE_CACHE)); }
            catch (error) { tx.abort(); reject(error); }
        });
    } finally { db.close(); }
}
export async function getStoredDomain(identity: DomainStorageIdentity): Promise<DomainStorageRecord | null> {
    const key = domainStorageKey(identity);
    if (needsDomainBroker()) { const value = await callDomainBroker('get', { identity }); return value ? checked(decodeDomainRecord(value)) : null; }
    if (typeof indexedDB === 'undefined') return memory.has(key) ? checked(memory.get(key)!) : null;
    const value = await transaction<DomainStorageRecord | null>('readonly', (store, _history, result) => {
        const req = store.get(key); req.onsuccess = () => result(req.result ?? null);
    });
    return value ? checked(value) : null;
}
function prefer(existing: DomainStorageRecord, incoming: DomainStorageRecord, migration: boolean): boolean {
    if (migration) return (!existing.conversation.messages.length || existing.origin === 'legacy-storage') && incoming.conversation.messages.length > existing.conversation.messages.length; // A retry cannot overwrite data captured by the new release.
    const old = existing.conversation, next = incoming.conversation;
    if (old.messages.length > next.messages.length) return false;
    if (old.messages.length < next.messages.length) return true;
    if (old.completeness?.status === 'complete' && next.completeness?.status !== 'complete') return false;
    if (old.completeness?.status !== 'partial' && next.completeness?.status === 'partial') return false;
    const time = (v: DomainConversationDetail): number => Number(v.updatedAt ?? v.timestamp) || 0;
    return time(next) >= time(old);
}
function carryResources(existing: DomainStorageRecord | null, incoming: DomainStorageRecord): void {
    if (!existing) return;
    const supplied = new Set(incoming.resources.map(r => r.assetId));
    for (const match of matchResourceSets(incoming.identity.conversationId, incoming.conversation.assets.map(resourceIdentity), existing.conversation.assets.map(resourceIdentity))) {
        const next = incoming.conversation.assets[match.target], old = existing.conversation.assets[match.source];
        const resource = existing.resources.find(r => r.assetId === old.id);
        if (resource && !supplied.has(next.id) && next.id === old.id && next.source?.uri === old.source?.uri)
            incoming.resources.push(structuredClone(resource));
    }
}
function sameSnapshot(existing: DomainStorageRecord, incoming: DomainStorageRecord): boolean {
    return existing.origin === incoming.origin
        && JSON.stringify(existing.conversation) === JSON.stringify(incoming.conversation)
        && JSON.stringify(existing.acquisitionHints) === JSON.stringify(incoming.acquisitionHints)
        && existing.resources.length === incoming.resources.length
        && incoming.resources.every(resource => {
            const old = existing.resources.find(r => r.assetId === resource.assetId);
            return old?.sourcePath === resource.sourcePath && old?.bytes.byteLength === resource.bytes.byteLength
                && (old.bytes === resource.bytes || old.bytes.every((byte, i) => byte === resource.bytes[i]));
        });
}
interface ByteCacheRow { key: string; conversationKey: string; assetId: string; sourceUri: string; bytes: Uint8Array }
function byteCacheKey(record: DomainStorageRecord, assetId: string, uri: string): string {
    return JSON.stringify([record.key, assetId, uri]);
}
function memoryBytes(record: DomainStorageRecord | null): ByteCacheRow[] {
    return record ? record.conversation.assets.flatMap(asset => {
        const uri = asset.source?.uri;
        const key = uri ? byteCacheKey(record, asset.id, uri) : '';
        const bytes = byteMemory.get(key);
        return uri && bytes ? [{ key, conversationKey: record.key, assetId: asset.id, sourceUri: uri, bytes }] : [];
    }) : [];
}
/** Rebind bytes only to the chosen snapshot's own identity; no Domain relationship is rewritten. */
function selectedBytes(selected: DomainStorageRecord, sources: readonly DomainStorageRecord[], cached: readonly ByteCacheRow[], cacheOwner: DomainStorageRecord | null): ByteCacheRow[] {
    const result = new Map<string, ByteCacheRow>();
    const targets = selected.conversation.assets.map(resourceIdentity);
    for (const source of new Set([selected, ...sources])) {
        const bytes = new Map(source.resources.map(resource => [resource.assetId, resource.bytes]));
        // Cache rows contain no event evidence. Only their current owner can validate
        // them before the shared matcher rebinds them to a different snapshot.
        for (const row of source === cacheOwner ? cached : []) {
            const uri = source.conversation.assets.find(asset => asset.id === row.assetId)?.source?.uri;
            if (uri && row.conversationKey === source.key && row.sourceUri === uri && row.key === byteCacheKey(source, row.assetId, uri)
                && row.bytes instanceof Uint8Array && row.bytes.byteLength && !bytes.has(row.assetId)) bytes.set(row.assetId, row.bytes);
        }
        for (const match of matchResourceSets(selected.identity.conversationId, targets, source.conversation.assets.map(resourceIdentity))) {
            const asset = selected.conversation.assets[match.target];
            const acquired = bytes.get(source.conversation.assets[match.source].id);
            const uri = asset.source?.uri;
            if (uri && acquired && !result.has(asset.id)) result.set(asset.id, { key: byteCacheKey(selected, asset.id, uri),
                conversationKey: selected.key, assetId: asset.id, sourceUri: uri, bytes: acquired.slice() });
        }
    }
    return [...result.values()];
}
export function saveDomainConversation(accountSlot: string, parsed: ResourceConversationParseResult, resources?: readonly StoredDomainResource[], migration?: false): Promise<DomainStorageRecord>;
export function saveDomainConversation(accountSlot: string, parsed: ResourceConversationParseResult, resources: readonly StoredDomainResource[], migration: boolean): Promise<DomainStorageRecord | null>;
export async function saveDomainConversation(accountSlot: string, parsed: ResourceConversationParseResult, resources: readonly StoredDomainResource[] = [], migration = false): Promise<DomainStorageRecord | null> {
    if (typeof chrome !== 'undefined') await assertSchemaWritable();
    if (needsDomainBroker()) { const value = await callDomainBroker('save', { accountSlot, parsed: { conversation: parsed.conversation, acquisitionHints: parsed.acquisitionHints, resourceHints: {}, diagnostics: [] }, resources: resources.map(r => ({ ...r, bytes: encodeBytes(r.bytes) })), migration }); return value === null ? null : checked(decodeDomainRecord(value)); }
    const conversation = readStorageDomain(parsed.conversation);
    const identity = storageIdentity(conversation.providerId, accountSlot, conversation.id);
    // Export paths, diagnostics, pagination and runtime ZIP handles are deliberately excluded.
    const acquisitionHints = Object.fromEntries(Object.entries(parsed.acquisitionHints).map(([assetId, hint]) => [assetId, {
        ...(hint.url ? { url: hint.url } : {}), ...(hint.sourceUrl ? { sourceUrl: hint.sourceUrl } : {}), ...(hint.src ? { src: hint.src } : {}),
        ...(hint.candidates ? { candidates: [...hint.candidates] } : {}),
    }]));
    const incoming: DomainStorageRecord = checked({ key: domainStorageKey(identity), storageVersion: DOMAIN_STORAGE_VERSION, domainVersion: DOMAIN_CONTRACT_VERSION, identity, origin: migration ? 'legacy-storage' : 'source', revision: crypto.randomUUID(), savedAt: Date.now(), conversation, acquisitionHints, resources: resources.map(r => structuredClone(r)) });
    if (typeof indexedDB === 'undefined') {
        if (migration && removedMemory.has(incoming.key)) return null;
        const existing = memory.get(incoming.key) ?? null;
        if (existing && migration && !prefer(existing, incoming, true)) return checked(existing);
        carryResources(existing, incoming);
        const unchanged = existing && sameSnapshot(existing, incoming);
        const selected = unchanged ? existing : !existing || prefer(existing, incoming, migration) ? incoming : existing;
        const cached = selectedBytes(selected, existing ? [existing, incoming] : [incoming], memoryBytes(existing), existing);
        const result = checked(selected);
        const revision = !unchanged && ![...history.values()].some(row => row.key === incoming.key && sameSnapshot(row, incoming))
            ? structuredClone(incoming) : null;
        // Compute/validate everything before committing any memory state.
        if (!migration) removedMemory.delete(incoming.key);
        if (revision) history.set(incoming.revision, revision);
        if (selected === incoming) memory.set(incoming.key, structuredClone(selected));
        const reachable = new Set(cached.map(row => row.key));
        for (const key of byteMemory.keys()) if (JSON.parse(key)[0] === incoming.key && !reachable.has(key)) byteMemory.delete(key);
        for (const row of cached) byteMemory.set(row.key, row.bytes);
        return result;
    }
    return transaction<DomainStorageRecord | null>('readwrite', (store, revisions, result, removed, byteCache) => {
        const req = removed.get(incoming.key);
        req.onsuccess = () => {
            try {
                if (migration && req.result) { result(null); return; }
                if (!migration) removed.delete(incoming.key);
                const current = store.get(incoming.key);
                current.onsuccess = () => {
                    try {
                        const existing = current.result ? checked(current.result) : null;
                        if (existing && migration && !prefer(existing, incoming, true)) { result(existing); return; }
                        carryResources(existing, incoming);
                        const unchanged = existing && sameSnapshot(existing, incoming);
                        const selected = unchanged ? existing : !existing || prefer(existing, incoming, migration) ? incoming : existing;
                        const bytes = byteCache.index('conversation').getAll(incoming.key);
                        bytes.onsuccess = () => {
                            try {
                                const entries = selectedBytes(selected, existing ? [existing, incoming] : [incoming], bytes.result as ByteCacheRow[], existing);
                                const prior = revisions.index('conversation').getAll(incoming.key);
                                prior.onsuccess = () => {
                                    try {
                                        if (!unchanged && !(prior.result as DomainStorageRecord[]).some(row => sameSnapshot(row, incoming))) revisions.put(incoming);
                                        if (selected === incoming) store.put(incoming);
                                        const reachable = new Set(entries.map(row => row.key));
                                        for (const row of bytes.result as ByteCacheRow[]) if (!reachable.has(row.key)) byteCache.delete(row.key);
                                        for (const row of entries) byteCache.put(row);
                                        result(selected);
                                    } catch { store.transaction.abort(); }
                                };
                            } catch { store.transaction.abort(); }
                        };
                    } catch { store.transaction.abort(); }
                };
            } catch { store.transaction.abort(); }
        };
    });
}

export function storedParseResult(record: DomainStorageRecord): ResourceConversationParseResult {
    const valid = checked(record);
    return { conversation: valid.conversation, diagnostics: [], resourceHints: {}, acquisitionHints: valid.acquisitionHints };
}
export async function getDomainResource(identity: DomainStorageIdentity, assetId: string): Promise<Uint8Array | null> {
    if (needsDomainBroker()) { const value = await callDomainBroker('resource', { identity, assetId }); return value === null ? null : decodeBytes(value); }
    const record = await getStoredDomain(identity);
    const bound = record?.resources.find(r => r.assetId === assetId)?.bytes;
    if (bound) return bound.slice();
    const uri = record?.conversation.assets.find(a => a.id === assetId)?.source?.uri;
    if (!record || !uri) return null;
    return readByteCache(JSON.stringify([record.key, assetId, uri]));
}
export async function removeStoredDomain(identity: DomainStorageIdentity): Promise<void> {
    if (typeof chrome !== 'undefined') await assertSchemaWritable();
    const key = domainStorageKey(identity);
    if (needsDomainBroker()) { await callDomainBroker('remove', { identity }); return; }
    if (typeof indexedDB === 'undefined') { removedMemory.add(key); memory.delete(key); for (const [id, row] of history) if (row.key === key) history.delete(id); for (const cacheKey of byteMemory.keys()) if (JSON.parse(cacheKey)[0] === key) byteMemory.delete(cacheKey); return; }
    const db = await openDomainDB();
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction([CURRENT, HISTORY, BYTE_CACHE, REMOVED], 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('Domain deletion failed'));
            try {
                tx.objectStore(REMOVED).put({ key, removedAt: Date.now() });
                tx.objectStore(CURRENT).delete(key);
                for (const name of [HISTORY, BYTE_CACHE]) {
                    const cursor = tx.objectStore(name).index('conversation').openCursor(IDBKeyRange.only(key));
                    cursor.onsuccess = () => { const c = cursor.result; if (c) { c.delete(); c.continue(); } };
                }
            } catch (error) { tx.abort(); reject(error); }
        });
    } finally { db.close(); }
}

/** Original legacy values remain recoverable, including records that cannot be interpreted. */
export async function backupLegacyValue(key: string, value: unknown): Promise<void> {
    if (needsDomainBroker()) { await callDomainBroker('backup', { key: `origin:${location.origin}:${key}`, value }); return; }
    if (typeof indexedDB === 'undefined') return;
    const db = await openDomainDB();
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(BACKUP, 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('Legacy backup failed'));
            const store = tx.objectStore(BACKUP);
            const req = store.get(key);
            req.onsuccess = () => { if (!req.result) store.put({ key, value, savedAt: Date.now() }); };
        });
    } finally { db.close(); }
}

async function readByteCache(key: string): Promise<Uint8Array | null> {
    if (typeof indexedDB === 'undefined') return byteMemory.get(key)?.slice() ?? null;
    const db = await openDomainDB();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(BYTE_CACHE, 'readonly');
            let bytes: Uint8Array | null = null;
            tx.oncomplete = () => resolve(bytes);
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('Resource cache read failed'));
            const req = tx.objectStore(BYTE_CACHE).get(key);
            req.onsuccess = () => { bytes = req.result?.bytes ?? null; };
        });
    } finally { db.close(); }
}
/** Available bytes are durable without rewriting semantic content or its source URI. */
export async function cacheDomainResource(identity: DomainStorageIdentity, assetId: string, sourceUri: string, bytes: Uint8Array): Promise<void> {
    if (typeof chrome !== 'undefined') await assertSchemaWritable();
    if (!bytes.byteLength) throw new TypeError('Empty acquired resource');
    if (needsDomainBroker()) { await callDomainBroker('cache', { identity, assetId, sourceUri, bytes: encodeBytes(bytes) }); return; }
    if (typeof indexedDB === 'undefined') {
        const record = memory.get(domainStorageKey(identity));
        if (record?.conversation.assets.find(a => a.id === assetId)?.source?.uri === sourceUri)
            byteMemory.set(byteCacheKey(record, assetId, sourceUri), bytes.slice());
        return;
    }
    await transaction<void>('readwrite', (store, _revisions, result, _removed, byteCache) => {
        const req = store.get(domainStorageKey(identity));
        req.onsuccess = () => {
            try {
                const record = req.result ? checked(req.result) : null;
                if (record?.conversation.assets.find(a => a.id === assetId)?.source?.uri === sourceUri)
                    byteCache.put({ key: byteCacheKey(record, assetId, sourceUri), conversationKey: record.key, assetId, sourceUri, bytes: bytes.slice() });
                result(undefined);
            } catch { store.transaction.abort(); }
        };
    });
}
