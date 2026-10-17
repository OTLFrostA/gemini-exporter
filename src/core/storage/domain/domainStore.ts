import type { Account } from '../../domain/accountRegistry.js';
import { decodeDataUrl } from '../../export/assets/dataUrl.js';
import { isAccountId } from '../../domain/accountRegistry.js';
import { restoreConversationIndex } from '../../domain/conversationIndex.js';
import { sha256Hex } from '../../export/assets/sha256.js';
import { matchResourceSets, resourceIdentity } from '../../parsers/shared/resources/resourceIdentity.js';
import { needsDomainBroker, callDomainBroker, encodeBytes, decodeBytes, decodeDomainRecord } from './transport.js';
import { assertSchemaWritable } from '../schemaState.js';
import type { TrustedDomain } from '../../domain/runtimeValidation.js';
import type { ResourceAcquisitionHints } from '../../resources/resourceAcquisition.js';
import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { readStorageDomain } from './validate.js';
import { ACCOUNT_STORE, DOMAIN_DB_NAME, DOMAIN_DB_VERSION, DOMAIN_STORAGE_VERSION, DOMAIN_CONTRACT_VERSION, type DomainStorageIdentity, type DomainStorageRecord, type TrustedDomainStorageRecord, type StoredDomainResource } from './contracts.js';

const CURRENT = 'conversations';
const BYTE_CACHE = 'resource_bytes';
const byteMemory = new Map<string, Uint8Array>();
const memory = new Map<string, TrustedDomainStorageRecord>();
export function __clearDomainMemory(): void { memory.clear(); byteMemory.clear(); }

