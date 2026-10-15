import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTableMathPipes, preprocessGeminiMarkdown } from '../src/core/parsers/gemini/shared/markdownCompatibility.js';
import { parseMarkdownAst, parseMarkdownToBlocks } from '../src/core/parsers/shared/markdown/parseMarkdown.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
import { decodeGeminiStructuredNode } from '../src/core/parsers/gemini/rpc/structuredContent.js';
import { geminiStructuredToContent } from '../src/core/parsers/gemini/shared/structuredContentAdapter.js';
import type { BlockNode } from '../src/core/domain/content/blocks.js';

function visibleText(node: { value?: string; children?: unknown[] }): string {
    return node.value ?? (node.children ?? []).map(child => visibleText(child as typeof node)).join('');
}

test('captured Gemini table keeps eight columns and complete absolute-value formulas', () => {
    const original = readFileSync('tests/fixtures/provider/math/gm_md_002_evidence.md', 'utf8');
    const normalized = preprocessGeminiMarkdown(original);
    const table = parseMarkdownAst(normalized).children.find(node => node.type === 'table');
    assert.ok(table?.type === 'table');
    assert.equal(table.children.length, 2);
    assert.ok(table.children.every(row => row.children.length === 8));
    const residual = table.children[0].children[4].children.find(node => node.type === 'inlineMath');
    assert.equal(residual?.type === 'inlineMath' && residual.value, String.raw`\vert{}F(\beta)\vert{}`);
    assert.equal(normalizeTableMathPipes(normalized), normalized);
});
test('table compatibility excludes prose, code, escaped bars, unmatched math and mismatched columns', () => {
    for (const source of [String.raw`Text $|x|$`, '```md\n| $|x|$ | b |\n| --- | --- |\n```',
        '| `$|x|$` | b |\n| --- | --- |', String.raw`| $\|x\|$ | b |`+'\n| --- | --- |',
        '| $|x | b |\n| --- | --- |', '| $|x|$ | b | c |\n| --- | --- |']) {
        assert.equal(normalizeTableMathPipes(source), source);
    }
});

test('Domain and serialized Markdown preserve the captured numeric row and all eight headers', () => {
    const raw = readFileSync('tests/fixtures/provider/math/gm_md_002_evidence.md', 'utf8');
    const blocks = parseMarkdownToBlocks(preprocessGeminiMarkdown(raw), 'live', { sourceRef: { providerId: 'gemini', locator: 'live.5' }, diagnostics: [] });
    const domain: DomainConversationWithDetail = { index: { cloudAvailability: 'unknown', hasTakeoutImport: false, titleSource: 'legacy', providerId: 'gemini', id: 'live', title: 'Live' }, detail: { quality: { status: 'unknown' }, assets: [], messages: [{ id: 'm', role: 'assistant', content: blocks }] } };
    const output = renderDocumentMarkdown(composeDomainDocument(validateParserDomain(domain)).document, {});
    const table = parseMarkdownAst(output).children.find(node => node.type === 'table');
    assert.ok(table?.type === 'table');
    assert.deepEqual(table.children[1].children.map(cell => visibleText(cell)), [
        '10^{-4}', 'Bisection', '15', '36.938477', String.raw`3.5 \times 10^{-4}`,
        String.raw`1.9 \times 10^{-4}`, String.raw`1.2 \times 10^{-3}`, String.raw`Rejected (\Delta\Pi > 0.01 u_c)`,
    ]);
    assert.equal(table.children[0].children.length, 8);
    assert.equal(visibleText(table.children[0].children[4]), String.raw`Final Residual \vert{}F(\beta)\vert{}`);
    assert.equal(visibleText(table.children[0].children[5]), String.raw`Numerical Error \vert{}\beta - \beta^*\vert{} [^\circ]`);
});

const liveTables = JSON.parse(readFileSync('tests/fixtures/provider/math/gemini_table_display_math.json', 'utf8')) as { displayTable: unknown; normTable: unknown };
function renderCapturedTable(wire: unknown): { blocks: BlockNode[]; output: string } {
    const node = decodeGeminiStructuredNode(wire);
    assert.ok(node);
    const blocks = geminiStructuredToContent({ children: [node] });
    assert.ok(blocks, 'all native table children must remain supported');
    const domain: DomainConversationWithDetail = { index: { cloudAvailability: 'unknown', hasTakeoutImport: false, titleSource: 'legacy', providerId: 'gemini', id: 'captured', title: 'Captured' }, detail: { quality: { status: 'unknown' }, assets: [], messages: [{ id: 'm', role: 'assistant', content: blocks }] } };
    return { blocks, output: renderDocumentMarkdown(composeDomainDocument(validateParserDomain(domain)).document, {}) };
}

test('native display math inside a captured table does not reinterpret neighboring literal TeX', () => {
    const { blocks, output } = renderCapturedTable(liveTables.displayTable);
    const native = blocks[0];
    assert.equal(native.type, 'table');
    if (native.type !== 'table') return;
    assert.ok(native.rows[1].cells[1].children.some(node => node.type === 'inlineMath'
        && node.source === String.raw`Q = \int_{\Psi_{\text{leaf}}}^{\Psi_{\text{soil}}} K(\Psi)\,d\Psi`));
    const table = parseMarkdownAst(output).children.find(node => node.type === 'table');
    assert.ok(table?.type === 'table');
    assert.ok(table.children.every(row => row.children.length === 5));
    assert.equal(visibleText(table.children[1].children[1]), String.raw`Constant K_{\text{plant}}:$$\Delta\Psi = \frac{E}{K_{\text{plant}}}$$Flow is linearly proportional to the water-potential gradient via Ohm's law analogy.`);
    assert.ok(visibleText(table.children[4].children[1]).includes(String.raw`Q_{\text{in}}!\left`));
});

test('native norm formulas serialize as valid six-column GFM without becoming absolute-value bars', () => {
    const { output } = renderCapturedTable(liveTables.normTable);
    const table = parseMarkdownAst(output).children.find(node => node.type === 'table');
    assert.ok(table?.type === 'table');
    assert.equal(table.children.length, 6);
    assert.ok(table.children.every(row => row.children.length === 6));
    const norm = table.children[0].children[2].children.find(node => node.type === 'inlineMath');
    assert.equal(norm?.type === 'inlineMath' && norm.value, String.raw`\Vert{}\cdot\Vert{}_{\infty}`);
    assert.ok(!output.includes(String.raw`\\|`));
    assert.equal(visibleText(table.children[1].children[0]), '120.0',
        'the first native numeric cell must remain in its original row');
    assert.equal(visibleText(table.children[5].children[0]), '7.5',
        'the last native numeric cell must remain in its original row');
});
