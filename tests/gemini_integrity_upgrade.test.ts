import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { openStorageDB, readOne } from '../src/l3a/idb.js';
import { ingestDetail } from '../src/l2/ingestion.js';
import { getDetail, getExportRecord } from '../src/l3a/storageService.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';
import { detailGen } from './fixtures/providers/geminiDetail.js';
import type { DomainConversationDetail } from '../src/l2/conversationDetail.js';
import { IDBObjectStore, IDBCursorWithValue } from 'fake-indexeddb';

const account = fixtureAccount('gemini');
const otherAccount = fixtureAccount('chatgpt');
const key = fixtureKey('coverage');
const body = (accountId = account.id): DomainConversationDetail => ({ key: { ...key, accountId }, savedAt: 1700000000000,
    quality: { status: 'complete' }, assets: [], messages: [{ role: 'assistant', content: [
        { type: 'paragraph', children: [{ type: 'text', text: 'Previous body bytes' }] },
    ] }] });
const record = { format: 'markdown', status: 'ok', exportedAt: 123, chatTime: 1700000000000,
    folderBaseName: 'Keep my filename' } as const;

// Historical schema is intentional: opening production Storage must upgrade it.
async function seedPreviousDatabase(count = 1): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
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
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['accounts', 'indexes', 'details', 'exportRecords', 'coverage'], 'readwrite');
            for (const owner of [account, otherAccount]) {
                tx.objectStore('accounts').put(owner);
                for (let i = 0; i < count; i++) {
                    const conversationId = i === 0 ? key.conversationId : `history_${i}`;
                    const detail = body(owner.id);
                    detail.key.conversationId = conversationId;
                    if (count > 1) detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'text', text: 'Historical body. '.repeat(1024) }] }];
                    tx.objectStore('indexes').put({ key: detail.key, updatedAt: 1700000000000 });
                    tx.objectStore('details').put(detail);
                    tx.objectStore('exportRecords').put({ accountId: owner.id, conversationId, value: record });
                }
            }
            tx.objectStore('coverage').put({ accountId: account.id, streamId: 'list', value: { range: null } });
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
        });
    } finally { db.close(); }
}

test('upgrade revokes old Gemini Detail completeness without altering ExportRecords, body bytes or other providers', async () => {
    const env = indexStorage({}, { seedAccounts: false });
    try {
        await seedPreviousDatabase();
        const db = await openStorageDB(); db.close();
        assert.deepEqual(await getDetail(key), { ...body(), quality: { status: 'unknown' } });
        assert.deepEqual(await getExportRecord(key), record);
        const otherKey = { ...key, accountId: otherAccount.id };
        assert.deepEqual(await getDetail(otherKey), body(otherAccount.id));
        assert.deepEqual(await getExportRecord(otherKey), record);
        assert.equal((await readOne('indexes', [account.id, key.conversationId]))?.updatedAt, 1700000000000);
        assert.deepEqual((await readOne('coverage', [account.id, 'list']))?.value, { range: null });
        const parsed = mergeConversationPages([parseGeminiRpcConversation(detailGen('G_NATIVE_INTEGRITY_UNKNOWN_NEIGHBOR'), { account, providerId: 'gemini' })], undefined, true);
        assert.equal(parsed.conversation.detail.quality.status, 'partial');
        // The former complete snapshot must no longer hide the new partial fact.
        assert.equal((await ingestDetail(account.id, key.conversationId, parsed.conversation.detail)).accepted, true);
        assert.equal((await getDetail(key))?.quality.status, 'partial');
        const complete = { ...parsed.conversation.detail, quality: { status: 'complete' as const } };
        await ingestDetail(account.id, key.conversationId, complete);
        const reopened = await openStorageDB(); reopened.close();
        assert.equal((await getDetail(key))?.quality.status, 'complete', 'upgrade runs only once');
        assert.equal((await ingestDetail(account.id, key.conversationId, parsed.conversation.detail)).accepted, false,
            'current confirmed complete snapshots retain normal admission protection');
    } finally { env.restore(); }
});

test('large-history upgrade reads records by cursor without loading account-wide bodies', async () => {
    const env = indexStorage({}, { seedAccounts: false });
    const getAll = IDBObjectStore.prototype.getAll;
    try {
        await seedPreviousDatabase(512);
        IDBObjectStore.prototype.getAll = function() { throw new Error(`Unbounded migration read: ${this.name}`); };
        const db = await openStorageDB(); db.close();
        for (const conversationId of [key.conversationId, 'history_511']) {
            const geminiKey = { ...key, conversationId };
            assert.equal((await getDetail(geminiKey))?.quality.status, 'unknown');
            assert.deepEqual(await getExportRecord(geminiKey), record);
            assert.equal((await getDetail({ ...geminiKey, accountId: otherAccount.id }))?.quality.status, 'complete');
        }
    } finally { IDBObjectStore.prototype.getAll = getAll; env.restore(); }
});

test('aborted upgrade rolls back all changes and can be retried without losing historical bodies', async () => {
    const env = indexStorage({}, { seedAccounts: false });
    const update = IDBCursorWithValue.prototype.update;
    try {
        await seedPreviousDatabase(4);
        let updates = 0;
        IDBCursorWithValue.prototype.update = function(value: unknown) {
            const request = update.call(this, value);
            if (++updates === 2 && this.source instanceof IDBObjectStore) this.source.transaction.abort();
            return request;
        };
        await assert.rejects(getDetail(key), { name: 'AbortError' });
        IDBCursorWithValue.prototype.update = update;
        const previous = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('gemini_exporter_v2', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        assert.equal(previous.version, 1);
        await new Promise<void>((resolve, reject) => {
            const tx = previous.transaction(['details', 'exportRecords'], 'readonly');
            const detail = tx.objectStore('details').get([account.id, key.conversationId]);
            detail.onsuccess = () => assert.equal(detail.result?.quality.status, 'complete');
            const receipt = tx.objectStore('exportRecords').get([account.id, key.conversationId]);
            receipt.onsuccess = () => assert.deepEqual(receipt.result?.value, record);
            tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
        });
        previous.close();
        const retried = await openStorageDB(); retried.close();
        assert.equal((await getDetail(key))?.quality.status, 'unknown');
        assert.deepEqual(await getExportRecord(key), record);
        assert.ok((await getDetail(key))?.messages.length);
    } finally { IDBCursorWithValue.prototype.update = update; env.restore(); }
});
