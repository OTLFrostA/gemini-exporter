import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalFixture } from './helpers/nativeFixture.js';
import { makeTestWorker } from './helpers/makeTestWorker.js';
import { ExportOrchestrator } from '../src/core/engine/export/exportOrchestrator.js';
import { __clearModuleOverrides, __setModuleOverride } from '../src/core/utils/moduleOverrides.js';

// A worker rejection must fail only its own conversation; the next chat still exports.
test('P1-011: a worker rejection records one failure and does not stop the next chat', async () => {
    const fetchedIds: string[] = [];
    const savedIds: string[] = [];
    const notifiedIds: string[] = [];
    let downloads = 0;

    __setModuleOverride('JSZip', class {
        folder() { return { file: () => {} }; }
        async generateAsync() { return new Blob(['test zip'], { type: 'application/zip' }); }
    });
    __setModuleOverride('StorageService', {
        getExportedIds: async () => ({}),
        saveExportRecord: async (_slot: string, id: string) => {
            savedIds.push(id);
            return {};
        }
    });

    try {
        const result = await new ExportOrchestrator().run({ accountId: '10000000-0000-4000-8000-000000000001', ...({
            selected: [{ id: 'broken', title: 'Broken' }, { id: 'healthy', title: 'Healthy' }],
            concurrency: 1,
            format: 'markdown',
            useZip: true,
            includeAssets: false,
            downloadHandler: async () => { downloads++; },
            worker: makeTestWorker({
                fetchChatDetail: async (item) => {
                    fetchedIds.push(item.id);
                    if (item.id === 'broken') throw new Error('injected worker rejection');
                    return {
                        success: true,
                        chat: historicalFixture({
                            id: item.id,
                            title: 'Healthy',
                            messages: [{ role: 'user', content: 'Still exported' }]
                        })
                    };
                }
            })
        }) }, {
            onItemExported: (id) => { notifiedIds.push(id); }
        });

        assert.deepEqual(fetchedIds, ['broken', 'healthy']);
        assert.equal(result.aborted, false);
        assert.equal(result.landedChats, 1);
        assert.equal(result.failedChats.length, 1);
        assert.equal(result.failedChats[0].id, 'broken');
        assert.equal(result.failedChats[0].error, 'injected worker rejection');
        assert.equal(downloads, 1);
        assert.deepEqual(savedIds, ['healthy']);
        assert.deepEqual(notifiedIds, ['healthy']);
    } finally {
        __clearModuleOverrides();
    }
});
