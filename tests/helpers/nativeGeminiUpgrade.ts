import { fixtureAccount } from './domainFixture.js';
import { openStorageDB } from '../../src/l3a/idb.js';
import { getDetail } from '../../src/l3a/storageService.js';
import type { DomainConversationDetail } from '../../src/l2/conversationDetail.js';
import type { ExportRecord } from '../../src/l2/exportRecord.js';

interface NativeUpgradeResult {
    conversations: number;
    bodyBytes: number;
    seedMs: number;
    upgradeMs: number;
    verified: number;
    updates: number;
    failedOpen?: string;
    rollbackVerified?: number;
}
declare global {
    var geminiUpgradeProbe: { run: typeof runNativeUpgrade };
}

const accounts = [fixtureAccount('gemini'), fixtureAccount('gemini', '10000000-0000-4000-8000-000000000002'), fixtureAccount('chatgpt')];
const sourceVersion = 1700000000000;
const paragraph = 'Historical body with exact bytes. '.repeat(1024);
const receipt: ExportRecord = { format: 'markdown', status: 'ok', exportedAt: 123,
    chatTime: sourceVersion, folderBaseName: 'Keep my filename' };

function body(accountId: string, i: number): DomainConversationDetail {
    return { key: { accountId, conversationId: `history_${i}` }, savedAt: sourceVersion,
        quality: { status: i % 5 === 0 ? 'partial' : 'complete' }, assets: [], messages: [
            { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: `${accountId}/${i}\n${paragraph}` }] }] },
        ] };
}

async function openPrevious(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('gemini_exporter_v2', 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            db.createObjectStore('accounts', { keyPath: 'id' }).createIndex('providerIdentity', ['providerId', 'providerAccountId'], { unique: true });
            db.createObjectStore('indexes', { keyPath: ['key.accountId', 'key.conversationId'] });
            db.createObjectStore('details', { keyPath: ['key.accountId', 'key.conversationId'] });
            db.createObjectStore('coverage', { keyPath: ['accountId', 'streamId'] });
            db.createObjectStore('exportRecords', { keyPath: ['accountId', 'conversationId'] });
            db.createObjectStore('directoryHandles');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function seed(count: number): Promise<void> {
    const db = await openPrevious();
    try {
        // Seeding is bounded too: fixture construction must not dominate browser memory.
        for (const owner of accounts) {
            for (let offset = 0; offset < count; offset += 64) await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(['accounts', 'indexes', 'details', 'exportRecords', 'coverage'], 'readwrite');
                tx.objectStore('accounts').put({ ...owner, providerAccountId: owner.id });
                for (let i = offset; i < Math.min(offset + 64, count); i++) {
                    const detail = body(owner.id, i);
                    tx.objectStore('indexes').put({ key: detail.key, updatedAt: sourceVersion });
                    tx.objectStore('details').put(detail);
                    tx.objectStore('exportRecords').put({ accountId: owner.id, conversationId: detail.key.conversationId, value: receipt });
                }
                tx.objectStore('coverage').put({ accountId: owner.id, streamId: 'list', value: { range: null } });
                tx.oncomplete = () => resolve();
                tx.onabort = () => reject(tx.error);
            });
        }
    } finally { db.close(); }
}

async function verify(db: IDBDatabase, upgraded: boolean): Promise<number> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['details', 'exportRecords', 'indexes', 'coverage', 'accounts'], 'readonly');
        let verified = 0;
        const fail = (message: string) => { reject(new Error(message)); tx.abort(); };
        const details = tx.objectStore('details').openCursor();
        details.onsuccess = () => {
            const cursor = details.result;
            if (!cursor) return;
            const detail = cursor.value;
            const owner = accounts.find(account => account.id === detail.key.accountId);
            if (!owner) { fail('Unexpected account'); return; }
            const expected = body(owner.id, Number(detail.key.conversationId.slice('history_'.length)));
            if (upgraded && owner.providerId === 'gemini' && expected.quality.status === 'complete') expected.quality = { status: 'unknown' };
            if (JSON.stringify(detail) !== JSON.stringify(expected)) { fail('Body, identity, version or quality changed incorrectly'); return; }
            const receiptRequest = tx.objectStore('exportRecords').get([owner.id, detail.key.conversationId]);
            receiptRequest.onsuccess = () => {
                if (JSON.stringify(receiptRequest.result?.value) !== JSON.stringify(receipt)) { fail('Export receipt changed'); return; }
                const index = tx.objectStore('indexes').get([owner.id, detail.key.conversationId]);
                index.onsuccess = () => {
                    if (index.result?.updatedAt !== sourceVersion) { fail('Index version was changed'); return; }
                    verified++;
                    cursor.continue();
                };
            };
        };
        for (const owner of accounts) {
            const coverage = tx.objectStore('coverage').get([owner.id, 'list']);
            coverage.onsuccess = () => { if (JSON.stringify(coverage.result?.value) !== '{"range":null}') fail('Coverage changed'); };
            const account = tx.objectStore('accounts').get(owner.id);
            account.onsuccess = () => { if (account.result?.providerId !== owner.providerId) fail('Account changed'); };
        }
        tx.oncomplete = () => resolve(verified);
        tx.onabort = () => reject(tx.error);
    });
}

/** Real extension-origin IDB and production storage code. No fake IDB or network. */
export async function runNativeUpgrade(mode: 'large' | 'abort'): Promise<NativeUpgradeResult> {
    const count = mode === 'large' ? 2048 : 32;
    const start = performance.now();
    await seed(count);
    const result: NativeUpgradeResult = { conversations: count * accounts.length,
        bodyBytes: new TextEncoder().encode(paragraph).length * count * accounts.length,
        seedMs: performance.now() - start, upgradeMs: 0, verified: 0, updates: 0 };
    const bulkRead = IDBObjectStore.prototype.getAll;
    const update = IDBCursorWithValue.prototype.update;
    IDBObjectStore.prototype.getAll = function() { throw new Error(`Unbounded upgrade read: ${this.name}`); };
    IDBCursorWithValue.prototype.update = function(value: unknown) {
        const request = update.call(this, value);
        result.updates++;
        // Abort midway through the first Gemini account's Detail updates.
        if (mode === 'abort' && result.updates === 16 && this.source instanceof IDBObjectStore) this.source.transaction.abort();
        return request;
    };
    const upgrading = performance.now();
    try {
        const key = { accountId: accounts[0].id, conversationId: 'history_0' };
        if (mode === 'abort') {
            try { await getDetail(key); }
            catch (error) { result.failedOpen = error instanceof DOMException ? error.name : String(error); }
            if (!result.failedOpen) throw new Error('Injected upgrade abort did not fail the pooled open');
            IDBCursorWithValue.prototype.update = update;
            const rolledBack = await openPrevious();
            try {
                if (rolledBack.version !== 1) throw new Error('Aborted upgrade committed schema version');
                result.rollbackVerified = await verify(rolledBack, false);
            } finally { rolledBack.close(); }
        }
        // Use the same failed pooled API to prove it reopens after rollback.
        if (!(await getDetail(key))) throw new Error('Missing body after upgrade');
        result.upgradeMs = performance.now() - upgrading;
        const db = await openStorageDB();
        try {
            if (db.version !== 3) throw new Error('Upgrade did not commit schema version');
            result.verified = await verify(db, true);
        } finally { db.close(); }
    } finally {
        IDBObjectStore.prototype.getAll = bulkRead;
        IDBCursorWithValue.prototype.update = update;
    }
    return result;
}
