import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesCandidateBody } from '../src/l1/parsers/gemini/rpc/structuredBodyMatch.js';
import { decodeGeminiStructuredPayload } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import { parseRemainingFixture } from './helpers/geminiRemainingRecovery.js';
import type { GeminiStructuredDocument } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import { citationText, coverageWire } from './fixtures/providers/gemini/detail/content.js';
import { fixtureAccount } from './helpers/domainFixture.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';

const paragraph = (text: string): GeminiStructuredDocument => ({ children: [{ nodeType: 18, text }] });

test('provider interaction markup uses the same body cleanup for alternative selection and export', () => {
    for (const markup of [
        '<FollowUp label="Next" query="Explain more"/>',
        '<ElicitationsGroup message="Explore"><Elicitation label="Next" query="More"/></ElicitationsGroup>',
        '<FollowUp>Next question</FollowUp>',
        '<GenerateWidget id="fixture"/>',
    ]) for (const selected of [0, 1]) {
        const branches = ['Other body.', 'Other body.'];
        branches[selected] = 'Selected body.';
        const raw = branches.map(body => [[citationText(body)]]);
        const wire = coverageWire(raw, [['rc_primary', [['Selected body.\n\n' + markup]]]]);
        const result = mergeConversationPages([parseGeminiRpcConversation(wire, {
            account: fixtureAccount('gemini'), providerId: 'gemini',
        })], undefined, true);
        assert.equal(result.conversation.detail.quality.status, 'complete', markup);
        assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.severity === 'warning'));
        assert.equal(JSON.stringify(result.conversation.detail.messages).includes('Other body.'), false);
        assert.equal(JSON.stringify(result.conversation.detail.messages).includes('Selected body.'), true);
    }
});

test('interaction cleanup cannot erase code literals, unknown HTML or a different body', () => {
    assert.equal(matchesCandidateBody(paragraph('Selected body.'), 'Different body.\n\n<FollowUp query="Selected body."/>'), false);
    for (const markup of ['<UnknownWidget/>', '<FollowUp-extension/>', '<aside>Visible content</aside>', '\\<FollowUp query="literal"/>']) {
        assert.equal(matchesCandidateBody(paragraph('Selected body.'), 'Selected body.\n\n' + markup), false);
    }
    const inline: GeminiStructuredDocument = { children: [{ nodeType: 18, text: '<FollowUp/>',
        annotations: [{ start: 0, end: 11, type: 7 }] }] };
    assert.equal(matchesCandidateBody(inline, '`<FollowUp/>`\n\n<FollowUp query="Next"/>'), true);
    assert.equal(matchesCandidateBody(paragraph('Selected body.'), 'Selected body.\n\n```xml\n<FollowUp/>\n```'), false);
});

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

test('composite inline fragments do not introduce spaces at citation and punctuation boundaries', () => {
    const composite: GeminiStructuredDocument = { children: [{ nodeType: 'paragraph', children: [
        { nodeType: 18, text: '引言' }, { nodeType: 'citationGroup', children: [
            { nodeType: 'citation', number: 1, title: 'Fixture source', url: 'https://example.com/source' },
        ] }, { nodeType: 18, text: '：尾巴' },
    ] }] };
    assert.equal(matchesCandidateBody(composite, '引言[cite: 1]：尾巴'), true);
    assert.equal(matchesCandidateBody(composite, '引言 ：尾巴'), false);
    const table: GeminiStructuredDocument = { children: [{ nodeType: 17, rows: [{ cells: [
        { children: [{ nodeType: 18, text: '词' }, { nodeType: 18, text: '：尾巴' }] },
    ] }] }] };
    assert.equal(matchesCandidateBody(table, '| 词：尾巴 |\n| --- |'), true);
});

test('block boundaries remain distinct while composite code fragments preserve exact content', () => {
    const separate: GeminiStructuredDocument = { children: [{ nodeType: 18, text: 'first' }, { nodeType: 18, text: 'second' }] };
    assert.equal(matchesCandidateBody(separate, 'first second'), true);
    assert.equal(matchesCandidateBody(separate, 'firstsecond'), false);
    const composite: GeminiStructuredDocument = { children: [{ nodeType: 'paragraph', children: [
        { nodeType: 18, text: 'first ' }, { nodeType: 18, text: 'a  b', annotations: [{ start: 0, end: 4, type: 7 }] },
        { nodeType: 18, text: ' second' },
    ] }] };
    assert.equal(matchesCandidateBody(composite, 'first `a  b` second'), true);
    assert.equal(matchesCandidateBody(composite, 'first `a b` second'), false);
});

test('opaque unbound citation identities survive normalized document roundtrip', () => {
    for (const id of ['cit_fixture', 'sp_fixture', '0']) {
        const doc = { children: [{ nodeType: 18, text: 'body', annotations: [{ start: 0, end: 0, type: 'source', sourceIds: [id] }] }] };
        assert.deepEqual(decodeGeminiStructuredPayload(doc), doc);
    }
});
