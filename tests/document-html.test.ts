import { describe as __suiteDescribe } from 'node:test';
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import { historicalFixture } from "./helpers/nativeFixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type DomainConversationWithDetail } from "../src/l2/conversation.js";
import { type DocumentAst } from "../src/l3b/ast/ast.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import { fixtureKey } from "./helpers/domainFixture.js";

__suiteDescribe("document-html", () => {
function fixture(): DomainConversationWithDetail {
    return JSON.parse(readFileSync('tests/fixtures/document-domain/document-html.json', 'utf8'));
}

function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.freeze(value);
    Object.values(value).forEach(freeze);
}

test('HTML consumes the neutral composition and preserves immutable semantic input', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    freeze(input);
    const resources = Object.freeze({ img: 'assets/img.png' });
    const first = composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input)));
    assert.deepEqual(composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input))), first);
    assert.equal(JSON.stringify(input), before);
    const document = first;
    assert.equal(document.metadata.provider, 'example');
    assert.equal(document.messages[0].role, 'user');
    assert.ok(renderDocumentHtml(document, resources, { locale: 'en' }).html.includes('Show more'));
    const disclosure = document.messages[1].blocks[0];
    assert.equal(disclosure.type, 'disclosure');
    if (disclosure.type === 'disclosure') {
        assert.equal(disclosure.kind, 'reasoning');
        assert.ok(!('initiallyCollapsed' in disclosure));
    }
    assert.deepEqual(document.messages[1].sources, [{ id: 'c1', label: 'Source', href: 'https://example.com', number: 1 }]);
    assert.equal(document.messages[1].blocks.filter(b => b.type === 'image').length, 2, 'registry identity never deduplicates placements');
    assert.ok(renderDocumentHtml(document, resources).html.includes('<strong>123</strong>'), 'explicit caption is not tested as a filename');
});

test('JSON roundtrip and explicit presentation edits work without semantic input', () => {
    const resources = { img: 'assets/img.png' };
    const document = composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture())));
    const restored: DocumentAst = JSON.parse(JSON.stringify(document));
    assert.deepEqual(restored, document);
    assert.deepEqual(renderDocumentHtml(restored, resources), renderDocumentHtml(document, resources));
    restored.metadata.provider = 'Custom metadata';
    restored.messages[0].role = 'assistant';
    restored.messages[1].sources = [{ id: 'chosen', label: 'Chosen source', number: 1 }];
    const disclosure = restored.messages[1].blocks[0];
    assert.equal(disclosure.type, 'disclosure');
    if (disclosure.type === 'disclosure') disclosure.title = 'Chosen title';
    const html = renderDocumentHtml(restored, resources).html;
    assert.ok(html.includes('Custom metadata'));
    assert.ok(!html.includes('<div class="gem-user-bubble">'), 'renderer uses the AST role to select the presentation');
    assert.ok(html.includes('Chosen source') && html.includes('Chosen title'));
    assert.ok(!html.includes('gem-citation-chip" href="https://example.com'), 'renderer must not rebuild a source footer from registry');
});

test('table alignment follows logical columns for colSpan and rowSpan', () => {
    const input = fixture();
    input.detail.messages[0].content = [{ type: 'table', columns: [{ align: 'left' }, { align: 'right' }, { align: 'center' }], rows: [
        { cells: [{ children: [{ type: 'text', text: 'span' }], colSpan: 2, rowSpan: 2 }, { children: [{ type: 'text', text: 'last' }] }] },
        { cells: [{ children: [{ type: 'text', text: 'under' }] }] },
    ] }];
    const document = composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input)));
    const table = document.messages[0].blocks[0];
    assert.equal(table.type, 'table');
    if (table.type === 'table') {
        assert.equal(table.rows[0][1].column, 2);
        assert.equal(table.columnAlignments[table.rows[0][1].column], 'center');
        assert.equal(table.rows[1][0].column, 2);
        assert.equal(table.columnAlignments[table.rows[1][0].column], 'center');
    }
    assert.ok(renderDocumentHtml(document, { img: 'assets/img.png' }).html.includes('style="text-align:center">under'));
});

