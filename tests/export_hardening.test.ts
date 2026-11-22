import test from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentAst } from '../src/l3b/ast/ast.js';
import { renderDocumentHtml } from '../src/l4/format/html/renderHtml.js';
import { renderDocumentMarkdown } from '../src/l4/format/markdown/renderMarkdown.js';
import { renderMathHtml } from '../src/l4/format/html/htmlMath.js';

function baseDoc(overrides: Partial<DocumentAst> = {}): DocumentAst {
    return {
        title: 'Hardening Test',
        metadata: { id: 'conv-1', provider: 'gemini', createdAt: 1700000000000, updatedAt: 1700000000000 },
        messages: [],
        ...overrides,
    };
}

test('HTML file attachment links include rel="noopener noreferrer" with target="_blank"', () => {
    const doc = baseDoc({
        messages: [{
            role: 'assistant',
            blocks: [{
                type: 'file',
                resourceId: 'file-1',
                label: 'report.svg',
                kind: 'file',
                mediaType: 'image/svg+xml',
            }],
        }],
    });
    const { html } = renderDocumentHtml(doc, { 'file-1': 'files/report.svg' });
    assert.match(html, /<a class="gem-att-card gem-att-file"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
});

test('Markdown unlinked source labels are escaped and flattened onto a single blockquote line', () => {
    const doc = baseDoc({
        messages: [{
            role: 'assistant',
            blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Answer' }] }],
            sources: [{
                id: 'src-1',
                number: 1,
                label: '<script>alert(1)</script>\n# Injected Heading',
            }],
        }],
    });
    const md = renderDocumentMarkdown(doc, {});
    assert.ok(!md.includes('<script>'), 'raw HTML tag must be escaped');
    assert.ok(!md.includes('\n# Injected Heading'), 'newline must not break out of blockquote');
    assert.ok(md.includes('> [1] [&lt;script&gt;alert(1)&lt;/script&gt; \\# Injected Heading]'));
});

test('HTML math renderer enforces trust: false and maxExpand limit', () => {
    const res = renderMathHtml('\\href{javascript:alert(1)}{click}', false, 'Fallback');
    assert.ok(!res.html.includes('<a '), 'untrusted KaTeX href must not render an anchor tag');
    assert.ok(!res.html.includes('href='), 'untrusted KaTeX href must not emit an href attribute');
    const expanded = renderMathHtml('\\def\\a{\\a}\\a', false, 'Fallback');
    assert.equal(expanded.diagnostic?.code, 'HTML_MATH_RENDER_FAILED');
});