export function storageIdentity(providerId: string, accountId: string, conversationId: string): DomainStorageIdentity {
    if (!providerId.trim() || !isAccountId(accountId) || !conversationId.trim()) throw new TypeError('Invalid Domain storage identity');
    return { providerId, accountId, conversationId };
}
export function domainStorageKey(identity: DomainStorageIdentity): string {
    const valid = storageIdentity(identity.providerId, identity.accountId, identity.conversationId);
    return JSON.stringify([valid.providerId, valid.accountId, valid.conversationId]);
}
function checked(record: DomainStorageRecord): TrustedDomainStorageRecord {
    checkedEnvelope(record);
    return checkedBindings(record, readStorageDomain(record.conversation));
}
function checkedEnvelope(record: DomainStorageRecord): void {
    if (!record || record.origin !== 'source') throw new TypeError('Invalid Domain storage origin');
    if (record.storageVersion !== DOMAIN_STORAGE_VERSION || record.domainVersion !== DOMAIN_CONTRACT_VERSION) throw new TypeError('Unsupported Domain storage version');
    if (typeof record.revision !== 'string' || !record.revision || (record.savedAt !== undefined && (typeof record.savedAt !== 'number' || !Number.isFinite(record.savedAt)))) throw new TypeError('Invalid Domain storage envelope');
}
/** Internal records retain detached snapshots and storage invariants, without revalidating AST. */
function checkedBindings(record: DomainStorageRecord, conversation: TrustedDomain): TrustedDomainStorageRecord {
    checkedEnvelope(record);
    if (record.savedAt !== conversation.detail.savedAt) throw new TypeError('Invalid Domain storage envelope');
    if (domainStorageKey(record.identity) !== record.key || record.identity.accountId !== conversation.index.key.accountId || record.identity.conversationId !== conversation.index.key.conversationId) throw new TypeError('Stored Domain identity mismatch');
    if (!Array.isArray(record.resources) || record.resources.some(r => !(r.bytes instanceof Uint8Array) || !r.bytes.byteLength || !conversation.detail.assets.some(a => a.id === r.assetId)) || new Set(record.resources.map(r => r.assetId)).size !== record.resources.length) throw new TypeError('Invalid stored resource binding');
    if (!record.acquisitionHints || typeof record.acquisitionHints !== 'object' || Array.isArray(record.acquisitionHints)) throw new TypeError('Invalid stored acquisition context');
    for (const [id, hint] of Object.entries(record.acquisitionHints)) {
        if (!conversation.detail.assets.some(a => a.id === id) || !hint || typeof hint !== 'object' || Array.isArray(hint)
            || Object.keys(hint).some(k => !['url', 'sourceUrl', 'src', 'candidates'].includes(k))
            || ['url', 'sourceUrl', 'src'].some(k => k in hint && typeof Reflect.get(hint, k) !== 'string')
            || (hint.candidates !== undefined && (!Array.isArray(hint.candidates) || hint.candidates.some(v => typeof v !== 'string')))) throw new TypeError('Invalid stored acquisition binding');
    }
    if (record.resourceDigests !== undefined) {
        if (!record.resourceDigests || typeof record.resourceDigests !== 'object' || Array.isArray(record.resourceDigests)) throw new TypeError('Invalid resource cache metadata');
        for (const [id, digest] of Object.entries(record.resourceDigests)) {
            if (!digest || !conversation.detail.assets.some(a => a.id === id) || (conversation.detail.assets.find(a => a.id === id)?.sourceUri ?? '') !== digest.sourceUri
                || typeof digest.sourceUri !== 'string'
                || (digest.sourcePath !== undefined && typeof digest.sourcePath !== 'string')
                || (digest.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(digest.sha256))) throw new TypeError('Invalid resource cache binding');
        }
    }
    return structuredClone({ ...record, conversation: { index: restoreConversationIndex(conversation.index), detail: conversation.detail } });
}
export function openDomainDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DOMAIN_DB_NAME, DOMAIN_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(ACCOUNT_STORE)) db.createObjectStore(ACCOUNT_STORE, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(BYTE_CACHE)) db.createObjectStore(BYTE_CACHE, { keyPath: 'key' }).createIndex('conversation', 'conversationKey');
            if (!db.objectStoreNames.contains(CURRENT)) db.createObjectStore(CURRENT, { keyPath: 'key' });
        };
        request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
        request.onerror = () => reject(request.error);
    });
}
/** Resolve only on transaction commit, never on a put request's success. */
async function transaction<T>(mode: IDBTransactionMode, run: (current: IDBObjectStore, result: (value: T) => void, byteCache: IDBObjectStore) => void): Promise<T> {
    const db = await openDomainDB();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction([CURRENT, BYTE_CACHE], mode);
            let result: T;
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => reject(tx.error || new Error('Domain storage transaction aborted'));
            tx.onerror = () => reject(tx.error || new Error('Domain storage transaction failed'));
            try { run(tx.objectStore(CURRENT), value => { result = value; }, tx.objectStore(BYTE_CACHE)); }
            catch (error) { tx.abort(); reject(error); }
        });
    } finally { db.close(); }
}
export async function getStoredDomain(identity: DomainStorageIdentity): Promise<TrustedDomainStorageRecord | null> {
    const key = domainStorageKey(identity);
    if (needsDomainBroker()) { const value = await callDomainBroker('get', { identity }); return value ? checkedBindings(decodeDomainRecord(value), value.conversation) : null; }
    if (typeof indexedDB === 'undefined') return memory.has(key) ? checked(memory.get(key)!) : null;
    const value = await transaction<DomainStorageRecord | null>('readonly', (store, result) => {
        const req = store.get(key); req.onsuccess = () => result(req.result ?? null);
    });
    return value ? checked(value) : null;
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
        && JSON.stringify(selected.conversation.detail.assets) === JSON.stringify(existing.conversation.detail.assets)) {
        return selected.conversation.detail.assets.flatMap(asset => {
            const uri = asset.sourceUri ?? '';
            const key = byteCacheKey(selected, asset.id, uri);
            return keys.has(key) ? [{ assetId: asset.id, key, sourceUri: uri,
                sha256: existing.resourceDigests?.[asset.id]?.sha256, sourcePath: existing.resourceDigests?.[asset.id]?.sourcePath }] : [];
        });
    }
    const targets = selected.conversation.detail.assets.map(asset => resourceIdentity(asset, selected.identity.conversationId));
    const existingMatches = existing ? matchResourceSets(selected.identity.conversationId, targets, existing.conversation.detail.assets.map(asset => resourceIdentity(asset, existing.identity.conversationId))) : [];
    for (const source of new Set([selected, ...(existing ? [existing] : []), incoming])) {
        for (const match of source === existing ? existingMatches : matchResourceSets(selected.identity.conversationId, targets, source.conversation.detail.assets.map(asset => resourceIdentity(asset, source.identity.conversationId)))) {
            const target = selected.conversation.detail.assets[match.target], asset = source.conversation.detail.assets[match.source];
            const uri = target.sourceUri ?? '';
            if (updates.has(target.id)) continue;
            const key = byteCacheKey(selected, target.id, uri);
            const inline = source.resources.find(r => r.assetId === asset.id);
            const oldKey = byteCacheKey(source, asset.id, asset.sourceUri ?? '');
            const oldHash = existing?.resourceDigests?.[asset.id];
            const hash = source === incoming ? hashes.get(asset.id) : oldHash?.sourceUri === (asset.sourceUri ?? '') ? oldHash?.sha256 : undefined;
            if (inline) {
                const unchanged = existing && keys.has(key) && oldKey === key
                    && existingMatches.some(prior => selected.conversation.detail.assets[prior.target].id === target.id
                        && existing.conversation.detail.assets[prior.source].id === asset.id);
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
function currentRecord(selected: TrustedDomainStorageRecord, updates: readonly BindingUpdate[]): TrustedDomainStorageRecord {
    // Even URI-less resources stay in the existing cache, bound by their proven asset ID.
    return { ...selected, resources: [],
        resourceDigests: Object.fromEntries(updates.map(row => [row.assetId, { sourceUri: row.sourceUri, ...(row.sha256 ? { sha256: row.sha256 } : {}),
            ...(row.sourcePath !== undefined ? { sourcePath: row.sourcePath } : {}) }])) };
}
/** Physical submission; the Domain callback owns snapshot and Index selection. */
export type SnapshotDecision = (existing: TrustedDomainStorageRecord | null, incoming: TrustedDomainStorageRecord,
    resourceChanged: boolean) => TrustedDomainStorageRecord;
export async function commitDomainConversation(accountId: string, parsed: ResourceConversationParseResult,
    resources: readonly StoredDomainResource[], decide: SnapshotDecision, canCommit?: () => boolean): Promise<TrustedDomainStorageRecord> {
    if (parsed.account.id !== accountId || parsed.conversation.index.key.accountId !== accountId) throw new TypeError('Domain account mismatch');
    if (canCommit?.() === false) throw new Error('Account changed before Domain submission');
    if (typeof chrome !== 'undefined') await assertSchemaWritable();
    resources = inlineResources(parsed.conversation, parsed.acquisitionHints, resources);
    if (needsDomainBroker()) {
        const value = await callDomainBroker('save', { accountId,
            parsed: { sourceVersion: parsed.sourceVersion, conversation: parsed.conversation, acquisitionHints: parsed.acquisitionHints },
            resources: resources.map(r => ({ ...r, bytes: encodeBytes(r.bytes) })) });
        if (!value) throw new TypeError('Missing committed Domain record');
        return checkedBindings(decodeDomainRecord(value), value.conversation);
    }
    return commitDomainSnapshot(parsed.account, readStorageDomain(parsed.conversation), parsed.acquisitionHints, resources, decide, canCommit);
}
export async function commitDomainRequest(account: Account, parsed: { conversation: unknown; acquisitionHints: ResourceAcquisitionHints; sourceVersion?: unknown },
    resources: readonly StoredDomainResource[], decide: SnapshotDecision): Promise<TrustedDomainStorageRecord> {
    if (typeof chrome !== 'undefined') await assertSchemaWritable();
    if (needsDomainBroker()) throw new TypeError('Raw Domain save requests require extension-origin storage');
    const conversation = readStorageDomain(parsed.conversation);
    resources = inlineResources(conversation, parsed.acquisitionHints, resources);
    return commitDomainSnapshot(account, conversation, parsed.acquisitionHints, resources, decide);
}

function parsedUri(uri?: string): string | undefined { return uri?.startsWith('data:') ? uri : undefined; }

function inlineResources(conversation: TrustedDomain, hints: ResourceAcquisitionHints, supplied: readonly StoredDomainResource[]): StoredDomainResource[] {
    const resources = new Map(supplied.map(resource => [resource.assetId, resource]));
    for (const asset of conversation.detail.assets) {
        if (resources.has(asset.id)) continue;
        const encoded = hints[asset.id]?.dataBase64;
        const uri = encoded ? `data:${asset.mediaType ?? 'application/octet-stream'};base64,${encoded}`
            : [parsedUri(hints[asset.id]?.url), parsedUri(hints[asset.id]?.sourceUrl), parsedUri(asset.sourceUri)].find(uri => uri !== undefined);
        if (!uri) continue;
        const decoded = decodeDataUrl(uri);
        // Acquisition failures do not invalidate semantic content; export still reports missing bytes.
        if (decoded.ok && decoded.bytes.byteLength) resources.set(asset.id, { assetId: asset.id, bytes: decoded.bytes });
    }
    return [...resources.values()];
}

async function commitDomainSnapshot(account: Account, conversation: TrustedDomain, sourceHints: ResourceAcquisitionHints,
    resources: readonly StoredDomainResource[], decide: SnapshotDecision, canCommit?: () => boolean): Promise<TrustedDomainStorageRecord> {
    const accountId = account.id;
    if (conversation.index.key.accountId !== accountId) throw new TypeError('Domain account mismatch');
    const identity = storageIdentity(account.providerId, accountId, conversation.index.key.conversationId);
    // Export paths, diagnostics, pagination and runtime ZIP handles are deliberately excluded.
    const acquisitionHints = Object.fromEntries(Object.entries(sourceHints).map(([assetId, hint]) => [assetId, {
        ...(hint.url ? { url: hint.url } : {}), ...(hint.sourceUrl ? { sourceUrl: hint.sourceUrl } : {}), ...(hint.src ? { src: hint.src } : {}),
        ...(hint.candidates ? { candidates: [...hint.candidates] } : {}),
    }]));
    const savedAt = conversation.detail.savedAt;
    const incoming = checkedBindings({ key: domainStorageKey(identity), storageVersion: DOMAIN_STORAGE_VERSION, domainVersion: DOMAIN_CONTRACT_VERSION, identity, origin: 'source', revision: crypto.randomUUID(), ...(savedAt !== undefined ? { savedAt } : {}), conversation, acquisitionHints, resources: resources.map(r => ({ ...r })) }, conversation);
    const hashes = new Map(await Promise.all(incoming.resources.map(async resource => [resource.assetId, await sha256Hex(resource.bytes)] as const)));
    if (canCommit?.() === false) throw new Error('Account changed before Domain commit');
    const choose = (existing: TrustedDomainStorageRecord | null): TrustedDomainStorageRecord => {
        if (canCommit?.() === false) throw new Error('Account changed before Domain commit');
        const changedResources = incoming.resources.some(r => hashes.get(r.assetId) !== existing?.resourceDigests?.[r.assetId]?.sha256
            || r.sourcePath !== existing?.resourceDigests?.[r.assetId]?.sourcePath);
        return decide(existing, incoming, changedResources);
    };
    if (typeof indexedDB === 'undefined') {
        const existing = memory.get(incoming.key) ?? null;
        const selected = choose(existing);
        const keys = new Set([...byteMemory.keys()].filter(key => JSON.parse(key)[0] === incoming.key));
        const updates = resourceUpdates(selected, existing, incoming, keys, hashes);
        for (const row of updates) {
            if (row.from) row.bytes = byteMemory.get(row.from)?.slice();
            if (row.compare && row.bytes && byteMemory.get(row.key)?.every((byte, i) => byte === row.bytes![i])
                && byteMemory.get(row.key)?.length === row.bytes.length) row.bytes = undefined;
        }
        const result = checkedBindings(currentRecord(selected, updates), selected.conversation);
        memory.set(incoming.key, result);
        const reachable = new Set(updates.filter(row => !row.from || row.bytes).map(row => row.key));
        for (const key of keys) if (!reachable.has(key)) byteMemory.delete(key);
        for (const row of updates) if (row.bytes) byteMemory.set(row.key, row.bytes.slice());
        return checkedBindings(result, result.conversation);
    }
    return transaction<TrustedDomainStorageRecord>('readwrite', (store, result, byteCache) => {
        const current = store.get(incoming.key);
        current.onsuccess = () => {
            try {
                const existing = current.result ? checked(current.result) : null;
                const selected = choose(existing);
                const cacheKeys = byteCache.index('conversation').getAllKeys(incoming.key);
                cacheKeys.onsuccess = () => {
                    try {
                        const keys = new Set(cacheKeys.result.map(String));
                        const updates = resourceUpdates(selected, existing, incoming, keys, hashes);
                        const complete = () => {
                            if (canCommit?.() === false) throw new Error('Account changed before Domain commit');
                            const reachable = new Set(updates.filter(row => !row.from || row.bytes).map(row => row.key));
                            for (const key of keys) if (!reachable.has(key)) byteCache.delete(key);
                            for (const row of updates) if (row.bytes) byteCache.put({ key: row.key, conversationKey: incoming.key,
                                assetId: row.assetId, sourceUri: row.sourceUri, bytes: row.bytes } satisfies ByteCacheRow);
                            const next = checkedBindings(currentRecord(selected, updates), selected.conversation);
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
                        done();
                    } catch { store.transaction.abort(); }
                };
            } catch { store.transaction.abort(); }
        };
    });
}

export function storedParseResult(record: TrustedDomainStorageRecord, account: Account): ResourceConversationParseResult {
    const valid = checkedBindings(record, record.conversation);
    if (account.id !== valid.identity.accountId || account.providerId !== valid.identity.providerId) throw new TypeError("Saved Account mismatch");
    return { account, ...(valid.savedAt !== undefined ? { sourceVersion: valid.savedAt } : {}), conversation: valid.conversation, diagnostics: [], resourceHints: {}, acquisitionHints: valid.acquisitionHints };
}
export async function getDomainResource(identity: DomainStorageIdentity, assetId: string): Promise<Uint8Array | null> {
    if (needsDomainBroker()) { const value = await callDomainBroker('resource', { identity, assetId }); return value === null ? null : decodeBytes(value); }
    const record = await getStoredDomain(identity);
    const bound = record?.resources.find(r => r.assetId === assetId)?.bytes;
    if (bound) return bound.slice();
    const asset = record?.conversation.detail.assets.find(a => a.id === assetId);
    if (!record || !asset) return null;
    return readByteCache(JSON.stringify([record.key, assetId, asset.sourceUri ?? '']));
}
export async function removeStoredDomain(identity: DomainStorageIdentity): Promise<void> {
    if (typeof chrome !== 'undefined') await assertSchemaWritable();
    const key = domainStorageKey(identity);
    if (needsDomainBroker()) { await callDomainBroker('remove', { identity }); return; }
    if (typeof indexedDB === 'undefined') { memory.delete(key); for (const cacheKey of byteMemory.keys()) if (JSON.parse(cacheKey)[0] === key) byteMemory.delete(cacheKey); return; }
    const db = await openDomainDB();
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction([CURRENT, BYTE_CACHE], 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('Domain deletion failed'));
            try {
                tx.objectStore(CURRENT).delete(key);
                const cursor = tx.objectStore(BYTE_CACHE).index('conversation').openCursor(IDBKeyRange.only(key));
                cursor.onsuccess = () => { const c = cursor.result; if (c) { c.delete(); c.continue(); } };
            } catch (error) { tx.abort(); reject(error); }
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
        if (record?.conversation.detail.assets.find(a => a.id === assetId)?.sourceUri === sourceUri
            && record.resourceDigests?.[assetId]?.sha256 !== sha256) {
            byteMemory.set(byteCacheKey(record, assetId, sourceUri), acquired);
            record.resourceDigests = { ...record.resourceDigests, [assetId]: { ...record.resourceDigests?.[assetId], sourceUri, sha256 } };
        }
        return;
    }
    await transaction<void>('readwrite', (store, result, byteCache) => {
        const req = store.get(domainStorageKey(identity));
        req.onsuccess = () => {
            try {
                const record = req.result ? checked(req.result) : null;
                if (record?.conversation.detail.assets.find(a => a.id === assetId)?.sourceUri === sourceUri
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
