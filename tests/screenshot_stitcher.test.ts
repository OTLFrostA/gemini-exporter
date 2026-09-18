// tests/screenshot_stitcher.test.ts - Unit tests for long screenshot frame layout & PDF wrapper

import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFrameLayouts } from '../src/core/engine/screenshotStitcher.js';
import { wrapJpegToPdf } from '../src/core/engine/pdfWrapper.js';

test('calculateFrameLayouts: handles empty frames', () => {
    const res = calculateFrameLayouts([], 1000);
    assert.deepStrictEqual(res, []);
});

test('calculateFrameLayouts: calculates single frame correctly', () => {
    const frames = [{ scrollTop: 0, viewportHeight: 800 }];
    const res = calculateFrameLayouts(frames, 800);
    assert.strictEqual(res.length, 1);
    assert.deepStrictEqual(res[0], {
        sourceY: 0,
        sourceHeight: 800,
        destY: 0,
        destHeight: 800
    });
});

test('calculateFrameLayouts: calculates multi-frame non-overlapping slices with overlap elimination', () => {
    // 3 frames with 20% overlap
    // Total height: 2000
    // Frame 0: scroll 0, height 800 (paints 0 -> 800)
    // Frame 1: scroll 650, height 800 (overlaps by 800 - 650 = 150; paints 800 -> 1450)
    // Frame 2: scroll 1300, height 800 (overlaps by 1450 - 1300 = 150; paints 1450 -> 2000 clamped)
    const frames = [
        { scrollTop: 0, viewportHeight: 800 },
        { scrollTop: 650, viewportHeight: 800 },
        { scrollTop: 1300, viewportHeight: 800 }
    ];
    const layouts = calculateFrameLayouts(frames, 2000);

    assert.strictEqual(layouts.length, 3);

    // Frame 0
    assert.strictEqual(layouts[0].destY, 0);
    assert.strictEqual(layouts[0].sourceY, 0);
    assert.strictEqual(layouts[0].destHeight, 800);

    // Frame 1: source starts at overlap (150), dest starts at 800, height is 650
    assert.strictEqual(layouts[1].destY, 800);
    assert.strictEqual(layouts[1].sourceY, 150);
    assert.strictEqual(layouts[1].destHeight, 650);

    // Frame 2: dest starts at 1450, source starts at 150, clamped to 2000 total (550 height)
    assert.strictEqual(layouts[2].destY, 1450);
    assert.strictEqual(layouts[2].sourceY, 150);
    assert.strictEqual(layouts[2].destHeight, 550);

    // Total painted height must exactly equal 2000
    const totalPainted = layouts.reduce((sum, l) => sum + l.destHeight, 0);
    assert.strictEqual(totalPainted, 2000);
});

test('calculateFrameLayouts: drops redundant fully-overlapped frame', () => {
    const frames = [
        { scrollTop: 0, viewportHeight: 1000 },
        { scrollTop: 200, viewportHeight: 500 }, // completely within 0..1000
        { scrollTop: 800, viewportHeight: 800 }
    ];
    const layouts = calculateFrameLayouts(frames, 1600);
    assert.strictEqual(layouts.length, 2);
    assert.strictEqual(layouts[0].destY, 0);
    assert.strictEqual(layouts[1].destY, 1000);
});

test('wrapJpegToPdf: generates valid PDF 1.4 binary structure', async () => {
    const mockJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
    const pdfBlob = wrapJpegToPdf(mockJpeg, 1000, 2000);

    assert.strictEqual(pdfBlob.type, 'application/pdf');
    assert.ok(pdfBlob.size > mockJpeg.byteLength);

    const buf = await pdfBlob.arrayBuffer();
    const text = new TextDecoder().decode(buf);

    assert.ok(text.startsWith('%PDF-1.4'));
    assert.ok(text.includes('/Type /Catalog'));
    assert.ok(text.includes('/Type /Page'));
    assert.ok(text.includes('/Filter /DCTDecode'));
    assert.ok(text.includes('/MediaBox [0 0 750 1500]')); // 1000 * 0.75, 2000 * 0.75
    assert.ok(text.includes('%%EOF'));
});
