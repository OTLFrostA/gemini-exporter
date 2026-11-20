import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertHtmlToMarkdown } from '../src/l1/parsers/shared/html/htmlToMarkdown.js';
import { parseGeminiBody } from '../src/l1/parsers/gemini/shared/contentAdapter.js';

test('source Markdown code fences protect HTML-like literals before any tag rewriting', () => {
    for (const fence of ['```', '~~~']) {
        const source = [fence + 'html', '<h2>Not a heading</h2>', '<pre><code>not a nested block</code></pre>', fence, '<p>Real paragraph</p>'].join('\n');
        const converted = convertHtmlToMarkdown(source);
        assert.ok(converted.includes([fence + 'html', '<h2>Not a heading</h2>', '<pre><code>not a nested block</code></pre>', fence].join('\n')));
        assert.ok(converted.includes('Real paragraph'));
        const blocks = parseGeminiBody(source, undefined, { diagnostics: [], sourceRef: { providerId: 'gemini', locator: 'test' } });
        const code = blocks.find(block => block.type === 'code');
        assert.ok(code && code.code.includes('<h2>Not a heading</h2>'));
        assert.ok(code && code.code.includes('<pre><code>not a nested block</code></pre>'));
    }
});

test('HTML links and images retain escaped targets and do not rewrite code literals', () => {
    const source = '<p><a href="https://example.com/a(b)?x=1&amp;y=2">Article</a>'
        + '<img src="https://example.com/i.png" alt="Image [1]">'
        + '<code>&lt;img src="literal.png"&gt;</code></p>';
    const converted = convertHtmlToMarkdown(source);
    assert.ok(converted.includes('[Article](https://example.com/a%28b%29?x=1&y=2)'));
    assert.ok(converted.includes('![Image \\[1\\]](https://example.com/i.png)'));
    assert.ok(converted.includes('`<img src="literal.png">`'));
    assert.ok(convertHtmlToMarkdown('<img src="https://example.com/i.png" alt="Image">').includes('![Image](https://example.com/i.png)'));
    assert.equal(convertHtmlToMarkdown('<a href="javascript:alert(1)">Visible</a>'), 'Visible');
    assert.equal(convertHtmlToMarkdown('<img src="data:text/html,body" alt="Visible">'), 'Visible');
});

test('HTML pre/code source is stashed before HTML normalization and uses a noncolliding fence', () => {
    const source = '<pre><code class="language-html">&lt;p&gt;literal&lt;/p&gt;\n```\n&lt;em&gt;code&lt;/em&gt;</code></pre><p>Outside</p>';
    const converted = convertHtmlToMarkdown(source);
    assert.ok(converted.includes('````html\n<p>literal</p>\n```\n<em>code</em>\n````'));
    assert.ok(converted.includes('Outside'));
    assert.ok(converted.includes('<em>code</em>'));
    assert.equal(converted.includes('**code**'), false);
});

test('HTML inline code preserves literal tag text while converting surrounding markup', () => {
    const converted = convertHtmlToMarkdown('<p>Prefix <code>&lt;h1&gt;Literal&lt;/h1&gt;</code> <strong>Actual</strong></p>');
    assert.ok(converted.includes('`<h1>Literal</h1>`'));
    assert.ok(converted.includes('**Actual**'));
});

test('Markdown code spans preserve HTML while surrounding markup is converted', () => {
    const inline = '`<strong>literal</strong>`';
    const multi = '``<code>`literal`\n&amp;</code>``';
    const html = '<code>`literal` &amp;</code>';
    assert.equal(
        convertHtmlToMarkdown(`Use ${inline} and ${multi}; <strong>real</strong> and ${html}.`),
        `Use ${inline} and ${multi}; **real** and ` + '`` `literal` & ``.',
    );
    assert.equal(convertHtmlToMarkdown('```<b>literal</b>``` and <b>real</b>'), '```<b>literal</b>``` and **real**');
});

test('unmatched and escaped Markdown backticks do not shield surrounding HTML', () => {
    const source = '\`\`<b>first</b> \\\`<b>second</b> \`\n\n<b>third</b> \`\`';
    assert.equal(convertHtmlToMarkdown(source), '\`\`**first** \\\`**second** \`\n\n**third** \`\`');
    assert.equal(convertHtmlToMarkdown('\\``<b>literal</b>` <b>real</b>'), '\\``<b>literal</b>` **real**');
});

test('backticks inside HTML attributes or comments cannot close Markdown code spans', () => {
    assert.equal(convertHtmlToMarkdown('Unmatched ` then <b title="`">real</b>.'), 'Unmatched ` then **real**.');
    assert.equal(convertHtmlToMarkdown('Unmatched ` then <!-- hidden ` --> <b>real</b>.'), 'Unmatched ` then  **real**.');
    assert.equal(convertHtmlToMarkdown('Use `<code>` and <b>real</b> and `</code>`.'), 'Use `<code>` and **real** and `</code>`.');
    const span = '`<b title="`">example</b>`';
    assert.equal(convertHtmlToMarkdown('Use ' + span + ' and <b>real</b>.'), 'Use ' + span + ' and **real**.');
});

test('literal closing cell tags are preserved in Markdown code outside HTML tables', () => {
    const example = 'Close cells with `</td>` or `</th>` here.';
    assert.equal(convertHtmlToMarkdown(example + ' <b>Real</b>'), example + ' **Real**');
    const table = '<table><tr><td>left</td><td>right</td></tr></table>';
    assert.equal(convertHtmlToMarkdown(example + table + example),
        example + '\n\n| left | right |\n| --- | --- |\n\n' + example);
    assert.equal(convertHtmlToMarkdown(example + ' Use `</table>` for tables. <b>Real</b>'),
        example + ' Use `</table>` for tables. **Real**');
});
