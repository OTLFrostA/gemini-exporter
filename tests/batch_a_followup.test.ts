import test from 'node:test';
import assert from 'node:assert/strict';
import AssetPipeline from '../src/core/engine/assetPipeline.js';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
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

const takeoutHtml = `<div class="outer-cell"><a href="https://gemini.google.com/app/histimg01">Chat</a>
<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Look <a href="cat.png">cat</a><br>
2026-09-02T12:00:00Z<br><p>A cat.</p></div></div>`;

test('batch A native Takeout keeps explicitly referenced user images as semantic assets', () => {
    const parsed = parseConversation({ format: 'gemini-takeout', providerId: 'gemini', data: {
        htmlText: takeoutHtml, archiveFiles: { 'cat.png': { dir: false } }
    } });
    const user = parsed.conversation.messages[0];
    assert.equal(user.role, 'user');
    const asset = parsed.conversation.assets[0];
    assert.deepEqual(user.attachmentIds, [asset!.id]);
    assert.equal(asset?.kind, 'image');
    assert.equal(asset?.name, 'cat.png');
    assert.equal(parsed.archiveResources[asset!.id].path, 'cat.png');
    assert.equal('localName' in asset!, false);
});

test('batch A native Takeout reports missing archive references without inventing a match', () => {
    const parsed = parseConversation({ format: 'gemini-takeout', providerId: 'gemini', data: { htmlText: takeoutHtml } });
    assert.equal(parsed.conversation.assets.length, 1);
    assert.equal(parsed.conversation.assets[0].failureReason, 'Missing archive entry');
    assert.deepEqual(parsed.archiveResources, {});
});

test('batch A ZipBombGuard preserves string length size semantics', () => {
    assert.doesNotThrow(() => validateZipFile('binary-string-input'));
});
