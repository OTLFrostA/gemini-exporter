export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const pathUtils = require('../src/core/utils/pathUtils.js');
const titleUtils = require('../src/core/utils/titleUtils.js');
const { mergeConversation } = require('../src/core/utils/mergeUtils.js');
const progressUtils = require('../src/core/utils/progressUtils.js');
const { ChatFormatter } = require('../src/core/engine/chatFormatter.js');
const { TakeoutEngine } = require('../src/core/engine/takeoutEngine.js');
const zipBombGuard = require('../src/core/engine/takeout/zipBombGuard.js');
const mediaIndex = require('../src/core/engine/takeout/mediaIndex.js');

const SRC = (p: string) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');

// ---------- P1-102: reserved names checked AFTER extension stripping ----------
test('p1_h - P1-102: con.md is rewritten, not left as a reserved name', () => {
    const out = pathUtils.sanitizeFileName('con.md');
    assert.notStrictEqual(out.toLowerCase(), 'con.md');
    assert.ok(out.endsWith('.md'), `extension preserved, got ${out}`);
});

// ---------- P1-103: COM/LPT 1-99 ----------
test('p1_h - P1-103: COM/LPT 1..99 are reserved', () => {
    for (const name of ['com1', 'com10', 'com99', 'lpt1', 'lpt42', 'lpt99']) {
        const out = pathUtils.sanitizeFileName(name);
        assert.notStrictEqual(out.toLowerCase(), name, `${name} must be rewritten`);
    }
    const out = pathUtils.sanitizeFileName('lpt99.txt');
    assert.notStrictEqual(out.toLowerCase(), 'lpt99.txt');
    assert.ok(out.endsWith('.txt'));
});

// ---------- P1-104: truncate by code point, not UTF-16 unit ----------
test('p1_h - P1-104: long emoji names truncate without lone surrogates', () => {
    const out = pathUtils.sanitizeFileName('😀'.repeat(100));
    assert.strictEqual([...out].length, 70);
    for (const ch of out) {
        const cp = ch.codePointAt(0)!;
        assert.ok(!(cp >= 0xd800 && cp <= 0xdfff), 'lone surrogate found');
    }
});

// ---------- P1-105: extension traversal sanitized ----------
test('p1_h - P1-105: buildExportFileName strips path traversal from extension', () => {
    const out = pathUtils.buildExportFileName('title', 'c_123', '../../etc/passwd');
    assert.ok(!out.includes('/') && !out.includes('..'), `got ${out}`);
    assert.ok(out.length > 0);
});

// ---------- P1-106: toTimestampMs ----------
test('p1_h - P1-106: toTimestampMs normalizes timestamp shapes', () => {
    const f = titleUtils.toTimestampMs;
    assert.strictEqual(f(3000), 3000, 'number keeps ms contract');
    assert.strictEqual(f('1726358400'), 1726358400000, 'digit string < 1e11 is epoch seconds');
    assert.strictEqual(f('1726358400000'), 1726358400000, 'long digit string is epoch ms');
    assert.strictEqual(f('2024-09-14T00:00:00.000Z'), 1726272000000, 'ISO string');
    assert.strictEqual(f(new Date('2024-09-14T00:00:00.000Z')), 1726272000000, 'Date');
    assert.strictEqual(f('not-a-date'), null);
    assert.strictEqual(f(null), null);
    assert.strictEqual(f(undefined), null);
    assert.strictEqual(f(-5), null);
    assert.strictEqual(f(''), null);
});

// ---------- P1-107: takeout fallback uses the same bar as tier 1 ----------
test('p1_h - P1-107: takeout placeholder titles do not flow back in', () => {
    const bad = titleUtils.resolveTitle({ id: 'c_1', titles: { takeout: 'Google Gemini' } });
    assert.strictEqual(bad.source, 'default', `placeholder must not resolve as takeout, got ${bad.source}`);
    const good = titleUtils.resolveTitle({ id: 'c_1', titles: { takeout: 'Weekend hiking plan' } });
    assert.strictEqual(good.source, 'takeout');
    assert.strictEqual(good.title, 'Weekend hiking plan');
});