test('backend decides unavailable resources, preserves caption, and keeps nested diagnostics', () => {
    const document = composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture())));
    assert.ok(renderDocumentHtml(document, {}).diagnostics.some(d => d.code === 'HTML_ASSET_UNRESOLVED'));
    const html = renderDocumentHtml(document, {}).html;
    assert.ok(html.includes('gem-missing-inline'));
    assert.ok(html.includes('<strong>123</strong>'));
    assert.ok(!html.includes('<img'));
    assert.ok(renderDocumentHtml(document, {}).diagnostics.some(d => d.code === 'HTML_UNKNOWN_BLOCK'));
});

test('renderer requires prepared bindings and escapes text and URL attributes', () => {
    const document = composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture())));
    assert.ok(renderDocumentHtml(document, {}).html.includes('gem-missing-asset'));
    const invalidBinding = renderDocumentHtml(document, { img: 'assets/a" onload="evil.png' });
    assert.ok(invalidBinding.diagnostics.some(d => d.code === 'HTML_ASSET_UNRESOLVED'));
    assert.ok(!invalidBinding.html.includes('onload="evil.png'), 'invalid physical path cannot reach an attribute');
    assert.ok(invalidBinding.html.includes('&lt;x&gt;'));
    document.messages[0].blocks = [{ type: 'paragraph', children: [{ type: 'link', href: 'https://example.com?a=1&b=2', children: [{ type: 'text', text: 'Query' }] }] }];
    const queryHtml = renderDocumentHtml(document, { img: 'assets/img.png' }).html;
    assert.ok(queryHtml.includes('href="https://example.com/?a=1&amp;b=2"'));
    assert.ok(!queryHtml.includes('&amp;amp;'));
});

test('known empty state uses shared localized text without claiming acquisition failure', () => {
    const input = fixture(); input.detail.messages = [];
    const document = composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input)));
    assert.ok(!('emptyNotice' in document));
    assert.ok(renderDocumentHtml(document, {}, { locale: 'en' }).html.includes('Empty conversation.'));
    assert.ok(renderDocumentHtml(document, {}, { locale: 'zh' }).html.includes('暂无对话记录。'));
});



test('HTML backend uses supplied Packaging paths consistently', async () => {
    const native = historicalFixture({ id: 'production', title: 'Production', messages: [{ role: 'model', content: 'Body', attachments: [{ type: 'image', localName: 'assets/p.png', name: 'p.png' }] }] });
    const document = composeDomainDocument(native.conversation, native.account);
    const result = renderDocumentHtml(document, Object.fromEntries(native.conversation.detail.assets.map(asset => [asset.id, 'assets/p.png'])));
    assert.ok(result.html.includes('assets/p.png'));
    assert.ok(!result.html.includes('gem-missing-asset">'));
});

test('backend accepts safe custom bindings and reports unsafe bindings as unavailable', () => {
    const document = composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture())));
    const custom = renderDocumentHtml(document, { img: 'assets/custom.png' });
    assert.deepEqual(custom.diagnostics.filter(d => d.code === 'HTML_ASSET_UNRESOLVED'), []);
    assert.ok(custom.html.includes('src="assets/custom.png"'));
    const unsafe = renderDocumentHtml(document, { img: 'javascript:alert(1)' });
    assert.ok(unsafe.diagnostics.some(d => d.code === 'HTML_ASSET_UNRESOLVED'));
    assert.ok(!unsafe.html.includes('javascript:'));
    assert.ok(unsafe.html.includes('gem-missing-inline'));
});

