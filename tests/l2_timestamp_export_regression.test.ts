import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestDetail, ingestIndexes } from '../src/l2/ingestion.js';
import { getIndex, getDetail } from '../src/l3a/storageService.js';
import { runExport } from '../src/application/export/runExport.js';
import { __setZipConstructor } from '../src/l4/packaging/writers/zipWriter.js';
import { v2ExportHost, exportKey, exportRequest, seedExportConversation, readDeliveredFiles } from './helpers/v2ExportHost.js';

for (const entry of ['index', 'detail'] as const) {
    test(`L2 ${entry} rejects out-of-Date-range updatedAt before persistence and application Markdown export succeeds`, async t => {
        const host = v2ExportHost(t);
        __setZipConstructor(require('../lib/jszip.min.js'));
        await seedExportConversation('timestamp');
        const key = exportKey('timestamp');
        const originalIndex = await getIndex(key);
        const originalDetail = await getDetail(key);
        const ingest = (updatedAt: number) => entry === 'index'
            ? ingestIndexes(key.accountId, [{ conversationId: key.conversationId, fields: { updatedAt } }])
            : ingestDetail(key.accountId, key.conversationId, {
                quality: { status: 'complete' }, assets: [], messages: [], savedAt: 200,
            }, { updatedAt });
        for (const invalid of [8640000000000001, -8640000000000001]) {
            await assert.rejects(ingest(invalid), TypeError);
            assert.deepEqual(await getIndex(key), originalIndex);
            assert.deepEqual(await getDetail(key), originalDetail);
        }
        await seedExportConversation('timestamp', 200);
        assert.equal((await getIndex(key))?.updatedAt, 200);
        await seedExportConversation('boundary', 8640000000000000);
        assert.equal((await getIndex(exportKey('boundary')))?.updatedAt, 8640000000000000);
        const result = await runExport(exportRequest(['timestamp', 'boundary']));
        assert.equal(result.exported, 2);
        assert.deepEqual(result.failed, []);
        const files = await readDeliveredFiles(host);
        const markdown = await Promise.all(files.filter(file => file.name.endsWith('.md')).map(file => file.async('string')));
        assert.equal(markdown.length, 2);
        assert.ok(markdown.some(content => String(content).includes('+275760-09-13T00:00:00.000Z')));
        assert.ok(markdown.some(content => String(content).includes('1970-01-01T00:00:00.200Z')));
    });
}
