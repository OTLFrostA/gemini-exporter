import { sha256Hex } from '../../export/assets/sha256.js';
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
    if (record.resourceDigests !== undefined) {
        if (!record.resourceDigests || typeof record.resourceDigests !== 'object' || Array.isArray(record.resourceDigests)) throw new TypeError('Invalid resource cache metadata');
        for (const [id, digest] of Object.entries(record.resourceDigests)) {
            if (!digest || !conversation.assets.some(a => a.id === id) || (conversation.assets.find(a => a.id === id)?.source?.uri ?? '') !== digest.sourceUri
                || typeof digest.sourceUri !== 'string'
                || (digest.sourcePath !== undefined && typeof digest.sourcePath !== 'string')
                || (digest.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(digest.sha256))) throw new TypeError('Invalid resource cache binding');
        }
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
function sameContent(existing: DomainStorageRecord, incoming: DomainStorageRecord): boolean {
    return existing.origin === incoming.origin
        && JSON.stringify(existing.conversation) === JSON.stringify(incoming.conversation)
        && JSON.stringify(existing.acquisitionHints) === JSON.stringify(incoming.acquisitionHints);
}
interface ByteCacheRow { key: string; conversationKey: string; assetId: string; sourceUri: string; bytes: Uint8Array }
function byteCacheKey(record: DomainStorageRecord, assetId: string, uri: string): string {
    return JSON.stringify([record.key, assetId, uri]);
}
interface BindingUpdate {
    assetId: string;
    key: string;
    sourceUri: string;
    sha256?: string;
    sourcePath?: string;
    bytes?: Uint8Array;
    from?: string;
    compare?: boolean;
}
/** Plan with identities and cache keys only. Load bytes solely for changed bindings. */
function resourceUpdates(selected: DomainStorageRecord, existing: DomainStorageRecord | null, incoming: DomainStorageRecord,
    keys: ReadonlySet<string>, hashes: ReadonlyMap<string, string>): BindingUpdate[] {
    const updates = new Map<string, BindingUpdate>();
    if (existing && !existing.resources.length && !incoming.resources.length
        && JSON.stringify(selected.conversation.assets) === JSON.stringify(existing.conversation.assets)) {
        return selected.conversation.assets.flatMap(asset => {
            const uri = asset.source?.uri ?? '';
            const key = byteCacheKey(selected, asset.id, uri);
            return keys.has(key) ? [{ assetId: asset.id, key, sourceUri: uri,
                sha256: existing.resourceDigests?.[asset.id]?.sha256, sourcePath: existing.resourceDigests?.[asset.id]?.sourcePath }] : [];
        });
    }
    const targets = selected.conversation.assets.map(resourceIdentity);
    const existingMatches = existing ? matchResourceSets(selected.identity.conversationId, targets, existing.conversation.assets.map(resourceIdentity)) : [];
    for (const source of new Set([selected, ...(existing ? [existing] : []), incoming])) {
        for (const match of source === existing ? existingMatches : matchResourceSets(selected.identity.conversationId, targets, source.conversation.assets.map(resourceIdentity))) {
            const target = selected.conversation.assets[match.target], asset = source.conversation.assets[match.source];
            const uri = target.source?.uri ?? '';
            if (updates.has(target.id)) continue;
            const key = byteCacheKey(selected, target.id, uri);
            const inline = source.resources.find(r => r.assetId === asset.id);
            const oldKey = byteCacheKey(source, asset.id, asset.source?.uri ?? '');
            const oldHash = existing?.resourceDigests?.[asset.id];
            const hash = source === incoming ? hashes.get(asset.id) : oldHash?.sourceUri === (asset.source?.uri ?? '') ? oldHash?.sha256 : undefined;
            if (inline) {
                const unchanged = existing && keys.has(key) && oldKey === key
                    && existingMatches.some(prior => selected.conversation.assets[prior.target].id === target.id
                        && existing.conversation.assets[prior.source].id === asset.id);
                updates.set(target.id, { assetId: target.id, key, sourceUri: uri, sha256: hash, sourcePath: inline.sourcePath,
                    ...(unchanged && hash && oldHash?.sha256 === hash ? {} : { bytes: inline.bytes }),
                    ...(unchanged && !(hash && oldHash?.sha256 === hash) ? { compare: true } : {}) });
            } else if (source === existing && keys.has(oldKey)) {
                updates.set(target.id, { assetId: target.id, key, sourceUri: uri, sha256: hash, sourcePath: oldHash?.sourcePath,
                    ...(oldKey !== key ? { from: oldKey } : {}) });
            }
        }
    }
    return [...updates.values()];
}
function currentRecord(selected: DomainStorageRecord, updates: readonly BindingUpdate[]): DomainStorageRecord {
    // Even URI-less resources stay in the existing cache, bound by their proven asset ID.
    return { ...selected, resources: [],
        resourceDigests: Object.fromEntries(updates.map(row => [row.assetId, { sourceUri: row.sourceUri, ...(row.sha256 ? { sha256: row.sha256 } : {}),
            ...(row.sourcePath !== undefined ? { sourcePath: row.sourcePath } : {}) }])) };
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
    const incoming: DomainStorageRecord = checked({ key: domainStorageKey(identity), storageVersion: DOMAIN_STORAGE_VERSION, domainVersion: DOMAIN_CONTRACT_VERSION, identity, origin: migration ? 'legacy-storage' : 'source', revision: 'pending', savedAt: Date.now(), conversation, acquisitionHints, resources: resources.map(r => ({ ...r })) });
    const hashes = new Map(await Promise.all(incoming.resources.map(async resource => [resource.assetId, await sha256Hex(resource.bytes)] as const)));
    // Content-addressed revision keys make repeats an indexed existence check, not a history scan.
    incoming.revision = `sha256:${await sha256Hex(new TextEncoder().encode(JSON.stringify([
        incoming.key, incoming.origin, incoming.conversation, incoming.acquisitionHints,
        incoming.resources.map(r => [r.assetId, r.sourcePath, hashes.get(r.assetId)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    ])))}`;
    const choose = (existing: DomainStorageRecord | null): DomainStorageRecord => {
        const changedResources = incoming.resources.some(r => hashes.get(r.assetId) !== existing?.resourceDigests?.[r.assetId]?.sha256
            || r.sourcePath !== existing?.resourceDigests?.[r.assetId]?.sourcePath);
        return existing && sameContent(existing, incoming) && !changedResources ? existing
            : !existing || prefer(existing, incoming, migration) ? incoming : existing;
    };
    if (typeof indexedDB === 'undefined') {
        if (migration && removedMemory.has(incoming.key)) return null;
        const existing = memory.get(incoming.key) ?? null;
        if (existing && migration && !prefer(existing, incoming, true)) return checked(existing);
        const selected = choose(existing);
        const keys = new Set([...byteMemory.keys()].filter(key => JSON.parse(key)[0] === incoming.key));
        const updates = resourceUpdates(selected, existing, incoming, keys, hashes);
        for (const row of updates) {
            if (row.from) row.bytes = byteMemory.get(row.from)?.slice();
            if (row.compare && row.bytes && byteMemory.get(row.key)?.every((byte, i) => byte === row.bytes![i])
                && byteMemory.get(row.key)?.length === row.bytes.length) row.bytes = undefined;
        }
        const result = checked(currentRecord(selected, updates));
        if (!migration) removedMemory.delete(incoming.key);
        if (selected !== existing || !sameContent(incoming, existing!)) {
            if (!history.has(incoming.revision)) history.set(incoming.revision, structuredClone(incoming));
        }
        memory.set(incoming.key, result);
        const reachable = new Set(updates.filter(row => !row.from || row.bytes).map(row => row.key));
        for (const key of keys) if (!reachable.has(key)) byteMemory.delete(key);
        for (const row of updates) if (row.bytes) byteMemory.set(row.key, row.bytes.slice());
        return checked(result);
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
                        const selected = choose(existing);
                        const cacheKeys = byteCache.index('conversation').getAllKeys(incoming.key);
                        cacheKeys.onsuccess = () => {
                            try {
                                const keys = new Set(cacheKeys.result.map(String));
                                const updates = resourceUpdates(selected, existing, incoming, keys, hashes);
                                const complete = () => {
                                    const reachable = new Set(updates.filter(row => !row.from || row.bytes).map(row => row.key));
                                    for (const key of keys) if (!reachable.has(key)) byteCache.delete(key);
                                    for (const row of updates) if (row.bytes) byteCache.put({ key: row.key, conversationKey: incoming.key,
                                        assetId: row.assetId, sourceUri: row.sourceUri, bytes: row.bytes } satisfies ByteCacheRow);
                                    const next = checked(currentRecord(selected, updates));
                                    if (selected !== existing || existing!.resources.length || JSON.stringify(existing!.resourceDigests) !== JSON.stringify(next.resourceDigests)) store.put(next);
                                    result(next);
                                };
                                let pending = 1;
                                const done = () => { if (--pending === 0) { try { complete(); } catch { store.transaction.abort(); } } };
                                // get() is reserved for actual rebindings or an old row without a digest.
                                for (const row of updates) if (row.from || row.compare) {
                                    pending++;
                                    const bytes = byteCache.get(row.from || row.key);
                                    bytes.onsuccess = () => {
                                        try {
                                            const cached = bytes.result as ByteCacheRow | undefined;
                                            const valid = cached && cached.key === (row.from || row.key) && cached.conversationKey === incoming.key
                                                && cached.bytes instanceof Uint8Array && cached.bytes.length
                                                && cached.key === byteCacheKey(incoming, cached.assetId, cached.sourceUri);
                                            if (row.from) row.bytes = valid ? cached.bytes : undefined;
                                            else if (valid && row.bytes?.length === cached.bytes.length && row.bytes.every((b, i) => b === cached.bytes[i])) row.bytes = undefined;
                                            done();
                                        } catch { store.transaction.abort(); }
                                    };
                                }
                                if (selected === existing && sameContent(existing, incoming)) done();
                                else {
                                    const prior = revisions.count(incoming.revision);
                                    prior.onsuccess = () => { try { if (!prior.result) revisions.put(incoming); done(); } catch { store.transaction.abort(); } };
                                }
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
    const asset = record?.conversation.assets.find(a => a.id === assetId);
    if (!record || !asset) return null;
    return readByteCache(JSON.stringify([record.key, assetId, asset.source?.uri ?? '']));
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
    const acquired = bytes.slice();
    const sha256 = await sha256Hex(acquired);
    if (typeof indexedDB === 'undefined') {
        const record = memory.get(domainStorageKey(identity));
        if (record?.conversation.assets.find(a => a.id === assetId)?.source?.uri === sourceUri
            && record.resourceDigests?.[assetId]?.sha256 !== sha256) {
            byteMemory.set(byteCacheKey(record, assetId, sourceUri), acquired);
            record.resourceDigests = { ...record.resourceDigests, [assetId]: { ...record.resourceDigests?.[assetId], sourceUri, sha256 } };
        }
        return;
    }
    await transaction<void>('readwrite', (store, _revisions, result, _removed, byteCache) => {
        const req = store.get(domainStorageKey(identity));
        req.onsuccess = () => {
            try {
                const record = req.result ? checked(req.result) : null;
                if (record?.conversation.assets.find(a => a.id === assetId)?.source?.uri === sourceUri
                    && record.resourceDigests?.[assetId]?.sha256 !== sha256) {
                    byteCache.put({ key: byteCacheKey(record, assetId, sourceUri), conversationKey: record.key, assetId, sourceUri, bytes: acquired });
                    record.resourceDigests = { ...record.resourceDigests, [assetId]: { ...record.resourceDigests?.[assetId], sourceUri, sha256 } };
                    store.put(record);
                }
                result(undefined);
            } catch { store.transaction.abort(); }
        };
    });
}
