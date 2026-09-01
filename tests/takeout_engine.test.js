const test = require('node:test');
const assert = require('node:assert');
const TakeoutEngine = require('../takeout_engine.js');

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
