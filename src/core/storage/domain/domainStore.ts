import { assertSchemaWritable } from '../schemaState.js';
import { isAccountId } from '../../domain/accountRegistry.js';
import type { ConversationKey } from '../../domain/conversationKey.js';
import { restoreDomainDetail, type TrustedDomainBody } from '../../domain/runtimeValidation.js';
import type { DomainConversationDetail } from '../../domain/conversationDetail.js';
import { needsDomainBroker, callDomainBroker } from './transport.js';
import { ACCOUNT_STORE, DOMAIN_DB_NAME, DOMAIN_DB_VERSION, type DomainStorageIdentity } from './contracts.js';

const DETAILS = 'details';
const memory = new Map<string, DomainConversationDetail>();
export function __clearDomainMemory(): void { memory.clear(); }
export function storageIdentity(providerId: string, accountId: string, conversationId: string): DomainStorageIdentity {
    if (!providerId.trim() || !isAccountId(accountId) || !conversationId.trim()) throw new TypeError('Invalid Domain storage identity');
    return { providerId, accountId, conversationId };
}
export function domainStorageKey(identity: DomainStorageIdentity): string {
    const valid = storageIdentity(identity.providerId, identity.accountId, identity.conversationId);
    return JSON.stringify([valid.accountId, valid.conversationId]);
}
export function openDomainDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DOMAIN_DB_NAME, DOMAIN_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            db.createObjectStore(ACCOUNT_STORE, { keyPath: 'id' }).createIndex('providerIdentity', ['providerId', 'providerAccountId'], { unique: true });
            db.createObjectStore('indexes', { keyPath: ['key.accountId', 'key.conversationId'] }).createIndex('byAccount', 'key.accountId');
            db.createObjectStore(DETAILS, { keyPath: ['key.accountId', 'key.conversationId'] });
            db.createObjectStore('coverage', { keyPath: ['accountId', 'streamId'] });
            db.createObjectStore('exportRecords', { keyPath: ['accountId', 'conversationId'] }).createIndex('byAccount', 'accountId');
            db.createObjectStore('directoryHandles');
        };
        request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
        request.onerror = () => reject(request.error);
    });
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const db = await openDomainDB();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(DETAILS, mode);
            let result: T;
            tx.oncomplete = () => resolve(result);
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('Detail storage transaction failed'));
            try { run(tx.objectStore(DETAILS), value => { result = value; }); }
            catch (error) { tx.abort(); reject(error); }
        });
    } finally { db.close(); }
}
function checkedKey(key: ConversationKey): [string, string] {
    if (!isAccountId(key.accountId) || !key.conversationId.trim()) throw new TypeError('Invalid Detail storage key');
    return [key.accountId, key.conversationId];
}
export async function getDetail(key: ConversationKey): Promise<TrustedDomainBody | null> {
    const address = checkedKey(key);
    const value: unknown = needsDomainBroker() ? await callDomainBroker('get', { key })
        : typeof indexedDB === 'undefined' ? structuredClone(memory.get(JSON.stringify(address)) ?? null)
        : await transaction<unknown>('readonly', (store, done) => { const req = store.get(address); req.onsuccess = () => done(req.result ?? null); });
    if (value === null) return null;
    const detail = restoreDomainDetail(value);
    if (detail.key.accountId !== key.accountId || detail.key.conversationId !== key.conversationId) throw new TypeError('Stored Detail identity mismatch');
    return detail;
}
/** Already selected and validated facts. No merge, revision or resource state. */
export async function putDetail(detail: TrustedDomainBody): Promise<void> {
    if (typeof chrome !== 'undefined') await assertSchemaWritable();
    const address = checkedKey(detail.key);
    if (needsDomainBroker()) { await callDomainBroker('put', { detail }); return; }
    if (typeof indexedDB === 'undefined') { memory.set(JSON.stringify(address), structuredClone(detail)); return; }
    await transaction<void>('readwrite', store => { store.put(detail); });
}
export async function deleteDetail(key: ConversationKey): Promise<void> {
    if (typeof chrome !== 'undefined') await assertSchemaWritable();
    const address = checkedKey(key);
    if (needsDomainBroker()) { await callDomainBroker('remove', { key }); return; }
    if (typeof indexedDB === 'undefined') { memory.delete(JSON.stringify(address)); return; }
    await transaction<void>('readwrite', store => { store.delete(address); });
}