// ---------- P1-108: merge timestamps via toTimestampMs ----------
test('p1_h - P1-108: mergeConversation honors digit-string updatedAt', () => {
    const oldC = { id: 'c_1', updatedAt: '2024-01-01T00:00:00.000Z', title: 'Old' };
    const inc = { id: 'c_1', updatedAt: '1726358400000', title: 'New' };
    const r = mergeConversation(oldC, inc);
    assert.ok(r.isChanged, 'newer digit-string timestamp should win');
    const eff = titleUtils.getEffectiveTimestamp(r.merged);
    assert.strictEqual(eff, 1726358400000);
});

// ---------- P1-109: NaN progress ----------
test('p1_h - P1-109: NaN/Infinity pct becomes 0, not NaN', () => {
    assert.strictEqual(progressUtils.formatExportProgress({ pct: NaN }).pct, 0);
    assert.strictEqual(progressUtils.formatExportProgress({ pct: Infinity }).pct, 0);
    assert.strictEqual(progressUtils.formatExportProgress(NaN).pct, 0);
    assert.strictEqual(progressUtils.formatExportProgress({ pct: 42 }).pct, 42);
});

// ---------- P1-110: code spans survive the residual tag strip ----------
test('p1_h - P1-110: fenced/inline code keeps HTML-like content', () => {
    const html = '<pre><code class="language-html">&lt;div&gt;hi&lt;/div&gt;</code></pre>'
        + '<p>real <b>bold</b> text</p>'
        + '<p>sample <code>List&lt;String&gt;</code> and <code>&lt;h1&gt;t&lt;/h1&gt;</code></p>';
    const out = ChatFormatter.convertHtmlToMarkdown(html);
    assert.ok(out.includes('<div>hi</div>'), 'fenced code content must survive');
    assert.ok(out.includes('`List<String>`'), 'inline code generic must survive');
    assert.ok(out.includes('`<h1>t</h1>`'), 'inline code must not be rewritten by heading pass');
    assert.ok(out.includes('**bold**'), 'real bold outside code still converts');
});

// ---------- P1-112: no substring cross-file matching ----------
test('p1_h - P1-112: fallback media never returns an unrelated file via substring', async () => {
    mediaIndex.clearTakeoutData();
    const fakeBytes = new Uint8Array([1, 2, 3]);
    mediaIndex.commitTakeoutData(null, {
        mediaMap: {
            // NOTE: keys are normId-normalized ('c_1' -> '1')
            '1': [{ filename: 'cat-photo.png', fileObj: { async: async () => fakeBytes } }]
        },
        globalMedia: {},
        convCache: {}
    });
    // 'sunset-cat-photo' merely CONTAINS 'cat-photo' — must not match.
    const hit = await mediaIndex.getTakeoutFallbackMedia('c_1', 'sunset-cat-photo.png');
    assert.strictEqual(hit, null, 'substring match must not return another file\'s bytes');
    // Exact stem still matches.
    const exact = await mediaIndex.getTakeoutFallbackMedia('c_1', 'cat-photo.png');
    assert.ok(exact && exact.length === 3, 'exact match must still work');
    mediaIndex.clearTakeoutData();
});

// ---------- P1-113: slot isolation ----------
test('p1_h - P1-113: unknown slot never falls back to another slot\'s data', () => {
    mediaIndex.clearTakeoutData();
    mediaIndex.commitTakeoutData(null, {
        mediaMap: { '9': [{ filename: 'secret.png', fileObj: {} }] },
        globalMedia: {},
        convCache: {}
    });
    const store = mediaIndex.getStore('slot-that-never-imported');
    assert.deepStrictEqual(store.mediaMap, {}, 'isolated store must be empty');
    assert.deepStrictEqual(mediaIndex.getTakeoutMediaForChat('c_9', 'slot-that-never-imported'), [],
        'explicit unknown slot must not leak legacy-global media');
    // Legacy path (no slot) still works.
    assert.strictEqual(mediaIndex.getTakeoutMediaForChat('c_9').length, 1);
    mediaIndex.clearTakeoutData();
});

