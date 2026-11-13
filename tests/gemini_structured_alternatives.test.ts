import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesCandidateBody } from '../src/l1/parsers/gemini/rpc/structuredBodyMatch.js';
import { decodeGeminiStructuredPayload } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import { parseRemainingFixture } from './helpers/geminiRemainingRecovery.js';
import type { GeminiStructuredDocument } from '../src/l1/parsers/gemini/rpc/structuredContent.js';

const paragraph = (text: string): GeminiStructuredDocument => ({ children: [{ nodeType: 18, text }] });

test('alternative matching preserves punctuation and literal formatting characters', () => {
    assert.equal(matchesCandidateBody(paragraph('Selected body.'), '**Selected** body.'), true);
    assert.equal(matchesCandidateBody(paragraph('a * b'), 'a b'), false);
    assert.equal(matchesCandidateBody(paragraph('a_b'), 'ab'), false);
    assert.equal(matchesCandidateBody(paragraph('a # b'), 'a b'), false);
    assert.equal(matchesCandidateBody(paragraph('a — b'), 'a - b'), false);
    assert.equal(matchesCandidateBody(paragraph('price $12.50 and $20'), 'price $12.50 and $20'), true);
    assert.equal(matchesCandidateBody(paragraph('body\u0000inline:x\u0000'), 'body x'), false);
});

test('alternative matching preserves fenced and inline code whitespace', () => {
    const code: GeminiStructuredDocument = { children: [{ nodeType: 1, info: 'python', code: 'if ok:\n    run()\n' }] };
    assert.equal(matchesCandidateBody(code, '```python\nif ok:\n    run()\n```'), true);
    assert.equal(matchesCandidateBody(code, '```python\nif ok:\nrun()\n```'), false);
    assert.equal(matchesCandidateBody(code, '```python\nif ok:\n  run()\n```'), false);
    const inline: GeminiStructuredDocument = { children: [{ nodeType: 18, text: 'a  b', annotations: [{ start: 0, end: 4, type: 7 }] }] };
    assert.equal(matchesCandidateBody(inline, '`a  b`'), true);
    assert.equal(matchesCandidateBody(inline, '`a b`'), false);
    const escaped = 'print("\\u0000")';
    assert.equal(matchesCandidateBody({ children: [{ nodeType: 1, info: 'python', code: escaped + '\n' }] },
        '```python\n' + escaped + '\n```'), true);
});

test('literal CJK emphasis markers need independent native formatting evidence', () => {
    const markdown = '推荐**“示例”**方案';
    assert.equal(matchesCandidateBody(paragraph('推荐“示例”方案'), markdown), false);
    assert.equal(matchesCandidateBody({ children: [{ nodeType: 18, text: '推荐“示例”方案',
        annotations: [{ start: 2, end: 6, type: 0 }] }] }, markdown), true);
    assert.equal(matchesCandidateBody({ children: [{ nodeType: 18, text: '推荐“示例”方案',
        annotations: [{ start: 2, end: 6, type: 0 }] }] }, '推荐\\*\\*“示例”\\*\\*方案'), false);
    assert.equal(matchesCandidateBody({ children: [{ nodeType: 18, text: '推荐“示例”方案',
        annotations: [{ start: 2, end: 6, type: 0 }] }] }, '推荐&#42;&#42;“示例”&#42;&#42;方案'), false);
});

test('unique matching can select either branch and duplicate matches remain incomplete', () => {
    for (const key of ['G_REMAINING_ALTERNATIVE_FIRST', 'G_REMAINING_ALTERNATIVE_SECOND'] as const) {
        const result = parseRemainingFixture(key);
        assert.equal(result.domain.detail.quality.status, 'complete');
        assert.ok(result.markdown.includes('Selected body.'));
        assert.ok(!result.markdown.includes('Other body.'));
    }
    const duplicate = parseRemainingFixture('G_REMAINING_ALTERNATIVE_DUPLICATE');
    assert.equal(duplicate.domain.detail.quality.status, 'partial');
    assert.ok(duplicate.merged.evidence?.unrepresentedContent);
    assert.ok(duplicate.merged.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.severity === 'warning'));
});

test('selected alternative does not inherit the other body image', () => {
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
