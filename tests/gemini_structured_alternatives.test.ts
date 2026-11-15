import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGeminiStructuredPayload } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import { parseRemainingFixture } from './helpers/geminiRemainingRecovery.js';

test('parallel documents select either draft by identity and identical text remains unambiguous', () => {
    for (const key of ['G_REMAINING_ALTERNATIVE_FIRST', 'G_REMAINING_ALTERNATIVE_SECOND',
        'G_REMAINING_ALTERNATIVE_DUPLICATE'] as const) {
        const result = parseRemainingFixture(key);
        assert.equal(result.domain.detail.quality.status, 'complete');
        assert.ok(result.markdown.includes('Selected body.'));
        assert.ok(!result.markdown.includes('Other body.'));
        assert.ok(!result.merged.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.severity === 'warning'));
    }
});

test('selected nonprimary document does not inherit the other draft image', () => {
    const result = parseRemainingFixture('G_REMAINING_ALTERNATIVE_RESOURCE');
    assert.equal(result.domain.detail.quality.status, 'complete');
    assert.equal(result.domain.detail.assets.length, 0);
    assert.ok(!result.markdown.includes('image.jpg') && !result.markdown.includes('Other body.'));
});

test('opaque unbound citation identities survive normalized document roundtrip', () => {
    for (const id of ['cit_fixture', 'sp_fixture', '0']) {
        const doc = { children: [{ nodeType: 18, text: 'body', annotations: [{ start: 0, end: 0, type: 'source', sourceIds: [id] }] }] };
        assert.deepEqual(decodeGeminiStructuredPayload(doc), doc);
    }
});
