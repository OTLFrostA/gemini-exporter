const test = require('node:test');
const assert = require('node:assert');
const AssetPipeline = require('../src/core/engine/assetPipeline.js');
const Extractors = require('../src/core/api/parser/extractors.js');

test('P1 regression: AssetPipeline requests native ArrayBuffer (preferBuffer: true) to prevent Base64 OOM', async () => {
    let capturedMessage = null;
    const origChrome = global.chrome;
    global.chrome = {
        tabs: {
            sendMessage: (tabId, message, callback) => {
                capturedMessage = message;
                callback({ success: true, dataBuffer: new ArrayBuffer(16) });
            }
        },
        runtime: { lastError: null }
    };

    try {
        const pipeline = new AssetPipeline({
            currentSlot: 'u0',
            getGeminiTab: async () => ({ id: 12345 }),
            useZip: true,
            folder: { file: () => {} }
        });

        const item = { url: 'https://lh3.googleusercontent.com/test.png', fileName: 'test.png' };
        const chat = { id: 'c_test123' };

        await pipeline.processAsset(item, chat, { isImage: true });

        assert.ok(capturedMessage, 'chrome.tabs.sendMessage must be called');
        assert.strictEqual(capturedMessage.action, 'downloadAssetDirect');
        assert.strictEqual(
            capturedMessage.preferBuffer,
            true,
            'P1 fix: AssetPipeline must send preferBuffer: true so that assetFetcher transmits ArrayBuffer instead of Base64'
        );
    } finally {
        global.chrome = origChrome;
    }
});

test('P2 regression: robustFirstPayload executes in sub-linear time on large multiline payloads', () => {
    // Construct a 600-line batchexecute payload with brackets inside string fields
    const lines = [")]}'", "["];
    for (let i = 0; i < 600; i++) {
        lines.push(`  ["turn_${i}", "user query with [nested bracket] ${i}", "response_${i}"],`);
    }
    lines.push('  ["final_turn", "query", "answer"]');
    lines.push(']');
    const payload = lines.join('\n');

    const t0 = performance.now();
    const result = Extractors.robustFirstPayload(payload);
    const elapsed = performance.now() - t0;

    assert.ok(Array.isArray(result), 'Payload must parse to array');
    assert.strictEqual(result.length, 601, 'Must extract all 601 items');
    // On O(N^2) line-by-line concatenation, 600 lines with bracket candidates takes > 100ms
    // On O(N) single-pass state-machine parsing, it executes in < 30ms
    assert.ok(
        elapsed < 35,
        `robustFirstPayload must parse 600 lines in < 35ms, took ${elapsed.toFixed(1)}ms`
    );
});

test('P2 regression: robustFirstPayload handles strings containing brackets without corrupting structure', () => {
    const jsonStr = `)]}'\n\n[[ "wrb.fr", "MaZiqc", "[[\\"c_123\\", \\"Title [with bracket]\\", [1700000000, 0]]]" ]]`;
    const res = Extractors.robustFirstPayload(jsonStr);
    assert.ok(Array.isArray(res));
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0][0], 'wrb.fr');
    assert.strictEqual(res[0][1], 'MaZiqc');
});
