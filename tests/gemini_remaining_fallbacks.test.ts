import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemainingFixture } from './helpers/geminiRemainingRecovery.js';
import { invalidSourceRangeNodes, legalSourceRangeControls } from './fixtures/providers/gemini/detail/remainingSourceRanges.js';
import { convertGeminiInlines } from '../src/l1/parsers/gemini/shared/structuredContentAdapter.js';
import { assertDomainClosure } from '../src/l2/closure.js';
import type { InlineNode } from '../src/l2/content/inline.js';

test('recognizing a card must not discard an unknown nonempty sibling branch', () => {
    for (const key of ['G_REMAINING_PLAN_UNKNOWN_SIBLING', 'G_REMAINING_DOCUMENT_UNKNOWN_SIBLING',
        'G_REMAINING_MAP_UNKNOWN_SIBLING'] as const) {
        const result = parseRemainingFixture(key);
        assert.ok(result.merged.evidence?.unrepresentedContent, key);
        assert.equal(result.domain.detail.quality.status, 'partial', key);
        assert.ok(result.markdown.includes('Before card.') && result.markdown.includes('After card.'), key);
    }
});

test('unbound source identities preserve native text without inventing citations', () => {
    for (const key of ['G_REMAINING_ANNOTATION_NESTED', 'G_REMAINING_ANNOTATION_DIRECT',
        'G_REMAINING_ANNOTATION_ZERO'] as const) {
        const result = parseRemainingFixture(key);
        assertDomainClosure(result.domain.detail);
        assert.equal(result.domain.detail.quality.status, 'partial', key);
        assert.ok(result.merged.evidence?.unrepresentedContent, key);
        assert.ok(result.markdown.includes('Fixture reference'), key);
        assert.ok(!result.markdown.includes('Fallback body remains available.'), key);
        assert.equal(result.domain.detail.messages.flatMap(message => message.citations ?? []).length, 0, key);
        assert.ok(result.merged.diagnostics.some(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK'), key);
    }
});

test('unmatched alternative bodies retain fallback without concatenating branches', () => {
    for (const key of ['G_REMAINING_BODY_SEQUENCES', 'G_REMAINING_BODY_SEQUENCES_LIST'] as const) {
        const result = parseRemainingFixture(key);
        assertDomainClosure(result.domain.detail);
        assert.equal(result.domain.detail.quality.status, 'partial', key);
        assert.ok(result.merged.evidence?.unrepresentedContent, key);
        assert.ok(result.markdown.includes('Fallback body remains available.'), key);
        assert.ok(!result.markdown.includes('First body.') && !result.markdown.includes('Second body.'), key);
    }
});

const sources = new Map([1, 2, 3, 4].map(n => [`spp_fixture_${n}`, [{ id: `source-${n}`, url: `https://example.com/source-${n}` }]]));
function textOf(nodes: InlineNode[]): string {
    return nodes.map(node => {
        if (node.type === 'text') return node.text;
        if (node.type === 'inlineCode') return node.code;
        if (node.type === 'inlineMath') return node.source;
        if (node.type === 'lineBreak') return '\n';
        return 'children' in node ? textOf(node.children) : '';
    }).join('');
}
function descendants(nodes: InlineNode[]): InlineNode[] {
    return nodes.flatMap(node => [node, ...('children' in node ? descendants(node.children) : [])]);
}
function citationPositions(nodes: InlineNode[]): Array<{ id: string; offset: number }> {
    let offset = 0;
    const positions: Array<{ id: string; offset: number }> = [];
    const visit = (children: InlineNode[]): void => {
        for (const node of children) {
            if (node.type === 'citationRef') positions.push({ id: node.citationId, offset });
            else if ('children' in node) visit(node.children);
            else offset += textOf([node]).length;
        }
    };
    visit(nodes);
    return positions;
}

test('all 43 diagnostic overflow snippets reject unsupported coordinates without mutation', () => {
    assert.equal(invalidSourceRangeNodes.length, 43);
    const before = JSON.stringify(invalidSourceRangeNodes);
    const excesses = new Set<number>();
    for (const node of invalidSourceRangeNodes) {
        const invalid = node.annotations.filter(a => a.type === 'source' && a.end > node.text.length);
        assert.equal(invalid.length, 1);
        excesses.add(invalid[0].end - node.text.length);
        assert.ok(node.annotations.some(a => a.type === 7));
        assert.equal(convertGeminiInlines(node.text, node.annotations, sources), null);
    }
    assert.deepEqual([...excesses].sort(), [1, 2]);
    assert.equal(JSON.stringify(invalidSourceRangeNodes), before);
});

test('all five legal +2 source/code endpoint controls retain text, code and source identity', () => {
    assert.equal(legalSourceRangeControls.length, 5);
    // Authored output positions. In the fifth snippet, source end 11 is inside
    // a second code span [10, 13); its reference must follow that atomic span.
    const expectedPositions = [
        [{ id: 'source-1', offset: 32 }],
        [{ id: 'source-1', offset: 14 }, { id: 'source-2', offset: 87 }, { id: 'source-3', offset: 194 }],
        [{ id: 'source-1', offset: 14 }, { id: 'source-2', offset: 58 }],
        [{ id: 'source-1', offset: 14 }, { id: 'source-2', offset: 63 }],
        [{ id: 'source-1', offset: 13 }],
    ];
    for (const [index, node] of legalSourceRangeControls.entries()) {
        const result = convertGeminiInlines(node.text, node.annotations, sources);
        assert.ok(result);
        assert.equal(textOf(result), node.text);
        assert.deepEqual(citationPositions(result), expectedPositions[index]);
        for (const annotation of node.annotations) {
            if (annotation.type !== 'source') continue;
            const referenceIds = new Set(annotation.sourceIds.flatMap(id => sources.get(id)?.map(source => source.id) ?? []));
            assert.ok(descendants(result).some(inline => inline.type === 'citationRef' && referenceIds.has(inline.citationId)));
        }
        for (const code of node.annotations.filter(a => a.type === 7)) {
            assert.ok(descendants(result).some(inline => inline.type === 'inlineCode' && inline.code === node.text.slice(code.start, code.end)));
        }
    }
});

test('range validation distinguishes ASCII, CJK and surrogate pairs without changing endpoints', () => {
    for (const text of ['code xy', '中文代码尾巴', '😀code尾巴']) {
        const start = text.startsWith('😀') ? 2 : 0;
        const codeEnd = text.length - 2;
        const code = { start, end: codeEnd, type: 7 } as const;
        const citation = { start, end: text.length, type: 'source', sourceIds: ['spp_fixture_1'] } as const;
        const annotations = [code, { ...citation, sourceIds: [...citation.sourceIds] }];
        const legal = convertGeminiInlines(text, annotations, sources);
        assert.ok(legal);
        assert.equal(textOf(legal), text);
        assert.deepEqual(citationPositions(legal), [{ id: 'source-1', offset: text.length }]);
        for (const excess of [1, 2]) {
            assert.equal(convertGeminiInlines(text, [code, { ...citation, sourceIds: [...citation.sourceIds], end: text.length + excess }], sources), null);
        }
    }
});

test('invalid diagnostic source ranges remain partial through RPC and complete pagination', () => {
    const result = parseRemainingFixture('G_REMAINING_RANGES_INVALID');
    assert.equal(result.domain.detail.quality.status, 'partial');
    assert.ok(result.merged.evidence?.unrepresentedContent);
    const fallback = result.merged.diagnostics.find(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK');
    assert.ok(fallback?.details && typeof fallback.details === 'object' && !Array.isArray(fallback.details));
    assert.equal(fallback.details.reason, 'source_annotations_unrepresented');
    assert.ok(fallback.details.sourceCitationsJson, 'available source identities must remain in diagnostic evidence');
    assert.ok(!result.markdown.includes('Fallback body remains available.'));
    const assistant = result.domain.detail.messages.find(message => message.role === 'assistant');
    assert.ok(assistant);
    for (const node of invalidSourceRangeNodes) {
        assert.ok(assistant.content.some(block => block.type === 'paragraph' && textOf(block.children) === node.text));
        for (const a of node.annotations.filter(a => a.type === 7)) {
            assert.ok(result.markdown.includes('`' + node.text.slice(a.start, a.end) + '`'));
        }
    }
    assert.ok((result.domain.detail.messages.flatMap(message => message.citations ?? []).length) > 0);
    assertDomainClosure(result.domain.detail);
});

test('legal diagnostic source/code controls traverse the same RPC fixture core without fallback', () => {
    const result = parseRemainingFixture('G_REMAINING_RANGES_LEGAL');
    assert.equal(result.merged.diagnostics.filter(d => d.code === 'GEMINI_STRUCTURED_FALLBACK').length, 0);
    assertDomainClosure(result.domain.detail);
    for (const n of legalSourceRangeControls) {
        for (const a of n.annotations.filter(a => a.type === 7)) assert.ok(result.markdown.includes('`' + n.text.slice(a.start, a.end) + '`'));
    }
});
