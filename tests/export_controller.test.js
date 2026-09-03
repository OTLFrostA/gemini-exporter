const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const ExportController = (typeof require !== 'undefined') ? require('../src/ui/controllers/exportController.js') : (typeof globalThis.ExportController !== 'undefined' ? globalThis.ExportController : null);

test('exportController - state machine and flags', () => {
    assert.strictEqual(ExportController.isRunning(), false);
    ExportController.setRunning(true);
    assert.strictEqual(ExportController.isRunning(), true);
    ExportController.setRunning(false);
    assert.strictEqual(ExportController.isRunning(), false);
});

test('exportController - exports API signatures', () => {
    assert.strictEqual(typeof ExportController.runExport, 'function');
    assert.strictEqual(typeof ExportController.abort, 'function');
    assert.strictEqual(typeof ExportController.setRunning, 'function');
    assert.strictEqual(typeof ExportController.isRunning, 'function');
    assert.strictEqual(typeof ExportController.getActiveEngine, 'function');
});

test('GeminiUtils.formatExportProgress - formats conversation progress and attachment stats', () => {
    const GeminiUtils = require('../src/core/utils/utils.js');
    assert.strictEqual(typeof GeminiUtils.formatExportProgress, 'function');

    // Case 1: Active export with chats and attachments in Chinese
    const resZh = GeminiUtils.formatExportProgress({
        current: 2,
        total: 5,
        pct: 40,
        title: 'CAS无法夺取制空权机制',
        assetsDownloaded: 3,
        assetsTotal: 8
    }, '', false);

    assert.strictEqual(resZh.pct, 40);
    assert.ok(resZh.text.includes('导出中 (2/5)'), 'Must include progress count (2/5)');
    assert.ok(resZh.text.includes('CAS无法夺取制空权机制'), 'Must include chat title');
    assert.ok(resZh.text.includes('📎 附件 3/8'), 'Must include attachment count 3/8');

    // Case 2: Active export with English locale
    const resEn = GeminiUtils.formatExportProgress({
        current: 4,
        total: 10,
        pct: 40,
        title: 'Quantum Computing',
        assetsDownloaded: 5,
        assetsTotal: 12
    }, '', true);

    assert.ok(resEn.text.includes('Exporting (4/10)'), 'Must include English progress count (4/10)');
    assert.ok(resEn.text.includes('📎 Assets 5/12'), 'Must include English asset count 5/12');

    // Case 3: Packaging ZIP stage
    const resZip = GeminiUtils.formatExportProgress({
        current: 5,
        total: 5,
        pct: 95,
        title: 'Packaging ZIP file...',
        assetsDownloaded: 8,
        assetsTotal: 8
    }, '', false);

    assert.ok(resZip.text.includes('正在打包 ZIP 文件...'), 'Translates system title');
    assert.ok(resZip.text.includes('📎 附件 8/8'), 'Keeps attachment stats');

    // Case 4: No attachments
    const resNoAssets = GeminiUtils.formatExportProgress({
        current: 1,
        total: 3,
        pct: 33,
        title: 'Simple Chat'
    }, '', false);

    assert.ok(resNoAssets.text.includes('导出中 (1/3)'));
    assert.ok(!resNoAssets.text.includes('📎 附件'), 'Omits attachment text when no assets');

    // Case 5: Legacy numeric progress
    const resLegacy = GeminiUtils.formatExportProgress(60, 'Processing Takeout...');
    assert.strictEqual(resLegacy.pct, 60);
    assert.strictEqual(resLegacy.text, 'Processing Takeout...');
});
