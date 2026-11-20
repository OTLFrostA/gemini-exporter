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

test('backticks inside real HTML code cannot close an unmatched prose delimiter', () => {
    assert.equal(convertHtmlToMarkdown('Unmatched ` then <code>`raw` &lt;b&gt;</code>.'), 'Unmatched ` then `` `raw` <b> ``.');
    assert.equal(convertHtmlToMarkdown('Use `<code>` then <code>`real` &lt;b&gt;</code> and `</code>`.'),
        'Use `<code>` then `` `real` <b> `` and `</code>`.');
});

test('literal HTML comment openers in code do not consume following prose', () => {
    assert.equal(
        convertHtmlToMarkdown('Type `<!--` and keep this text. <!-- hidden --> <b>real</b>.'),
        'Type `<!--` and keep this text.  **real**.',
    );
});

test('partial HTML examples preserve literal tags without shielding intervening markup', () => {
    assert.equal(
        convertHtmlToMarkdown('Use `use <code>` then <code>x</code> and `</code>`.'),
        'Use `use <code>` then `x` and `</code>`.',
    );
    assert.equal(
        convertHtmlToMarkdown('Use `use <code>` then <b>real</b> and `</code>`.'),
        'Use `use <code>` then **real** and `</code>`.',
    );
});

test('formatted HTML between separate partial code tags is converted', () => {
    for (const [opening, closing] of [
        ['`<code>example`', '`</code>`'],
        ['``<code>example with a ` backtick``', '``end </code> suffix``'],
    ]) {
        const input = `Use ${opening} and <b>real</b> and ${closing}.`;
        const expected = `Use ${opening} and **real** and ${closing}.`;
        assert.equal(convertHtmlToMarkdown(input), expected);
        assert.equal(convertHtmlToMarkdown(`<p>${input}</p>`).trim(), expected);
        assert.ok(convertHtmlToMarkdown(`<table><tr><td>${input}</td><td>Other</td></tr></table>`)
            .includes(`| ${expected} | Other |`));
    }
});

test('backticks in separate HTML code elements cannot form a Markdown span across the elements', () => {
    const source = '<code>left`</code> <b>one</b> <code>`middle`</code> <b>two</b> <code>`right</code>';
    assert.equal(convertHtmlToMarkdown(source), '`` left` `` **one** `` `middle` `` **two** `` `right ``');
    assert.equal(
        convertHtmlToMarkdown('Unmatched ` then <code>`first`</code> <b>and</b> <code>`second</code>'),
        'Unmatched ` then `` `first` `` **and** `` `second ``',
    );
});

test('adjacent HTML and Markdown code preserve both code spans without leaking placeholders', () => {
    assert.equal(
        convertHtmlToMarkdown('<code>` raw `</code>`md`'),
        '`` ` raw ` `` `md`',
    );
});

test('mixed HTML and Markdown never expose internal code placeholders', () => {
    const nested = '`<code>` ``<code>`` <b>real</b> ``</code>`` `</code>`';
    const inputs = [
        nested,
        '``<code>`` `<code>` <b>real</b> `</code>` ``</code>``',
        '`<code>` ``<code data-demo>`` <em>real</em> ``</code>`` `</code>`',
        '<code>` raw `</code>`md`',
        '<pre><code>`&lt;code&gt;`</code></pre>',
    ];
    for (const input of inputs) {
        for (const source of [input, `<p>${input}</p>`, `<table><tr><td>${input}</td></tr></table>`]) {
            assert.doesNotMatch(convertHtmlToMarkdown(source), /[\uE000\uFFFD]CODE\d+[\uE000\uFFFD]/, source);
        }
    }
});

test('source text shaped like a code placeholder is retained verbatim', () => {
    const literal = '\uFFFDCODE7\uFFFD \uFFFDCODE0:0\uFFFD';
    assert.equal(
        convertHtmlToMarkdown(`${literal} then \`${literal}\` and <b>real</b>.`),
        `${literal} then \`${literal}\` and **real**.`,
    );
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
