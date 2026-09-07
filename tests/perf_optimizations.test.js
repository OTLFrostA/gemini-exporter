const test = require('node:test');
const assert = require('node:assert');

// Ensure parser is available in global for geminiClient in Node environment
const { GeminiResponseParserClass } = require('../src/core/api/geminiParser.js');
global.GeminiResponseParserClass = GeminiResponseParserClass;

// 1. Test 429 rate limit backoff in GeminiAPIClient
test('perf - geminiClient 429 backoff retries and recovers on transient rate limit', async () => {
    const { GeminiAPIClient } = require('../src/core/api/geminiClient.js');
    const client = new GeminiAPIClient();

    // Mock global fetch
    const originalFetch = global.fetch;
    let callCount = 0;
    const recordedDelays = [];

    // Save and mock setTimeout to avoid real delays in test
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (fn, delay) => {
        recordedDelays.push(delay);
        return originalSetTimeout(fn, 1);
    };

    try {
        global.fetch = async (url, opts) => {
            callCount++;
            if (callCount < 3) {
                return {
                    ok: false,
                    status: 429,
                    statusText: 'Too Many Requests',
                    headers: new Map(),
                    text: async () => 'Rate limit exceeded'
                };
            }
            // 3rd call succeeds with minimal valid batchexecute list
            const mockListInner = JSON.stringify([null, [["c_conv123", "Conversation 1", [1700000000, 0], [1700000000, 0], 1]], null]);
            const mockTop = JSON.stringify([["wrb.fr", "MaZiqc", mockListInner]]);
            return {
                ok: true,
                status: 200,
                headers: new Map(),
                text: async () => `)]}'\n\n${mockTop}`
            };
        };

        const res = await client.getConversationList(null, 'test_sid', null, { maxRetries: 3 });
        assert.strictEqual(callCount, 3, 'should have retried twice and succeeded on 3rd attempt');
        assert.ok(res.conversations && res.conversations.length === 1, 'should have parsed conversations successfully');
        assert.strictEqual(res.conversations[0].id, 'conv123');
        assert.strictEqual(recordedDelays.length, 2, 'should have delayed twice');
        assert.ok(recordedDelays[0] >= 2000, 'first delay should be >= 2000ms');
        assert.ok(recordedDelays[1] >= 4000, 'second delay should be >= 4000ms');
    } finally {
        global.fetch = originalFetch;
        global.setTimeout = originalSetTimeout;
    }
});

test('perf - geminiClient 429 throws after exceeding maxRetries', async () => {
    const { GeminiAPIClient } = require('../src/core/api/geminiClient.js');
    const client = new GeminiAPIClient();

    const originalFetch = global.fetch;
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (fn, delay) => originalSetTimeout(fn, 1);

    let callCount = 0;
    try {
        global.fetch = async () => {
            callCount++;
            return {
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                headers: new Map(),
                text: async () => 'Rate limit exceeded'
            };
        };

        await assert.rejects(async () => {
            await client.getConversationList(null, 'test_sid', null, { maxRetries: 2 });
        }, /HTTP 429/);
        assert.strictEqual(callCount, 3, 'initial attempt + 2 retries = 3 calls total');
    } finally {
        global.fetch = originalFetch;
        global.setTimeout = originalSetTimeout;
    }
});

// 2. Test Takeout HTML parsing time-slicing and progress
test('perf - takeoutEngine yields to event loop and reports incremental progress on large archives', async () => {
    const TakeoutEngine = require('../src/core/engine/takeoutEngine.js');
    global.JSZip = require('../lib/jszip.min.js');
    const zip = new global.JSZip();

    // Construct 120 blocks to trigger both 50-block time slicing and 100-block progress report
    let html = '<html><body>';
    for (let i = 1; i <= 120; i++) {
        html += `
        <div class="outer-cell">
          <a href="https://gemini.google.com/app/c_takeout_chat_${i}">Link</a>
          Prompted Question ${i}<br>
          <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1"><p>Answer ${i}</p></div>
        </div>`;
    }
    html += '</body></html>';
    zip.file('Takeout/Gemini/MyActivity.html', html);
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    const progressReports = [];
    TakeoutEngine.clearTakeoutData();
    const res = await TakeoutEngine.parseTakeoutZip(buf, (pct, msg) => {
        progressReports.push({ pct, msg });
    });

    assert.strictEqual(res.conversations.length, 120, 'all 120 conversations should be parsed');
    // Check that incremental progress for block 100 was reported
    const detailProgress = progressReports.find(p => p.msg && p.msg.includes('100/120'));
    assert.ok(detailProgress, 'should report progress for 100/120 blocks during time slicing');
    assert.ok(detailProgress.pct >= 70 && detailProgress.pct <= 88, 'pct should be scaled between 70 and 88');
});

// 3. Test AssetFetcher ArrayBuffer transfer
test('perf - assetFetcher returns ArrayBuffer directly when preferBuffer is true', async () => {
    const AssetFetcher = require('../src/content/assetFetcher.js');

    const originalFetch = global.fetch;
    const testData = Buffer.from('fake image binary content 1234567890');
    try {
        global.fetch = async () => ({
            ok: true,
            headers: new Map([['content-type', 'image/png']]),
            blob: async () => ({
                size: testData.length,
                type: 'image/png',
                arrayBuffer: async () => testData.buffer.slice(testData.byteOffset, testData.byteOffset + testData.byteLength)
            })
        });

        let responsePayload = null;
        await AssetFetcher.downloadAssetDirect({
            url: 'https://lh3.googleusercontent.com/test_img.png',
            preferBuffer: true
        }, (res) => {
            responsePayload = res;
        });

        assert.ok(responsePayload, 'should receive response');
        assert.strictEqual(responsePayload.success, true);
        assert.ok(responsePayload.dataBuffer instanceof ArrayBuffer, 'dataBuffer should be an ArrayBuffer');
        assert.strictEqual(responsePayload.dataBuffer.byteLength, testData.length);
        assert.strictEqual(responsePayload.dataBase64, undefined, 'dataBase64 should not be generated when preferBuffer is fulfilled');
    } finally {
        global.fetch = originalFetch;
    }
});

// 4. Test ExportEngine rateLimitCooldownUntil initialization
test('perf - ExportEngine initializes and tracks rateLimitCooldownUntil', () => {
    const { ExportEngine } = require('../src/core/engine/exportEngine.js');
    const engine = new ExportEngine();
    assert.strictEqual(engine.rateLimitCooldownUntil, 0, 'rateLimitCooldownUntil should be initialized to 0');
});
