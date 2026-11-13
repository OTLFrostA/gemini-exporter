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
async function seedPreviousDatabase(): Promise<void> {
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
                tx.objectStore('indexes').put({ key: { ...key, accountId: owner.id }, updatedAt: 1700000000000 });
                tx.objectStore('details').put(body(owner.id));
                tx.objectStore('exportRecords').put({ accountId: owner.id, conversationId: key.conversationId, value: record });
            }
            tx.objectStore('coverage').put({ accountId: account.id, streamId: 'list', value: { range: null } });
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
        });
    } finally { db.close(); }
}

test('upgrade revokes old Gemini completeness receipts without deleting body, metadata or other providers', async () => {
    const env = indexStorage({}, { seedAccounts: false });
    try {
        await seedPreviousDatabase();
        const db = await openStorageDB(); db.close();
        assert.deepEqual(await getDetail(key), { ...body(), quality: { status: 'unknown' } });
        assert.deepEqual(await getExportRecord(key), { ...record, status: 'partial', otherContentMissing: true });
        const otherKey = { ...key, accountId: otherAccount.id };
        assert.deepEqual(await getDetail(otherKey), body(otherAccount.id));
        assert.deepEqual(await getExportRecord(otherKey), record);
        assert.equal((await readOne('indexes', [account.id, key.conversationId]))?.updatedAt, 1700000000000);
        assert.deepEqual((await readOne('coverage', [account.id, 'list']))?.value, { range: null });
        const parsed = mergeConversationPages([parseGeminiRpcConversation(detailGen('G_NATIVE_INTEGRITY_PLAN'), { account, providerId: 'gemini' })], undefined, true);
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
