import { fixtureAccount } from './helpers/domainFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeGeminiAnnotation, decodeGeminiStructuredPayload, inspectStructuredContent } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { parseGeminiBody } from '../src/l1/parsers/gemini/shared/contentAdapter.js';
import type { Diagnostic } from '../src/shared/diagnostics/diagnostic.js';

// Captured Tier 2 report, 2026-10-15. Only turn[3][12], no account/transport metadata.
const report: unknown = JSON.parse(readFileSync('tests/fixtures/provider/structured_rpc/live-range-coder.json', 'utf8'));
const fallback = 'MARKDOWN_FALLBACK_SENTINEL';
const textNode = (text: string, flag: number): unknown[] => [null, [null, 0, text, [[0, text.length, [[null, null, null, null, flag]]]]]];
function wire(raw: unknown, candidates: unknown[] = [['rc_answer', [[fallback]]]]): string {
    const payload: unknown[] = [candidates];
    if (raw !== undefined) payload[12] = raw;
    return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[[['c_coverage', 'r_coverage'], [1700000000, 0], [['Question']], payload]]])]]);
}
const parse = (raw: unknown) => parseGeminiRpcConversation(wire(raw), { account: fixtureAccount('gemini'), providerId: 'gemini' });

test('captured long report uses structured data through native RPC, not equivalent Markdown fallback', () => {
    const result = parse(report);
    const answer = result.conversation.detail.messages.find(message => message.role === 'assistant');
    assert.ok(answer);
    const serialized = JSON.stringify(answer.content);
    assert.ok(!serialized.includes(fallback));
    assert.ok(serialized.includes('fractions.Fraction'));
    assert.ok(serialized.includes('"type":"inlineCode","code":"run_length"'));
    assert.ok(serialized.includes('run\\\\_length'), 'corrected structured math source survives');
    assert.ok(answer.content.some(block => block.type === 'list'));
    assert.ok(answer.content.some(block => block.type === 'math'));
    assert.ok(answer.content.some(block => block.type === 'code'));
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
});

test('wire style 3 means inline code, independently of content and container', () => {
    for (const source of ['fractions.Fraction', '范围_😀', 'a*b $c$ \\literal']) {
        assert.deepEqual(decodeGeminiAnnotation([0, source.length, [[null, null, null, null, 3]]]), { start: 0, end: source.length, type: 7 });
        const leaf = textNode(source, 3);
        for (const node of [leaf,
            Object.assign(Array(12).fill(null), { 11: [[[[leaf]]]] }),
            Object.assign(Array(13).fill(null), { 12: [[[[leaf]]], 4] }),
            Object.assign(Array(11).fill(null), { 10: [[[null, [[[leaf]]]]]] }),
        ]) {
            const decoded = decodeGeminiStructuredPayload([[[node]]]);
            assert.ok(decoded);
            const content = parseGeminiBody(fallback, decoded);
            assert.ok(JSON.stringify(content).includes(JSON.stringify({ type: 'inlineCode', code: source })));
            assert.ok(!JSON.stringify(content).includes(fallback));
        }
    }
});

test('unknown nested annotation rejects whole document and reports only shape evidence', () => {
    const leaf = textNode('PRIVATE_SOURCE_TEXT', 999);
    const list = Object.assign(Array(12).fill(null), { 11: [[[[leaf]]]] });
    const result = parse([[[textNode('known', 3), list]]]);
    assert.ok(JSON.stringify(result.conversation.detail.messages[1].content).includes(fallback));
    const diagnostic = result.diagnostics.find(d => d.code === 'GEMINI_STRUCTURED_FALLBACK');
    assert.equal(diagnostic?.severity, 'warning');
    assert.deepEqual(diagnostic?.details, { reason: 'decode_rejected', issue: { kind: 'annotation', styleFlag: 999 } });
    assert.ok(diagnostic?.sourceRef?.providerMessageId);
    assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE_SOURCE_TEXT'));
});

test('unknown wire fields, absent payload, and uncorrelated candidate have distinct outcomes', () => {
    const unknown = Object.assign(Array(14).fill(null), { 13: ['PRIVATE_FILE_REFERENCE'] });
    assert.deepEqual(inspectStructuredContent(null, { structuredContent: [[[unknown]]] }), {
        status: 'decode_rejected', issue: { kind: 'node', fields: [13] },
    });
    const missing = parse(undefined).diagnostics.find(d => d.code === 'GEMINI_STRUCTURED_FALLBACK');
    assert.deepEqual(missing?.details, { reason: 'missing' });
    assert.equal(missing?.severity, 'info');
    const turn: unknown[] = [null, null, null, Object.assign(Array(13).fill(null), { 12: report })];
    assert.equal(inspectStructuredContent(turn, undefined, 1).status, 'candidate_unmatched');
    assert.equal(inspectStructuredContent(turn, undefined, 0).status, 'decoded');
    assert.equal(inspectStructuredContent(turn, { structuredContent: { children: [] } }, 1).status, 'decoded');
});

test('adapter rejection remains visible and preserves complete Markdown body', () => {
    const diagnostics: Diagnostic[] = [];
    const malformed = { children: [{ nodeType: 18, text: 'abc', annotations: [{ start: 0, end: 99, type: 7 }] }] };
    const content = parseGeminiBody(fallback, malformed, { diagnostics, sourceRef: { providerId: 'gemini', providerMessageId: 'rc_bad' } });
    assert.ok(JSON.stringify(content).includes(fallback));
    assert.deepEqual(diagnostics[0].details, { reason: 'adapter_rejected' });
    assert.equal(diagnostics[0].sourceRef?.providerMessageId, 'rc_bad');
});


test('captured Imagen envelope retains resource panels and closes exactly one native image asset', () => {
    const panel: unknown = JSON.parse(readFileSync('tests/fixtures/provider/structured_rpc/live-imagen-panel.json', 'utf8'));
    const decoded = decodeGeminiStructuredPayload(panel);
    assert.ok(decoded);
    assert.equal(decoded.children.length, 1);
    assert.equal(decoded.children[0].nodeType, 0);
    assert.ok(JSON.stringify(decoded).includes('generatedImagePayload'), 'resource evidence is retained, not dropped');
    const result = parseGeminiRpcConversation(wire(panel, [['rc_image', [['\n']]]]), { account: fixtureAccount('gemini'), providerId: 'gemini' });
    assert.equal(result.conversation.detail.assets.length, 1);
    assert.equal(result.conversation.detail.assets[0].kind, 'image');
    assert.equal(result.conversation.detail.assets[0].name, 'fixture.jpg');
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
    assert.ok(!JSON.stringify(result.conversation.detail.messages[1].content).includes('fixture metadata'));
});

test('unproven Imagen envelopes and incomplete/ambiguous panels still reject', () => {
    const panel = JSON.parse(readFileSync('tests/fixtures/provider/structured_rpc/live-imagen-panel.json', 'utf8')) as unknown[][];
    panel[1] = ['unrecognized metadata'];
    assert.equal(decodeGeminiStructuredPayload(panel), null);
    const node: unknown[] = Array(10).fill(null);
    node[9] = [[[[], ['http://googleusercontent.com/image_generation_content/0_fixture']]]];
    assert.equal(decodeGeminiStructuredPayload([[[node]]]), null, 'no inferred image without a proven image file');
    const valid = JSON.parse(readFileSync('tests/fixtures/provider/structured_rpc/live-imagen-panel.json', 'utf8'));
    valid[0][0][0][8] = 'unknown body';
    assert.equal(decodeGeminiStructuredPayload(valid), null, 'do not hide another populated wire field');
});
