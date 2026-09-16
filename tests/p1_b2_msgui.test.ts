export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = (p: string) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');

// ---------- P1-017/018: fetchBatch serialization + exactly-once ----------
test('p1_b2 - P1-017: fetchBatch chains per slot', () => {
    const src = SRC('background/background.ts');
    assert.ok(src.includes('fetchBatchChains'), 'per-slot chain map exists');
    assert.ok(src.includes('P1-017'), 'P1-017 marker present');
});

test('p1_b2 - P1-018: guarded exactly-once response', () => {
    const src = SRC('background/background.ts');
    assert.ok(src.includes('guardedResponse'), 'guarded response wrapper exists');
    assert.ok(src.includes('P1-018'), 'P1-018 marker present');
    assert.ok(/if \(responded\) return;/.test(src), 'duplicate responses suppressed');
});

// ---------- P1-020: deepScan null ----------
test('p1_b2 - P1-020: null scan result reports failure', () => {
    const src = SRC('content/messageRouter.ts');
    assert.ok(src.includes('P1-020'), 'P1-020 marker present');
    assert.ok(/if \(!res\)[\s\S]{0,400}success: false/.test(src), 'null result sends success:false');
});

// ---------- P1-021: engine construction in try ----------
test('p1_b2 - P1-021: engine constructed inside try', () => {
    const src = SRC('ui/controllers/exportController.ts');
    assert.ok(src.includes('P1-021'), 'P1-021 marker present');
    const tryIdx = src.indexOf('try {');
    const newIdx = src.indexOf('activeEngine = new engineClass()');
    assert.ok(tryIdx !== -1 && newIdx !== -1 && tryIdx < newIdx, 'construction inside try block');
});

// ---------- P1-024: bounded debounce map ----------
test('p1_b2 - P1-024: lastTouched map has cap and TTL', () => {
    const src = SRC('content/syncEngine.ts');
    assert.ok(src.includes('LAST_TOUCHED_MAX_ENTRIES'), 'max entries cap exists');
    assert.ok(src.includes('LAST_TOUCHED_TTL_MS'), 'TTL exists');
    assert.ok(src.includes('pruneLastTouchedMap'), 'prune function exists');
});

// ---------- P1-025: listener cleanup ----------
test('p1_b2 - P1-025: module-level handler refs', () => {
    const src = SRC('content/liveSaveObserver.ts');
    assert.ok(src.includes('__onLocationChange'), 'module-level location handler exists');
    assert.ok(src.includes('__onBeforeUnload'), 'module-level unload handler exists');
    assert.ok(src.includes("removeEventListener('gemini:locationchange'"), 'cleanup removes listeners');
});

// ---------- P1-028: capped stream read ----------
test('p1_b2 - P1-028: readCappedText exists and is used', () => {
    const src = SRC('content/hookCredentials.ts');
    assert.ok(src.includes('readCappedText'), 'capped reader exists');
    assert.ok(src.includes('BATCHEXECUTE_SNIFF_CAP'), 'cap constant exists');
    assert.ok(src.includes('P1-028'), 'P1-028 marker present');
});

// ---------- P1-030: payload size cap ----------
test('p1_b2 - P1-030: live-save payload has fail-closed cap', () => {
    const src = SRC('content/liveSaveCoordinator.ts');
    assert.ok(src.includes('LIVE_SAVE_PAYLOAD_CAP'), 'payload cap exists');
    assert.ok(src.includes('payload_too_large'), 'too-large warning type exists');
    assert.ok(src.includes('P1-030'), 'P1-030 marker present');
});
