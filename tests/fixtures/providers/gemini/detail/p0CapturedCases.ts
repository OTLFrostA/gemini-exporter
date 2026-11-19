import assert from 'node:assert/strict';
import corpusJson from '../captured/p0_golden_rpc_corpus.json';
import { captured, describeFixtures } from '../../provenance.js';

const CORPUS_REL = 'tests/fixtures/providers/gemini/captured/p0_golden_rpc_corpus.json';

const captures: Readonly<Record<string, { readonly wire: string }>> = corpusJson.captures;

function readCapture(key: string): string {
    const entry = captures[key];
    if (!entry) throw new Error(`Missing P0 captured fixture key: ${key}`);
    return entry.wire;
}

export const p0CapturedCases = {
    'G_P0_CAPTURED_IMAGEN_01': () => readCapture('G_P0_CAPTURED_IMAGEN_01'),
    'G_P0_CAPTURED_PYTHON_CODE_01': () => readCapture('G_P0_CAPTURED_PYTHON_CODE_01'),
    'G_P0_CAPTURED_USER_FILE_01': () => readCapture('G_P0_CAPTURED_USER_FILE_01'),
    'G_P0_CAPTURED_MULTIMODAL_BRAGG_01': () => readCapture('G_P0_CAPTURED_MULTIMODAL_BRAGG_01'),
    'G_P0_CAPTURED_QUANTUM_TABLE_01': () => readCapture('G_P0_CAPTURED_QUANTUM_TABLE_01'),
    'G_P0_CAPTURED_WEB_CITATIONS_01': () => readCapture('G_P0_CAPTURED_WEB_CITATIONS_01'),
};

export const fixtureOrigins = describeFixtures(
    p0CapturedCases,
    captured(CORPUS_REL, 'Full multi-frame Gemini batchexecute (MaZiqc + hNvQHb) HTTP response with signed media tokens scrubbed.'),
);

export const inlineHtmlFallback = {
    conversationId: '1cea7e48cc166b57',
    literal: '<strong>bold</strong>',
    wire(): string {
        const frames = p0CapturedCases.G_P0_CAPTURED_PYTHON_CODE_01().split('\n');
        const detailFrame = frames.findIndex(line => line.startsWith('[["wrb.fr","hNvQHb",'));
        assert.ok(detailFrame > 0);
        const rows = JSON.parse(frames[detailFrame]);
        const detail = JSON.parse(rows[0][2]);
        const model = detail[0][0][3];
        model[0][0][1][0] = 'Use `' + this.literal + '` here.\n\n```html\n' + this.literal + '\n```';
        model[12] = null;
        rows[0][2] = JSON.stringify(detail);
        frames[detailFrame] = JSON.stringify(rows);
        frames[detailFrame - 1] = String(frames[detailFrame].length);
        return frames.join('\n');
    },
};
