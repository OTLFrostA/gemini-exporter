const test = require('node:test');
const assert = require('node:assert');
const TakeoutEngine = require('../src/core/engine/takeoutEngine.js');

test('takeout_engine - exports and methods', () => {
    assert.strictEqual(typeof TakeoutEngine.parseTakeoutZip, 'function');
    assert.strictEqual(typeof TakeoutEngine.getTakeoutOfflineChat, 'function');
    assert.strictEqual(typeof TakeoutEngine.getTakeoutFallbackMedia, 'function');
    assert.strictEqual(typeof TakeoutEngine.clearTakeoutData, 'function');
});

test('takeout_engine - getTakeoutOfflineChat empty default', () => {
    TakeoutEngine.clearTakeoutData();
    assert.strictEqual(TakeoutEngine.getTakeoutOfflineChat('nonexistent_id'), null);
});

test('takeout_engine - parseTakeoutZip preserves ID case and syncs multi-turn titles.takeout slot', async () => {
    global.JSZip = require('../lib/jszip.min.js');
    const zip = new global.JSZip();

    // Multi-turn HTML: turn 1 has no prompt, turn 2 has real prompt, ID with mixed case "CaseSensitive_99"
    const htmlContent = `
    <html><body>
      <div class="outer-cell">
        <a href="https://gemini.google.com/app/c_CaseSensitive_99">Link 1</a>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1"><p>Response 1</p></div>
      </div>
      <div class="outer-cell">
        <a href="https://gemini.google.com/app/c_CaseSensitive_99">Link 2</a>
        Prompted 什么是量子物理？<br>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1"><p>量子物理是研究微观粒子的物理学分支。</p></div>
      </div>
    </body></html>
    `;

    zip.file('Takeout/Gemini/MyActivity.html', htmlContent);
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    TakeoutEngine.clearTakeoutData();
    const result = await TakeoutEngine.parseTakeoutZip(zipBuffer);

    assert.strictEqual(result.conversations.length, 1);
    const conv = result.conversations[0];
    
    // 1. ID case must be preserved (CaseSensitive_99, not lowercased to casesensitive_99)
    assert.strictEqual(conv.id, 'CaseSensitive_99');

    // 2. Title and titles.takeout must both be synced to turn 2's prompt
    assert.strictEqual(conv.title, '什么是量子物理？');
    assert.strictEqual(conv.titles.takeout, '什么是量子物理？');

    // 3. getTakeoutOfflineChat should find by exact ID and with c_ prefix
    const offlineChat1 = TakeoutEngine.getTakeoutOfflineChat('CaseSensitive_99');
    assert.ok(offlineChat1, 'Should find offline chat by exact ID');
    assert.strictEqual(offlineChat1.title, '什么是量子物理？');
    assert.strictEqual(offlineChat1.titles.takeout, '什么是量子物理？');
    assert.strictEqual(offlineChat1.messages.length, 4); // 2 turns * (1 user + 1 model)

    const offlineChat2 = TakeoutEngine.getTakeoutOfflineChat('c_CaseSensitive_99');
    assert.ok(offlineChat2, 'Should find offline chat with c_ prefix');
});

test('takeout_engine - extractC2PATimestamp extracts UTC timestamp from binary', () => {
    assert.strictEqual(typeof TakeoutEngine.extractC2PATimestamp, 'function');
    
    // Sample buffer containing C2PA timestamp: 20260902183651Z
    const fakeC2PABuf = Buffer.from('dummy_header_jumb_c2pa_signature_20260902183651Z_more_bytes');
    const ts = TakeoutEngine.extractC2PATimestamp(fakeC2PABuf);
    assert.ok(ts, 'Timestamp should be extracted');
    const expected = Date.UTC(2026, 8, 2, 18, 36, 51);
    assert.strictEqual(ts, expected);

    // No timestamp
    assert.strictEqual(TakeoutEngine.extractC2PATimestamp(Buffer.from('no_timestamp_here')), null);
    assert.strictEqual(TakeoutEngine.extractC2PATimestamp(null), null);
});