// ---------- P1-114: zip bomb guards fail closed ----------
test('p1_h - P1-114: zip guards fail closed on unknown size', () => {
    assert.throws(() => zipBombGuard.validateZipFile(undefined), /无法确认/);
    assert.throws(() => zipBombGuard.validateZipFile({} as any), /无法确认/);
    assert.throws(() => zipBombGuard.validateZipFile({ size: 600 * 1024 * 1024 }), /过大/);
    assert.doesNotThrow(() => zipBombGuard.validateZipFile(Buffer.alloc(10) as any), 'Buffer uses .length');
    assert.throws(
        () => zipBombGuard.validateZipEntries({ files: { 'a.txt': { dir: false } } } as any),
        /无法确认未压缩大小/
    );
    assert.doesNotThrow(
        () => zipBombGuard.validateZipEntries({ files: { 'a.txt': { dir: false, _data: { uncompressedSize: 10 } } } } as any)
    );
});

// ---------- P1-117: C2PA trust marker + date validation ----------
test('p1_h - P1-117: C2PA needs a trust marker and a valid calendar date', () => {
    const f = TakeoutEngine.extractC2PATimestamp;
    const trusted2032 = f('c2pa:claim_generator="Google" date="20321115123000Z"');
    assert.ok(trusted2032 !== null, 'trusted 2032 timestamp must parse');
    assert.strictEqual(new Date(trusted2032).getUTCFullYear(), 2032);
    assert.strictEqual(f('dummy_header_20321115123000Z_dummy_footer'), null,
        'bare digit run with no trust context must be rejected');
    assert.strictEqual(f('c2pa manifest date="20321301123000Z"'), null, 'month 13 is invalid');
    assert.strictEqual(f('xmp:CreateDate="20230230123000Z"'), null, 'Feb 30 is invalid');
    const buf = f(Buffer.from('junk jumb data 20260322143000Z tail'));
    assert.ok(buf !== null, 'Buffer input with jumb marker must parse');
});

// ---------- P1-115: ZipWriter 500MB hard fail ----------
test('p1_h - P1-115: ZipWriter refuses beyond 500MB instead of warning', async () => {
    (globalThis as any).self = (globalThis as any).self || {};
    (globalThis as any).self.JSZip = (globalThis as any).self.JSZip || require('../lib/jszip.min.js');
    const { ZipWriter } = require('../src/core/engine/writers/zipWriter.js');
    const w = new ZipWriter('test');
    assert.throws(
        () => w.writeFile('big.bin', { byteLength: 600 * 1024 * 1024 } as any),
        /500MB/
    );
});

// ---------- P1-116: FsWriter serializes same-path writes ----------
test('p1_h - P1-116: FsWriter serializes concurrent writes to the same path', async () => {
    const { FsWriter } = require('../src/core/engine/writers/fsWriter.js');
    const events: string[] = [];
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    // Tag writables by creation order to observe interleaving.
    let n = 0;
    const dirHandle2: any = {
        getDirectoryHandle: async () => dirHandle2,
        getFileHandle: async (_name: string, _opts: any) => ({
            createWritable: async () => {
                const tag = `w${++n}`;
                return {
                    write: async () => { events.push(`${tag}:start`); await delay(30); events.push(`${tag}:end`); },
                    close: async () => {}
                };
            }
        })
    };
    const w = new FsWriter(dirHandle2, 'batch');
    await Promise.all([w.writeFile('', 'same.txt', 'aaa'), w.writeFile('', 'same.txt', 'bbb')]);
    const i0s = events.indexOf('w1:start'), i0e = events.indexOf('w1:end');
    const i1s = events.indexOf('w2:start'), i1e = events.indexOf('w2:end');
    assert.ok(i0s !== -1 && i1s !== -1, `both writes ran: ${events.join(',')}`);
    const interleaved = (i0s < i1s && i1s < i0e) || (i1s < i0s && i0s < i1e);
    assert.ok(!interleaved, `same-path writes must serialize, got ${events.join(',')}`);
});

