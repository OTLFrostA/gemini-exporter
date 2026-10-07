import test from 'node:test';
import assert from 'node:assert/strict';
import AssetPipeline from '../src/core/engine/assetPipeline.js';
import { parseTakeoutHtmlBlocks } from '../src/core/compatibility/takeout/takeoutHtmlParser.js';
import { validateZipFile } from '../src/core/compatibility/archive/zipBombGuard.js';

test('batch A asset no-response keeps the historical default failure reason', async () => {
    const pipeline = new AssetPipeline({
        fetchAssetDelegate: async () => undefined
    });
    const result = await pipeline.processAsset(
        { url: 'https://example.test/image.png', localName: 'image.png' },
        { id: 'chat-no-response' },
        { isImage: true, maxRetries: 0 }
    );
    assert.equal(result.saved, false);
    assert.equal(result.failReason, 'image direct download failed');
});

const takeoutHtml = `
<div class="outer-cell">
  <a href="https://gemini.google.com/app/c_histimg01">Conversation</a>
  Prompted draw a cat<br>
  <img src="cat.png">
  <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1"><p>A cat.</p></div>
</div>`;

test('batch A Takeout historical images preserve their shape without a synthetic type', async () => {
    const parsed = await parseTakeoutHtmlBlocks({ htmlText: takeoutHtml, zipFiles: {} });
    const user = parsed.localConvCache.histimg01.messages?.find((message) => message.role === 'user');
    assert.ok(user?.images?.length);
    assert.equal('type' in user.images[0], false);
    assert.equal(user.images[0].fileName, 'cat.png');
});

test('batch A malformed Takeout ZIP entries are ignored without crashing the parser', async () => {
    const parsed = await parseTakeoutHtmlBlocks({
        htmlText: takeoutHtml,
        zipFiles: { malformed: 42, invalidDir: { dir: 'yes' } }
    });
    assert.ok(parsed.localConvCache.histimg01);
    assert.deepEqual(parsed.localMediaMap.histimg01, []);
});

test('batch A ZipBombGuard preserves string length size semantics', () => {
    assert.doesNotThrow(() => validateZipFile('binary-string-input'));
});