test('takeout_engine - parseTakeoutZip associates watermarked images via C2PA time correlation and monopolistic fallback', async () => {
    global.JSZip = require('../lib/jszip.min.js');
    const zip = new global.JSZip();

    // 2 conversations:
    // Chat A: prompt at 2026-08-27 23:10:04 UTC (1787958604000)
    // Chat B: prompt at 2026-08-24 18:43:31 UTC (1787683411000)
    const html = `
    <html><body>
      <div class="outer-cell">
        <a href="https://gemini.google.com/app/chat_A_12345678">Link A</a>
        Prompted 画一只火星上的猫<br>
        1 generated image.<br>
        Aug 27, 2026, 11:10:04 PM PDT<br>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1"><p>Here is your cat</p></div>
      </div>
      <div class="outer-cell">
        <a href="https://gemini.google.com/app/chat_B_87654321">Link B</a>
        Prompted 生成首页宣传图<br>
        1 generated image.<br>
        Aug 24, 2026, 6:43:31 PM PDT<br>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1"><p>Here is your banner</p></div>
      </div>
    </body></html>
    `;

    // Create 2 watermarked images with C2PA timestamps matching within 10-15s
    // Image A time: Aug 28, 2026 06:10:16 UTC (12s after Chat A)
    const imgABuffer = Buffer.from('fake_png_header_jumb_c2pa_20260828061016Z_tail');
    // Image B time: Aug 25, 2026 01:43:41 UTC (10s after Chat B)
    const imgBBuffer = Buffer.from('fake_png_header_jumb_c2pa_20260825014341Z_tail');

    zip.file('Takeout/My Activity/Gemini Apps/MyActivity.html', html);
    zip.file('Takeout/My Activity/Gemini Apps/watermarked_img_1111-aaaa.png', imgABuffer);
    zip.file('Takeout/My Activity/Gemini Apps/watermarked_img_2222-bbbb.png', imgBBuffer);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    TakeoutEngine.clearTakeoutData();
    const res = await TakeoutEngine.parseTakeoutZip(zipBuffer);

    assert.strictEqual(res.conversations.length, 2);

    // Chat A media must be watermarked_img_1111-aaaa.png
    const mediaA = TakeoutEngine.getTakeoutMediaForChat('chat_A_12345678');
    assert.strictEqual(mediaA.length, 1);
    assert.strictEqual(mediaA[0].filename, 'watermarked_img_1111-aaaa.png');
    assert.strictEqual(mediaA[0].isGenerated, true);

    // Chat B media must be watermarked_img_2222-bbbb.png
    const mediaB = TakeoutEngine.getTakeoutMediaForChat('chat_B_87654321');
    assert.strictEqual(mediaB.length, 1);
    assert.strictEqual(mediaB[0].filename, 'watermarked_img_2222-bbbb.png');
    assert.strictEqual(mediaB[0].isGenerated, true);

    // Offline chat model turn must contain ![Generated Image](assets/...)
    const chatAOffline = TakeoutEngine.getTakeoutOfflineChat('chat_A_12345678');
    assert.ok(chatAOffline);
    const modelTurnA = chatAOffline.messages.find(m => m.role === 'model');
    assert.ok(modelTurnA.content.includes('![Generated Image](assets/watermarked_img_1111-aaaa.png)'));
    assert.strictEqual(modelTurnA.images.length, 1);
    assert.strictEqual(modelTurnA.images[0].fileName, 'watermarked_img_1111-aaaa.png');

    // getTakeoutFallbackMedia should return binary buffer for watermarked image
    const binA = await TakeoutEngine.getTakeoutFallbackMedia('chat_A_12345678', 'watermarked_img_1111-aaaa.png');
    assert.ok(binA && binA.length > 0);
});

test('takeout_engine - authentic cleaned Takeout fixture parsing', async () => {
    const fs = require('fs');
    const path = require('path');
    const fixturePath = path.resolve(__dirname, 'fixtures/gemini_takeout_clean.zip');
    if (!fs.existsSync(fixturePath)) return;

    global.JSZip = require('../lib/jszip.min.js');
    const buf = fs.readFileSync(fixturePath);
    TakeoutEngine.clearTakeoutData();
    const res = await TakeoutEngine.parseTakeoutZip(buf);

    assert.strictEqual(res.conversations.length, 6, 'Should extract exactly 6 conversations');
    assert.strictEqual(res.totalMediaCount, 1, 'Should extract exactly 1 media asset');

    // Verify cat image conversation
    const catChat = res.conversations.find(c => c.id === '1bd028d5c5b0c0e2');
    assert.ok(catChat, 'Cat conversation should exist');
    assert.ok(catChat.title.includes('astronaut cat') || catChat.title.includes('Cat'));

    const catMedia = TakeoutEngine.getTakeoutMediaForChat('1bd028d5c5b0c0e2');
    assert.strictEqual(catMedia.length, 1);
    assert.ok(catMedia[0].filename.startsWith('watermarked_img_45281370108017511'));

    // Verify Python decorator conversation
    const pyChat = res.conversations.find(c => c.id === '1cea7e48cc166b57');
    assert.ok(pyChat, 'Python decorator conversation should exist');
    assert.ok(pyChat.title.includes('Python') || pyChat.title.includes('装饰器'));
});