// ---------- P1-118: CSS.escape ----------
test('p1_h - P1-118: listView escapes dynamic ids in selectors', () => {
    const src = SRC('ui/views/listView.ts');
    assert.ok(src.includes('CSS.escape'), 'updateItemExportStatus must use CSS.escape');
});

// ---------- P1-119: dirHandleController ----------
test('p1_h - P1-119: restore never calls requestPermission without a gesture', async () => {
    const dh = require('../src/ui/controllers/dirHandleController.js');
    let requested = false;
    const fakeHandle = {
        queryPermission: async () => 'prompt',
        requestPermission: async () => { requested = true; return 'granted'; },
        keys: async function* () {}
    };
    const ok = await dh.verifyDirPermission(fakeHandle);
    assert.strictEqual(ok, false, 'prompt permission is not granted');
    assert.strictEqual(requested, false, 'requestPermission must not fire without user activation');
});
test('p1_h - P1-119: stored handle is only dropped on confirmed NotFoundError', () => {
    const src = SRC('ui/controllers/dirHandleController.ts');
    assert.ok(src.includes('r.notFound'), 'restore must gate handle deletion on notFound');
    assert.ok(src.includes('userActivation'), 'requestPermission gated on user activation');
});

// ---------- P1-120/121/122: options UI glue ----------
test('p1_h - P1-120: takeout file input is reset after import', () => {
    const src = SRC('ui/options/modules/optionsTakeout.ts');
    assert.ok(src.includes('input.value = '), 'input must be cleared so the same zip can be re-picked');
});
test('p1_h - P1-121: loadStore failure reaches the UI log', () => {
    const src = SRC('ui/options/modules/optionsInit.ts');
    assert.ok(/loadStore error[\s\S]{0,400}log\(/.test(src), 'catch must call log()');
    assert.ok(src.includes("'error'"), 'logged at error level');
});
test('p1_h - P1-122: initWorkbench boot is catch-guarded on both paths', () => {
    const src = SRC('ui/options/options.ts');
    assert.ok(src.includes('startWorkbench'), 'guarded starter exists');
    assert.ok(src.includes(".catch("), 'startup promise has .catch');
    assert.ok(src.includes("addEventListener('DOMContentLoaded', startWorkbench)"), 'DOMContentLoaded path wrapped');
});

// ---------- P1-123: popup ----------
test('p1_h - P1-123: popup language switch re-applies i18n + toggle UI + count', () => {
    const src = SRC('ui/popup/popup.ts');
    assert.ok(src.includes('i18n.applyI18n()'), 'explicit applyI18n on language change');
    assert.ok(src.includes('applyLangToggleUI()'), 'toggle UI refreshed');
    assert.ok(src.includes('await updateCount()'), 'count refreshed');
});
test('p1_h - P1-123: export-current-page has a re-entrancy guard released in finally', () => {
    const src = SRC('ui/popup/popup.ts');
    assert.ok(src.includes('__exportingCurrentPage'), 'guard variable exists');
    assert.ok(/finally\s*\{\s*__releaseExportGuard\(\);/.test(src), 'guard released when the async callback ends');
});

// ---------- P1-124/125: export progress timer generation ----------
test('p1_h - P1-124: progress hide timer is generation-guarded', () => {
    const src = SRC('ui/options/modules/optionsExport.ts');
    assert.ok(src.includes('__exportGen'), 'generation counter exists');
    assert.ok(/__timerGen !== __exportGen/.test(src), 'stale timer bails when a newer export started');
});

// ---------- P1-126: geminiClient protocol comments ----------
test('p1_h - P1-126: JSPB layouts and request/parser sync rule are documented', () => {
    const src = SRC('core/api/geminiClient.ts');
    assert.ok(src.includes('P1-126'), 'P1-126 marker present');
    assert.ok(/request.*parser|parser.*request/i.test(src), 'sync maintenance rule documented');
});