test('HTML exposes collapsed user prompt content without JavaScript', () => {
    const input = fixture();
    const document = composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input)));
    const html = renderDocumentHtml(document, {}, { locale: 'en' }).html;
    assert.ok(html.includes('gem-prompt-content collapsed'), 'long prompt has the regular interactive fold');
    assert.match(html, /<noscript><style>\.gem-prompt-content\.collapsed\s*\{\s*max-height:\s*none;\s*overflow:\s*visible;/);
    assert.match(html, /\.gem-prompt-toggle\s*\{\s*display:\s*none;\s*\}<\/style><\/noscript>/);
});
});

__suiteDescribe("document-html-features", () => {
const test = require('node:test');
const assert = require('node:assert');

const { renderDocumentHtml } = require('../src/l4/format/html/renderHtml.js');
const { composeDomainDocument } = require('../src/l3b/compose/composeDomainDocument.js');

function domainFixture(messages: any[], assets: any[] = []) {
    return { index: { key: fixtureKey(String('c1'), 'gemini'),   titleSource: "derived",   title: 't' }, detail: { key: fixtureKey(String('c1'), 'gemini'), quality: { status: 'unknown' }, assets, messages } };
}

function msg(blocks: any[]) {
    return { id: 'm1', role: 'assistant', content: blocks };
}

function text(s: string) {
    return { type: 'text', text: s };
}

const resources = { a1: 'https://example.com/a.png' };

test('image card shows caption', () => {
    const b = domainFixture(
        [msg([{ type: 'image', assetId: 'a1', alt: 'pic', caption: [text('A nice view')] }])],
        [{ id: 'a1', kind: 'image', name: 'a.png' }],
    );
    const out = renderDocumentHtml(composeDomainDocument(b, fixtureAccountFor(b)), resources);
    assert.ok(out.html.includes('gem-att-caption'));
    assert.ok(out.html.includes('A nice view'));
});

test('file card shows description', () => {
    const b = domainFixture(
        [msg([{ type: 'file', assetId: 'a2', label: 'notes.pdf', description: [text('Q3 planning doc')] }])],
        [{ id: 'a2', kind: 'file', name: 'notes.pdf' }],
    );
    const out = renderDocumentHtml(composeDomainDocument(b, fixtureAccountFor(b)), resources);
    assert.ok(out.html.includes('gem-att-desc'));
    assert.ok(out.html.includes('Q3 planning doc'));
});

test('code header prefers filename, shows meta', () => {
    const withName = domainFixture([msg([{ type: 'code', code: 'x=1', language: 'python', filename: 'app.py', meta: '±2 lines' }])]);
    const out = renderDocumentHtml(composeDomainDocument(withName, fixtureAccountFor(withName)), resources);
    const blockHtml = out.html.slice(out.html.indexOf('<div class="gem-code-block">'));
    assert.ok(blockHtml.includes('>python<'));
    assert.ok(blockHtml.includes('class="gem-code-meta"'));
    assert.ok(blockHtml.includes('±2 lines'));

    const bare = domainFixture([msg([{ type: 'code', code: 'x=1', language: 'python' }])]);
    const out2 = renderDocumentHtml(composeDomainDocument(bare, fixtureAccountFor(bare)), resources);
    const bareHtml = out2.html.slice(out2.html.indexOf('<div class="gem-code-block">'));
    assert.ok(bareHtml.includes('>python</span>'));
    assert.ok(!bareHtml.includes('class="gem-code-meta"'));
});

test('HTML preserves Gemini execution identifiers on code and stdout blocks', () => {
    const blocks = domainFixture([msg([
        { type: 'code', language: 'python?code_reference&code_event_index=1', code: 'print(42)' },
        { type: 'code', language: 'text?code_stdout&code_event_index=1', code: '42' },
    ])]);
    const { html } = renderDocumentHtml(composeDomainDocument(blocks, fixtureAccountFor(blocks)), resources);
    assert.ok(html.includes('class="language-python?code_reference&amp;code_event_index=1"'));
    assert.ok(html.includes('class="language-text?code_stdout&amp;code_event_index=1"'));
});

test('table honors column alignment', () => {
    const cell = (s: string) => ({ children: [text(s)] });
    const b = domainFixture([msg([{
        type: 'table',
        columns: [{ align: 'left' }, { align: 'center' }, { align: 'right' }],
        headerRows: [{ cells: [cell('A'), cell('B'), cell('C')] }],
        rows: [{ cells: [cell('1'), cell('2'), cell('3')] }],
    }])]);
    const out = renderDocumentHtml(composeDomainDocument(b, fixtureAccountFor(b)), resources);
    assert.ok(out.html.includes('<th style="text-align:left">A</th>'));
    assert.ok(out.html.includes('<th style="text-align:center">B</th>'));
    assert.ok(out.html.includes('<th style="text-align:right">C</th>'));
    assert.ok(out.html.includes('<td style="text-align:center">2</td>'));
});

test('table without columns renders no alignment styles', () => {
    const cell = (s: string) => ({ children: [text(s)] });
    const b = domainFixture([msg([{
        type: 'table',
        rows: [{ cells: [cell('1'), cell('2')] }],
    }])]);
    const out = renderDocumentHtml(composeDomainDocument(b, fixtureAccountFor(b)), resources);
    const tableHtml = out.html.slice(out.html.indexOf('<table class="gem-table">'), out.html.indexOf('</table>'));
    assert.ok(!tableHtml.includes('text-align'));
});
});

