import { test } from 'node:test';
import assert from 'node:assert/strict';
import AssetPipeline from '../src/core/engine/assetPipeline.js';

// Unlike an assignment/regex guard, this exercises the actual direct writer
// after bytes have been acquired. A failed write must never mark an asset saved.
test('direct asset writer rejection records failure instead of success or refetching', async () => {
    const originalFetch = globalThis.fetch;
    const warnings: string[] = [];
    let fetchCalls = 0;
    let fetchCallsAtWrite = 0;
    let writeCalls = 0;

    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(new Uint8Array([1, 2, 3]).buffer, {
            headers: { 'Content-Type': 'image/png' },
        });
    };

    try {
        const pipeline = new AssetPipeline({
            useZip: false,
            writeFileDirect: async (fileName, bytes) => {
                writeCalls++;
                fetchCallsAtWrite = fetchCalls;
                assert.equal(fileName, 'assets/search.png');
                assert.deepEqual(Array.from(bytes), [1, 2, 3]);
                throw new Error('disk full');
            },
            fetchAssetDelegate: async () => {
                throw new Error('unexpected page-side fetch');
            },
            onLog: (message, level) => {
                if (level === 'warn') warnings.push(message);
            },
        });

        const result = await pipeline.processAsset(
            {
                sourceUrl: 'https://encrypted-tbn2.gstatic.com/licensed-image?q=test',
                localName: 'assets/search.png',
            },
            { id: 'chat', title: 'Export with full disk' },
            { isImage: true, maxRetries: 0 },
        );

        assert.equal(result.saved, false, 'a rejected write must never be marked saved');
        assert.match(result.failReason, /disk full/);
        assert.equal(result.recoveredFromTakeout, false);
        assert.equal(writeCalls, 1, 'the writer must be reached exactly once');
        assert.ok(fetchCallsAtWrite > 0, 'the asset must be acquired before the writer runs');
        assert.equal(fetchCalls, fetchCallsAtWrite, 'local write failures must not re-fetch acquired bytes');
        assert.match(warnings.join('\n'), /disk full/, 'the failure must reach the export log');
    } finally {
        globalThis.fetch = originalFetch;
    }
});
