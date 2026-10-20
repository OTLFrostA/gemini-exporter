import test from 'node:test';
import assert from 'node:assert/strict';
import { useIndexStorage } from './helpers/indexStorage.js';
import { fixtureKey } from './helpers/domainFixture.js';
import { ingestIndexes, ingestDetail, ingestDeletedConversation } from '../src/l2/ingestion.js';
import { getIndex, getDetail, getExportRecord, putExportRecord } from '../src/l3a/storageService.js';

useIndexStorage();

const body = (text: string, savedAt: number) => ({
    savedAt,
    quality: { status: 'complete' as const },
    assets: [],
    messages: [{ role: 'user' as const, content: [{ type: 'paragraph' as const,
        children: [{ type: 'text' as const, text }] }] }],
});

test('a newly committed L2 title remains authoritative when an older Detail is admitted', async () => {
    const key = fixtureKey('export-current-title');
    await ingestDetail(key.accountId, key.conversationId, body('Initial body', 100),
        { title: 'Original', titleSource: 'provider', updatedAt: 100 });
    await ingestIndexes(key.accountId, [{
        conversationId: key.conversationId,
        fields: { title: 'User rename', titleSource: 'user', updatedAt: 200 },
    }]);
    await ingestDetail(key.accountId, key.conversationId, body('Old body', 90),
        { title: 'Old provider title', titleSource: 'provider', updatedAt: 90 });
    assert.equal((await getIndex(key))?.title, 'User rename');
    assert.equal((await getIndex(key))?.updatedAt, 200);
    assert.equal((await getDetail(key))?.savedAt, 100);
});

test('writing a completion record preserves the latest independently committed Index and Detail', async () => {
    const key = fixtureKey('completed-current-title');
    await ingestDetail(key.accountId, key.conversationId, body('First body', 100),
        { title: 'Source title', titleSource: 'provider', updatedAt: 100 });
    await ingestIndexes(key.accountId, [{
        conversationId: key.conversationId, fields: { title: 'Updated', titleSource: 'user', updatedAt: 200 },
    }]);
    const index = await getIndex(key), detail = await getDetail(key);
    const record = { exportedAt: 300, chatTime: 100, status: 'ok' as const, format: 'markdown' as const };
    await putExportRecord(key, record);
    assert.deepEqual(await getIndex(key), index);
    assert.deepEqual(await getDetail(key), detail);
    assert.deepEqual(await getExportRecord(key), record);
});

test('reobserved conversation after a verified deletion starts from newly committed facts', async () => {
    const key = fixtureKey('deleted-and-reobserved');
    await ingestDetail(key.accountId, key.conversationId, body('Old body', 100),
        { title: 'Old title', titleSource: 'provider', updatedAt: 100 });
    await putExportRecord(key, { exportedAt: 200, chatTime: 100, status: 'ok', format: 'markdown' });
    await ingestDeletedConversation(key.accountId, key.conversationId);
    await ingestDetail(key.accountId, key.conversationId, body('New body', 300),
        { title: 'New title', titleSource: 'provider', updatedAt: 300 });
    assert.equal((await getIndex(key))?.title, 'New title');
    assert.equal((await getDetail(key))?.savedAt, 300);
    assert.equal(await getExportRecord(key), null);
});