__suiteDescribe("document-html-math-policy", () => {
/**
 * 2. Original LaTeX source is preserved inside MathML <annotation encoding="application/x-tex">
 *    for accessibility and copyability.
 * 3. Unsupported LaTeX environments (TikZ) are detected and fail gracefully with diagnostic warnings
 *    and copyable fallback blocks.
 * 4. Unknown LaTeX commands / syntax errors trigger graceful diagnostic fallback blocks.
 */

const test = require('node:test');
const assert = require('node:assert');

const { renderMathHtml } = require('../src/l4/format/html/htmlMath.js');
const { getRendererStrings } = require('../src/l4/format/shared/renderStrings.js');
const { renderDocumentHtml } = require('../src/l4/format/html/renderHtml.js');
const { parseFixture } = require('./helpers/documentFixture.js');

test('PR 3: Supported LaTeX math compiles to valid MathML', () => {
    const resInline = renderMathHtml('E = mc^2', false, getRendererStrings('zh').mathFallback);
    assert.strictEqual(resInline.diagnostic, undefined);
    assert.ok(resInline.html.includes('<math xmlns="http://www.w3.org/1998/Math/MathML">'));
    assert.ok(resInline.html.includes('<annotation encoding="application/x-tex">E = mc^2</annotation>'));

    const resFrac = renderMathHtml(String.raw`\frac{a}{b}`, true, getRendererStrings('zh').mathFallback);
    assert.strictEqual(resFrac.diagnostic, undefined);
    assert.ok(resFrac.html.includes('<mfrac>'));
    const withoutAnnotation = resFrac.html.replace(/<annotation\b[\s\S]*?<\/annotation>/g, '');
    assert.strictEqual(withoutAnnotation.includes(String.raw`\frac`), false, 'Visible MathML DOM must use <mfrac> instead of raw \\frac text');

    const resScripts = renderMathHtml('x_i^2', false, getRendererStrings('zh').mathFallback);
    assert.strictEqual(resScripts.diagnostic, undefined);
    assert.ok(resScripts.html.includes('<msubsup>') || resScripts.html.includes('<msub>'));

    const resMatrix = renderMathHtml(String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`, true, getRendererStrings('zh').mathFallback);
    assert.strictEqual(resMatrix.diagnostic, undefined);
    assert.ok(resMatrix.html.includes('<mtable'));
    assert.ok(resMatrix.html.includes('<mtr>'));

    const resCases = renderMathHtml(String.raw`\begin{cases} 1 & x > 0 \\ 0 & x \le 0 \end{cases}`, true, getRendererStrings('zh').mathFallback);
    assert.strictEqual(resCases.diagnostic, undefined);
    assert.ok(resCases.html.includes('<mtable'));

    const resOp = renderMathHtml(String.raw`\operatorname{tr}(A) + \hbar \Omega`, false, getRendererStrings('zh').mathFallback);
    assert.strictEqual(resOp.diagnostic, undefined);
    assert.ok(resOp.html.includes('<mi>tr</mi>') || resOp.html.includes('tr'));
});

test('PR 3: TikZ diagrams fail gracefully with HTML_MATH_UNSUPPORTED_TIKZ diagnostic', () => {
    const tikzSource = [
        String.raw`\begin{tikzpicture}[scale=1.5]`,
        String.raw`\draw[thick,->] (0,0) -- (1,0) node[anchor=north west] {x};`,
        String.raw`\draw[thick,->] (0,0) -- (0,1) node[anchor=south east] {y};`,
        String.raw`\end{tikzpicture}`,
    ].join('\n');

    const res = renderMathHtml(tikzSource, true, getRendererStrings('zh').mathFallback);
    assert.ok(res.diagnostic);
    assert.strictEqual(res.diagnostic.code, 'HTML_MATH_UNSUPPORTED_TIKZ');
    assert.strictEqual(res.diagnostic.severity, 'warning');
    assert.ok(res.html.includes('gem-math-unsupported'));
    assert.ok(res.html.includes('无法排版该公式；保留原始 LaTeX：'));
    assert.ok(res.html.includes(String.raw`\begin{tikzpicture}`));
});

test('PR 3: Unknown LaTeX commands fail gracefully with HTML_MATH_RENDER_FAILED diagnostic', () => {
    const unkSource = String.raw`\completelyUnknownMacro{foo}{bar}`;
    const res = renderMathHtml(unkSource, true, getRendererStrings('en').mathFallback);
    assert.ok(res.diagnostic);
    assert.strictEqual(res.diagnostic.code, 'HTML_MATH_RENDER_FAILED');
    assert.ok(res.html.includes('gem-math-unsupported'));
    assert.ok(res.html.includes('Could not typeset this formula; original LaTeX preserved:'));
    assert.ok(res.html.includes(unkSource));
});

test('PR 3: Empty math source handles gracefully', () => {
    const res = renderMathHtml('   ', true, getRendererStrings('zh').mathFallback);
    assert.ok(res.diagnostic);
    assert.strictEqual(res.diagnostic.code, 'HTML_MATH_EMPTY');
    assert.ok(res.html.includes('gem-math-empty'));
});

test('PR 3: End-to-end integration via provider parsing, composition and HTML rendering', async () => {
    const raw = {
        id: 'math_policy_integration_test',
        title: 'Math Policy Test',
        messages: [{
            id: 'm1',
            role: 'model',
            content: [
                '爱因斯坦质能方程为 $E = mc^2$。',
                '',
                '$$',
                String.raw`\hbar \Omega = \int_0^\infty f(x) dx`,
                '$$',
                '',
                '以下是复杂绘图：',
                '$$',
                String.raw`\begin{tikzpicture}`,
                String.raw`\draw (0,0) -- (1,1);`,
                String.raw`\end{tikzpicture}`,
                '$$',
            ].join('\n'),
        }],
    };

    const { document, resources } = await parseFixture(raw);
    const { html, diagnostics } = renderDocumentHtml(document, resources, { locale: 'zh' });
    const tikzDiag = diagnostics.find((d: { code: string }) => d.code === 'HTML_MATH_UNSUPPORTED_TIKZ');
    assert.ok(tikzDiag, 'Expected HTML_MATH_UNSUPPORTED_TIKZ diagnostic in renderCanonicalHtml');
    assert.ok(html.includes('无法排版该公式；保留原始 LaTeX：'));
    assert.ok(html.includes(String.raw`\begin{tikzpicture}`));

    assert.ok(html.includes('<math xmlns="http://www.w3.org/1998/Math/MathML">'));
    assert.ok(html.includes('<annotation encoding="application/x-tex">E = mc^2</annotation>'));
    assert.ok(html.includes(String.raw`\hbar \Omega = \int_0^\infty f(x) dx`));
});

test('live centered negation renders as MathML while retaining original TeX', () => {
    const source = String.raw`a \centernot\implies b`;
    const result = renderMathHtml(source, true, 'fallback');
    assert.equal(result.diagnostic, undefined);
    assert.ok(result.html.includes('⇏'));
    assert.ok(result.html.includes(source), 'retain original TeX annotation');
    assert.ok(!result.html.includes('gem-math-unsupported'));
});
});

__suiteDescribe("document-html-parity", () => {
/**
 * tests/document-html-parity.test.ts
 * F2c: content-completeness of the canonical-AST HTML renderer
 * (renderCanonicalHtml).
 *
 * History: this file originally compared the legacy 1:1 HTML exporter
 * (toHtml) against the canonical renderer as migration evidence.
 * Item 2 (P0) removed the legacy toHtml() pipeline entirely, so the
 * legacy reference is gone; the remaining assertions now verify directly
 * that the canonical renderer drops no content class (text, attachments,
 * images, thoughts, code, table, math, citations, unknown content).
 *
 * Method: desensitized Conversation -> provider parsing -> Domain -> Document AST ->
 * renderCanonicalHtml; visible text is extracted per turn and checked
 * for content-completeness (tags/styles may differ; content must not).
 *
 * Asserted canonical behaviors (kept from the parity era):
 * - citations: rendered as visible chips (legacy dropped them)
 * - unknown content: visible fallback, never a blank gap
 */

const test = require('node:test');
const assert = require('node:assert');

const { parseFixture } = require('./helpers/documentFixture.js');
const { renderDocumentHtml } = require('../src/l4/format/html/renderHtml.js');

const chat: any = {
    id: 'parity_chat_001',
    title: 'Parity Test Conversation',
    url: 'https://gemini.google.com/app/parity_chat_001',
    messages: [
        {
            role: 'user',
            content: 'Please explain **binary search** in detail.\n\nI want:\n\n- a short *intuition* paragraph\n- `O(log n)` complexity analysis\n- edge cases list\n\n> Quote me the key invariant.\n\nThis prompt is deliberately long so that both renderers must apply the collapsible long-prompt treatment consistently. '.repeat(3),
            attachments: [
                { type: 'image', localName: 'assets/plan.png', name: 'plan.png', mimeType: 'image/png' },
                { type: 'file', localName: 'assets/notes.pdf', name: 'notes.pdf', title: 'notes.pdf' },
            ],
        },
        {
            role: 'model',
            thoughts: 'The user wants binary search explained. Keep it concise and correct.',
            content: '## Binary Search\n\nBinary search finds a target in a **sorted** array in `O(log n)` time.\n\n```python\ndef bsearch(a, x):\n    lo, hi = 0, len(a)\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if a[mid] < x:\n            lo = mid + 1\n        else:\n            hi = mid\n    return lo\n```\n\n| Case | Complexity |\n|---|---|\n| Best | $O(1)$ |\n| Worst | $O(\\log n)$ |\n\nSee [1] for details.\n\nKey invariant: `a[lo..hi)` always contains the answer.',
            citations: [
                { title: 'Binary search reference', url: 'https://example.com/bsearch' },
            ],
        },
        {
            // Unknown content shape: legacy renders blank, AST renderer must stay visible.
            role: 'model',
            content: { opaque: 'provider-blob', n: 42 },
        },
        {
            role: 'model',
            content: 'Attachment without bytes.',
            attachments: [
                { type: 'file', name: 'ghost.pdf' },
            ],
        },
    ],
};

function decodeEntities(s: string): string {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

/** Split the document into its top-level turn sections (depth-aware). */
function splitTurns(html: string): string[] {
    const turns = [];
    const re = /<section class="gem-turn[^>]*>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        let depth = 1;
        let i = m.index + m[0].length;
        while (depth > 0) {
            const open = html.indexOf('<section', i);
            const close = html.indexOf('</section>', i);
            if (close === -1) break;
            if (open !== -1 && open < close) { depth++; i = open + 8; }
            else { depth--; i = close + 10; }
        }
        turns.push(html.slice(m.index, i));
    }
    return turns;
}

/** Visible text lines of an HTML fragment, in document order. */
function textLines(fragment: string): string[] {
    let t = fragment
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<(br|hr)\b[^>]*>/gi, '\n')
        .replace(/<\/(p|div|section|article|li|tr|h\d|blockquote|pre|figure|figcaption|details|summary|table|thead|tbody|caption)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
    t = decodeEntities(t);
    return t
        .split('\n')
        .map((l: string) => l.replace(/\s+/g, ' ').trim())
        .filter((l) => l.length > 0)
        // citation markers are presentation: "[1]" (legacy) vs "1" (AST link)
        .map((l: string) => l.replace(/\[(\d+)\]/g, '$1'));
}

let newHtml: string;
let newDiagnostics: Array<{ code: string }>;


test('parity setup: canonical renderer produces output', async () => {
    const { document, resources } = await parseFixture(chat);
    const res = renderDocumentHtml(document, resources);
    newHtml = res.html;
    newDiagnostics = res.diagnostics;
    assert.ok(newHtml.startsWith('<!DOCTYPE html>'), 'AST output is a document');
});

test('parity: same turn count and structure', () => {
    const newTurns = splitTurns(newHtml);
    assert.strictEqual(newTurns.length, 4, 'AST renderer renders 4 turns');
    assert.ok(newHtml.includes('gem-turn-user'), 'user turn kept');
    assert.ok(newHtml.includes('gem-user-bubble'), 'user bubble kept');
    assert.ok(newHtml.includes('gem-turn-model'), 'model turns kept');
});

test('parity: user turn text is complete (content not lost)', () => {
    const newText = textLines(splitTurns(newHtml)[0]).join(' ');
    for (const needle of [
        'Please explain',
        'binary search',
        'in detail',
        'intuition',
        'O(log n)',
        'complexity analysis',
        'edge cases list',
        'Quote me the key invariant',
        'deliberately long',
    ]) {
        assert.ok(newText.includes(needle), `user-turn content missing from AST output: ${needle}`);
    }
});

test('parity: model turn text is complete (content not lost)', () => {
    const newText = textLines(splitTurns(newHtml)[1]).join(' ');
    for (const needle of [
        'Binary Search',
        'Binary search finds a target',
        'sorted',
        'def bsearch(a, x):',
        'Case',
        'Complexity',
        'Best',
        'Worst',
        'Key invariant:',
        'always contains the answer',
    ]) {
        assert.ok(newText.includes(needle), `model-turn content missing from AST output: ${needle}`);
    }
});

test('parity: long prompt collapses', () => {
    assert.ok(newHtml.includes('gem-prompt-content collapsed'), 'AST renderer collapses long prompt');
    assert.ok(newHtml.includes('gem-prompt-toggle'), 'AST renderer keeps expand toggle');
});

test('parity: thoughts accordion, code copy, attachments kept', () => {
    assert.ok(newHtml.includes('gem-thoughts'), 'thoughts accordion kept');
    assert.ok(newHtml.includes('Thinking Process'), 'thoughts title kept');
    assert.ok(newHtml.includes('The user wants binary search explained'), 'thought text kept');
    assert.ok(newHtml.includes('gem-code-block'), 'code block kept');
    assert.ok(newHtml.includes('copyCode(this)'), 'code copy button kept');
    assert.ok(newHtml.includes('def bsearch(a, x):'), 'code content kept');
    assert.ok(!newHtml.includes('gem-carousel-wrapper'), 'carousel removed in favor of single placement');
    assert.ok(newHtml.includes('assets/plan.png'), 'image asset offline path kept');
    assert.ok(newHtml.includes('assets/notes.pdf'), 'file asset offline path kept');
    assert.ok(newHtml.includes('gem-math-block') || newHtml.includes('gem-math-inline'), 'math kept');
});

test('improvement: citations are visible', () => {
    assert.ok(newHtml.includes('Binary search reference'), 'AST renderer shows citation chip');
    assert.ok(newHtml.includes('https://example.com/bsearch'), 'AST renderer links citation URL');
});

test('improvement: unknown content stays visible, never blank', () => {
    const unknownTurn = splitTurns(newHtml)[2];
    assert.ok(unknownTurn.includes('gem-unknown-block'), 'unknown block has visible wrapper');
    const lines = textLines(unknownTurn);
    assert.ok(lines.length > 0, 'unknown turn renders visible text, not a blank gap');
});

test('missing asset: visible placeholder + diagnostic, no silent gap', () => {
    const ghostTurn = splitTurns(newHtml)[3];
    assert.ok(ghostTurn.includes('gem-missing-asset'), 'missing asset renders a visible placeholder');
    const codes = newDiagnostics.map((d: { code: string }) => d.code);
    assert.ok(codes.includes('HTML_ASSET_UNRESOLVED'), `diagnostic emitted, got: ${codes.join(',')}`);
});

test('offline: no remote asset URLs leak into output', () => {
    // The only remote URL allowed is the citation link (user-visible source link).
    const srcs = [...newHtml.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
    const nonCitation = srcs.filter((u) => !u.includes('example.com'));
    assert.deepStrictEqual(nonCitation, [], `no remote asset URLs, got: ${nonCitation.join(',')}`);
});

test('inline image (#555 contract): renders inline <img>, never dropped', () => {
    const document = {
        title: "Inline img",
        metadata: { id: "inline", provider: "gemini" },
        "messages": [
            {
                role: "user",
                "blocks": [
                    {
                        "type": "paragraph",
                        "children": [
                            {
                                "type": "text",
                                "text": "see "
                            },
                            {
                                "type": "image",
                                "resourceId": "a-inline",
                                "alt": "a diagram",
                                "title": "fig 1"
                            },
                            {
                                "type": "text",
                                "text": " here"
                            }
                        ]
                    }
                ]
            }
        ]
    };
    const resources = {"a-inline":"assets/d.png"};
    const res = renderDocumentHtml(document, resources);
    assert.ok(res.html.includes('class="gem-inline-img"'), 'inline image renders an inline <img>');
    assert.ok(res.html.includes('alt="a diagram"'), 'alt text preserved');
    assert.ok(res.html.includes('title="fig 1"'), 'title preserved');
    assert.ok(!res.diagnostics.some((d: any) => d.code === 'HTML_ASSET_UNRESOLVED'), 'no diagnostic when asset resolves');
});

test('inline image with missing asset: visible placeholder + diagnostic', () => {
    const document = {
        title: "Inline img missing",
        metadata: { id: "inline-missing", provider: "gemini" },
        "messages": [
            {
                role: "user",
                "blocks": [
                    {
                        "type": "paragraph",
                        "children": [
                            {
                                "type": "text",
                                "text": "see "
                            },
                            {
                                "type": "image",
                                "resourceId": "a-gone",
                                "alt": "lost diagram"
                            }
                        ]
                    }
                ]
            }
        ]
    };
    const resources = {};
    const res = renderDocumentHtml(document, resources);
    assert.ok(res.html.includes('gem-missing-inline'), 'missing inline image renders a visible placeholder');
    assert.ok(res.html.includes('lost diagram'), 'alt text still visible in placeholder');
    assert.ok(res.diagnostics.some((d: any) => d.code === 'HTML_ASSET_UNRESOLVED'), 'diagnostic emitted, never silent');
});
});
