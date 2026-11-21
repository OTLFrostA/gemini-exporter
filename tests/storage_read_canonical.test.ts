import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { A, B, key, seed } from './helpers/v2ConversationFixture.js';
import { listIndexes, listExportRecords, putExportRecord } from '../src/l3a/storageService.js';
import { openStorageDB } from '../src/l3a/idb.js';

test('current-schema reads use only account-scoped v2 stores, ignoring legacy global fallback keys', async () => {
    const env = indexStorage({ conversations: [{ id: 'leak' }], exported: { leak: {} }, ['conversations_' + A]: [{ id: 'old' }] });
    try {
        await seed('a'); await seed('b', { accountId: B });
        assert.deepEqual((await listIndexes(A)).map(row => row.key.conversationId), ['a']);
        assert.deepEqual((await listIndexes(B)).map(row => row.key.conversationId), ['b']);
        assert.deepEqual(await listExportRecords(A), {});
    } finally { env.restore(); }
});
test('current-schema read paths are non-mutating, including empty-account reads', async () => {
    const env = indexStorage({ sentinel: { keep: true } }); try {
        await seed();
        const record = { format: 'html' as const, status: 'ok' as const, exportedAt: 10 };
        await putExportRecord(key(), record);
        const snapshot = async () => {
            const db = await openStorageDB();
            try {
                const stores = Array.from(db.objectStoreNames);
                const rows: Record<string, { keys: IDBValidKey[]; values: unknown[] }> = {};
                await new Promise<void>((resolve, reject) => {
                    const tx = db.transaction(stores, 'readonly');
                    tx.oncomplete = () => resolve();
                    tx.onabort = () => reject(tx.error);
                    for (const name of stores) {
                        const store = tx.objectStore(name);
                        const row: { keys: IDBValidKey[]; values: unknown[] } = rows[name] = { keys: [], values: [] };
                        const keys = store.getAllKeys(), values = store.getAll();
                        keys.onsuccess = () => { row.keys = keys.result; };
                        values.onsuccess = () => { row.values = values.result; };
                    }
                });
                return { rows, local: await chrome.storage.local.get(null) };
            } finally { db.close(); }
        };
        const before = await snapshot(), writes = env.writes();
        assert.equal(before.rows.indexes.values.length, 1);
        for (let repeat = 0; repeat < 2; repeat++) {
            const indexes = await listIndexes(A), emptyIndexes = await listIndexes(B);
            const records = await listExportRecords(A), emptyRecords = await listExportRecords(B);
            assert.deepEqual(await snapshot(), before, 'reads must preserve all persisted data');
            assert.deepEqual(indexes, before.rows.indexes.values);
            assert.deepEqual(emptyIndexes, []);
            assert.deepEqual(records, { chat: record });
            assert.deepEqual(emptyRecords, {});
        }
        assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});
test('listExportRecords enforces account isolation without fallback leakage', async () => {
    const env = indexStorage(); try {
        const a = { format: 'html' as const, status: 'ok' as const, exportedAt: 10 };
        const b = { format: 'json' as const, status: 'partial' as const, exportedAt: 20 };
        await putExportRecord(key('same'), a); await putExportRecord(key('same', B), b);
        assert.deepEqual(await listExportRecords(A), { same: a }); assert.deepEqual(await listExportRecords(B), { same: b });
    } finally { env.restore(); }
});
