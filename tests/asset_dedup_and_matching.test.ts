export {};
const test = require('node:test');
const assert = require('node:assert');

const TakeoutEngine = require('../src/core/engine/takeoutEngine.js');
const { BatchWorker } = require('../src/core/engine/export/batchWorker.js');

test('asset_dedup - Takeout getTakeoutFallbackMedia retrieves exact image among multiple image-*.png files', async () => {
    (global as any).JSZip = require('../lib/jszip.min.js');
    const zip = new (global as any).JSZip();

    const htmlContent = `
    <html><body>
      <div class="outer-cell">
        <a href="https://gemini.google.com/app/chat_multi_img_123">Chat Multi</a>
        Prompted Question 1<br>
        Attached 1 file.<br>
        - <a href="image-adb659a48f83024b.png">image.png</a><br>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1"><p>Response 1</p></div>
      </div>
      <div class="outer-cell">
        <a href="https://gemini.google.com/app/chat_multi_img_123">Chat Multi</a>
        Prompted Question 2<br>
        Attached 1 file.<br>
        - <a href="image-088981d4885e6166.png">image.png</a><br>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1"><p>Response 2</p></div>
      </div>
      <div class="outer-cell">
        <a href="https://gemini.google.com/app/chat_multi_img_123">Chat Multi</a>
        Prompted Question 3<br>
        Attached 1 file.<br>
        - <a href="image-b70178f36ab8ed17.png">image.png</a><br>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1"><p>Response 3</p></div>
      </div>
    </body></html>
    `;

    zip.file('Takeout/Gemini/MyActivity.html', htmlContent);
    const data1 = new Uint8Array([10, 20, 30]);
    const data2 = new Uint8Array([40, 50, 60]);
    const data3 = new Uint8Array([70, 80, 90]);
    zip.file('Takeout/Gemini/image-adb659a48f83024b.png', data1);
    zip.file('Takeout/Gemini/image-088981d4885e6166.png', data2);
    zip.file('Takeout/Gemini/image-b70178f36ab8ed17.png', data3);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    TakeoutEngine.clearTakeoutData();
    await TakeoutEngine.parseTakeoutZip(zipBuffer);

    // 1. Exact requests must return respective distinct byte buffers
    const res1 = await TakeoutEngine.getTakeoutFallbackMedia('chat_multi_img_123', 'image-adb659a48f83024b.png');
    assert.ok(res1, 'Should find image-adb659a48f83024b.png');
    assert.deepStrictEqual(Array.from(res1), [10, 20, 30]);

    const res2 = await TakeoutEngine.getTakeoutFallbackMedia('chat_multi_img_123', 'image-088981d4885e6166.png');
    assert.ok(res2, 'Should find image-088981d4885e6166.png');
    assert.deepStrictEqual(Array.from(res2), [40, 50, 60], 'Should NOT return data of first image');

    const res3 = await TakeoutEngine.getTakeoutFallbackMedia('chat_multi_img_123', 'image-b70178f36ab8ed17.png');
    assert.ok(res3, 'Should find image-b70178f36ab8ed17.png');
    assert.deepStrictEqual(Array.from(res3), [70, 80, 90], 'Should NOT return data of first image');

    // 2. Ambiguous generic request 'image.png' when multiple media exist must return null (not hijack first image)
    const resGeneric = await TakeoutEngine.getTakeoutFallbackMedia('chat_multi_img_123', 'image.png');
    assert.strictEqual(resGeneric, null, 'Must NOT arbitrarily pick first image when multiple exist');
});

test('asset_dedup - batchWorker resolveChat only supplements genuine AI generated media', async () => {
    const mockTakeoutEngine = {
        getTakeoutOfflineChat: () => null,
        getTakeoutMediaForChat: () => [
            { filename: 'user_upload_photo.png', isGenerated: false },
            { filename: 'ai_artwork_generated.png', isGenerated: true }
        ]
    };

    const chat = {
        id: 'test_chat_batch_worker',
        title: 'Art Creation',
        messages: [
            { role: 'user', content: 'Draw an artwork' },
            { role: 'model', content: 'Here is your artwork:' }
        ]
    };

    const requested = { id: 'test_chat_batch_worker', title: 'Art Creation' };
    const res = await BatchWorker.resolveChat(chat, requested, null, mockTakeoutEngine, 'u0');

    assert.ok(res.chat, 'resolveChat should return chat');
    assert.equal(res.chat.messages[1].content, 'Here is your artwork:', 'Missing evidence must not select an arbitrary model reply');
    const modelMsg = res.chat.messages[2];
    assert.ok(modelMsg, 'Unresolved generated media must remain separately exportable');

    // Should include ai_artwork_generated.png as generated media
    assert.ok(modelMsg.content.includes('ai_artwork_generated.png'), 'Generated media should be added');

    // Should NOT include user_upload_photo.png as generated media
    assert.ok(!modelMsg.content.includes('user_upload_photo.png'), 'User upload should NOT be added as generated image');
});

test('asset_dedup - AssetPipeline preserves byteOffset and byteLength for sliced buffers', async () => {
    const { AssetPipeline } = require('../src/core/engine/assetPipeline.js');
    let writtenBytes: any = null;
    let writtenPath = '';

    const mockWriter = {
        writeFile: async (path: string, content: any) => {
            writtenPath = path;
            writtenBytes = content;
            return path;
        }
    };

    const pipeline = new AssetPipeline({
        useZip: true,
        writer: mockWriter,
        fetchAssetDelegate: async () => {
            const slab = new Uint8Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
            const slice = new Uint8Array(slab.buffer, 3, 4);
            return {
                success: true,
                dataBuffer: slice,
                mime: 'image/png'
            };
        }
    });

    const item = { localName: 'assets/sliced.png', url: 'https://example.com/sliced.png' };
    const chat = { id: 'chat1', title: 'Test Chat' };
    const res = await pipeline.processAsset(item, chat, { isImage: true });

    assert.strictEqual(res.saved, true);
    assert.strictEqual(writtenPath, 'assets/sliced.png');
    assert.ok(writtenBytes instanceof Uint8Array, 'Written content must be Uint8Array');
    assert.strictEqual(writtenBytes.byteLength, 4, `Expected byteLength 4, got ${writtenBytes.byteLength}`);
    assert.deepStrictEqual(Array.from(writtenBytes), [30, 40, 50, 60], 'Should only write slice contents, not slab');
});

