import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
export {};
const test = require('node:test');
const assert = require('node:assert');

const TakeoutEngine = require('../src/core/engine/takeoutEngine.js');

test('asset_dedup - ZIP import preserves exact image bytes and per-turn Domain ownership', async () => {
    const slot = 'batch043-asset-ownership';
    const id = 'chat_multi_img_123';
    const g = globalThis as any;
    const originalJSZip = Object.getOwnPropertyDescriptor(g, 'JSZip');
    const JSZip = require('../lib/jszip.min.js');
    Object.defineProperty(g, 'JSZip', { value: JSZip, configurable: true, writable: true });

    try {
        const zip = new JSZip();
        const images = [
            { filename: 'image-adb659a48f83024b.png', bytes: [10, 20, 30] },
            { filename: 'image-088981d4885e6166.png', bytes: [40, 50, 60] },
            { filename: 'image-b70178f36ab8ed17.png', bytes: [70, 80, 90] },
        ];
        const html = `<html><body>${images.map((image, i) => `
            <div class="outer-cell">
              <a href="https://gemini.google.com/app/${id}">Chat Multi</a>
              <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Question ${i + 1}<br>
                Attached 1 file.<br>
                - <a href="${image.filename}">image.png</a><br>
                <p>Response ${i + 1}</p></div>
            </div>`).join('')}</body></html>`;
        zip.file('Takeout/Gemini/MyActivity.html', html);
        for (const image of images) zip.file(`Takeout/Gemini/${image.filename}`, new Uint8Array(image.bytes));
        zip.file('Takeout/Gemini/unreferenced.png', new Uint8Array([97, 98, 99]));

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        const parsed = await TakeoutEngine.parseTakeoutZip(zipBuffer, null, slot);
        assert.strictEqual(parsed.status, 'ok', 'all referenced resources must resolve');
        assert.strictEqual(parsed.resourceResults.filter((result: any) => result.ok).length, 3,
            'only three referenced resources are delivered');
        const native = TakeoutEngine.getTakeoutOfflineChat(id, slot);
        assert.ok(native, 'real ZIP import must produce a native Domain conversation');
        assert.strictEqual(native.conversation.detail.assets.length, 3,
            'an unreferenced ZIP file must not become a Domain asset');

        const userMessages = native.conversation.detail.messages.filter((message: any) => message.role === 'user');
        assert.strictEqual(userMessages.length, images.length);
        const owned = new Set<string>();
        for (let i = 0; i < images.length; i++) {
            const ids = userMessages[i].attachmentIds || [];
            assert.strictEqual(ids.length, 1, `turn ${i + 1} must own one source image`);
            assert.strictEqual(owned.has(ids[0]), false, 'distinct source images must not share an asset ID');
            owned.add(ids[0]);
            const path = native.resourceHints[ids[0]]?.archivePath;
            assert.ok(path?.endsWith(`/${images[i].filename}`),
                `turn ${i + 1} must own its exact source file, not a similarly named image`);
            assert.deepStrictEqual(
                await TakeoutEngine.getTakeoutFallbackMedia(id, { assetId: ids[0] }, slot),
                new Uint8Array(images[i].bytes),
                'Domain asset ownership must resolve the correct original archive bytes'
            );
        }
        assert.strictEqual(
            await TakeoutEngine.getTakeoutFallbackMedia(id, { assetId: '', sourceUri: 'image.png' }, slot),
            null, 'generic names must not select an arbitrary sibling image'
        );
        assert.strictEqual(
            await TakeoutEngine.getTakeoutFallbackMedia(id, { assetId: '', sourceUri: 'unreferenced.png' }, slot),
            null, 'unused ZIP media must not be bound to this conversation'
        );
    } finally {
        TakeoutEngine.clearTakeoutData(slot);
        if (originalJSZip) Object.defineProperty(g, 'JSZip', originalJSZip);
        else delete g.JSZip;
    }
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

    const item = { assetId: 'sliced', localName: 'assets/sliced.png', url: 'https://example.com/sliced.png' };
    const chat = { id: 'chat1', title: 'Test Chat' };
    const res = await pipeline.processAsset(item, chat, { isImage: true });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(writtenPath, 'assets/sliced.png');
    assert.ok(writtenBytes instanceof Uint8Array, 'Written content must be Uint8Array');
    assert.strictEqual(writtenBytes.byteLength, 4, `Expected byteLength 4, got ${writtenBytes.byteLength}`);
    assert.deepStrictEqual(Array.from(writtenBytes), [30, 40, 50, 60], 'Should only write slice contents, not slab');
});

