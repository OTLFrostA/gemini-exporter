import { describe as __suiteDescribe } from 'node:test';
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { API } from "typescript/unstable/sync";
import { markdownBoundaryViolations } from "./helpers/markdownBoundary.js";
import { type DomainConversationWithDetail } from "../src/l2/conversation.js";
import { type DocumentAst } from "../src/l3b/ast/ast.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { restoreDomainSnapshot } from "../src/l2/runtimeValidation.js";
import { useIndexStorage } from "./helpers/indexStorage.js";
import test__s2 from "node:test";
import { composeFixture } from "./helpers/documentFixture.js";
import { serializeDomainJson } from "../src/l4/format/json/serializeDomainJson.js";
import { convertHtmlToMarkdown } from "../src/l1/parsers/shared/html/htmlToMarkdown.js";
import { runExport } from "../src/application/export/runExport.js";
import { v2ExportHost } from "./helpers/v2ExportHost.js";
import { exportRequest } from "./helpers/v2ExportHost.js";
import { exportKey } from "./helpers/v2ExportHost.js";
import { seedExportConversation } from "./helpers/v2ExportHost.js";
import { getExportRecord } from "../src/l3a/storageService.js";

__suiteDescribe("document-markdown", () => {
function fixture(): DomainConversationWithDetail {
    return JSON.parse(readFileSync('tests/fixtures/document-domain/document-markdown.json', 'utf8'));
}

function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.freeze(value); Object.values(value).forEach(freeze);
}

test('Markdown backend preserves merged table cells while the neutral tree retains all headers', () => {
    const input = fixture(); const before = JSON.stringify(input); freeze(input);
    const composed = composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input)));
    assert.deepEqual(composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input))), composed);
    assert.equal(JSON.stringify(input), before);
    const table = composed.messages[0].blocks.find(block => block.type === 'table')!; assert.equal(table.type, 'table');
    if (table.type !== 'table') throw new Error('Expected table');
    assert.equal(table.headerRows.length, 2); assert.equal(table.rows.length, 1);
    assert.equal(table.headerRows[0][0].colSpan, 2); assert.equal(table.headerRows[0][0].rowSpan, 2);
    const md = renderDocumentMarkdown(composed, { a: 'assets/a.png' });
    assert.ok(md.includes('<table>') && md.includes('colspan="2"') && md.includes('rowspan="2"'));
    assert.ok(md.includes('Second header'), 'all authored table headers remain visible');
});

test('Markdown consumes only JSON display choices, explicit time and prepared paths', () => {
    const document = composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture())));
    const restored: DocumentAst = JSON.parse(JSON.stringify(document));
    const resources = { a: 'assets/a.png' };
    assert.equal(renderDocumentMarkdown(restored, resources), renderDocumentMarkdown(document, resources));
    const md = renderDocumentMarkdown(restored, resources);
    assert.ok(!md.includes('exported:')); assert.ok(md.includes('**123**'));
    assert.equal(md.match(/!\[/g)?.length, 2); assert.ok(md.includes('Preserved description'));
    restored.messages[0].role = 'developer';
    restored.messages[0].sources = [{ id: 'ignored', label: 'Chosen source', number: 7 }];
    const disclosure = restored.messages[0].blocks.find(block => block.type === 'disclosure');
    if (!disclosure || disclosure.type !== 'disclosure') throw new Error('Expected disclosure');
    disclosure.title = 'Chosen disclosure';
    const changed = renderDocumentMarkdown(restored, resources);
    assert.ok(changed.includes('## 🛠 Developer')); assert.ok(changed.includes('> 🌐 **Sources:**\n> [7] [Chosen source]'));
    assert.ok(changed.includes('<details>\n<summary>Chosen disclosure</summary>'), 'disclosures are collapsed by default');
    assert.ok(renderDocumentMarkdown(document, {}).includes('[Image unavailable:'));
    assert.ok(renderDocumentHtml(document, resources).html.includes('<strong>123</strong>'));
});

test('Markdown renderer owns unavailability and emits diagnostics without remote embedding', () => {
    const document = composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture())));
    const output = renderDocumentMarkdown(document, {});
    assert.ok(output.includes('[Image unavailable:')); assert.ok(output.includes('**123**'));
    assert.ok(!output.includes('https://remote'));
    assert.deepEqual(composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture()))), document);
});

test('Markdown renderer cannot depend on provider, Domain or storage services', () => {
    const code = readFileSync('src/l4/format/markdown/renderMarkdown.ts', 'utf8');
    const path = resolve('src/l4/format/markdown/renderMarkdown.ts');
    const api = new API({ cwd: process.cwd() });
    try {
        const snapshot = api.updateSnapshot({ openFiles: [path] });
        const source = snapshot.getDefaultProjectForFile(path)?.program.getSourceFile(path);
        assert.ok(source, 'compiler must parse the actual renderer');
        assert.deepEqual(markdownBoundaryViolations(source), []);
        snapshot.dispose();
    } finally { api.close(); }
    assert.doesNotMatch(code, /\bDate\.now\s*\(/, 'renderers must not invent export timestamps');
    assert.doesNotMatch(code, /\.storageRef\b/, 'renderers must not inspect storage-only fields');
});

test('Markdown front matter reads identity and source dates only from Document AST', () => {
    const input = fixture(); input.index.updatedAt = 1000;
    const document = composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input)));
    document.title = 'true';
    document.metadata!.id = 'null';
    const markdown = renderDocumentMarkdown(document, {});
    assert.ok(markdown.includes('title: "true"'));
    assert.ok(markdown.includes('id: "null"'));
    assert.ok(!/^url:/m.test(markdown), 'L3b metadata no longer supplies provider URLs');
    assert.ok(markdown.includes('updated: "1970-01-01T00:00:01.000Z"'));
    assert.ok(!/^exported:/m.test(markdown), 'renderer must not invent an export timestamp');
    // @ts-expect-error Metadata is required; still reject malformed runtime callers explicitly.
    assert.throws(() => renderDocumentMarkdown({ ...document, metadata: undefined }, {}), /metadata is required/);
});

test('Markdown math fences outgrow source dollar runs without changing ordinary formulas', () => {
    const input = fixture();
    const document = composeDomainDocument(validateParserDomain(input), fixtureAccountFor(validateParserDomain(input)));
    for (const [source, fence] of [
        ['x = 1\n$$\ny = 2', '$$$'],
        ['x = 1\n$$$$\ny = 2', '$$$$$'],
        ['E = mc^2', '$$'],
    ]) {
        document.messages[0].blocks = [{ type: 'math', source }];
        const markdown = renderDocumentMarkdown(document, {});
        assert.ok(markdown.includes(fence + '\n' + source + '\n' + fence), 'math source needs safe fence ' + fence);
    }
});

test('Markdown dependency gate rejects independent syntax and path bypasses without matching inert text', () => {
    const forbidden = [
        `import '../../../l1/parsers/gemini/rpc/parseConversation.js';`,
        `const load = () => import('../../../l2/conversation.js');`,
        `const storage = require('../../../l3a/storageService.js');`,
        `import storage = require('../../../l3a/storageService.js');`,
        `export { getIndex as read } from '../../../l3a/storageService.js';`,
        `export * from '../../../l2/conversation.js';`,
        `import { getIndex as read } from '../../../l3a/storageService.js';`,
        `import { value } from '../../../shared/../l2/conversation.js';`,
        'const load = () => import(`../../../l2/conversation.js`);',
        `import { type DomainMessage, value } from '../../../l2/conversation.js';`,
        `const load = (path: string) => import(path);`,
    ];
    const safe = [
        `import type { DomainMessage } from '../../../l2/conversationDetail.js';`,
        `import { type DomainMessage } from '../../../l2/conversationDetail.js';`,
        `import type Domain = require('../../../l2/conversation.js');`,
        `type Message = import('../../../l2/conversationDetail.js').DomainMessage;`,
        `export type { DomainMessage } from '../../../l2/conversationDetail.js';`,
        `export { type DomainMessage } from '../../../l2/conversationDetail.js';`,
        `import { renderDocumentMarkdown as render } from './renderMarkdown.js';`,
        `// import '../../../l2/conversation.js';\nconst text = "require('../../../l3a/storageService.js')";`,
    ];
    const cases = [...forbidden, ...safe];
    const virtual = new Map(cases.map((source, index) => [resolve(`tests/__markdown_boundary_${index}.ts`), source]));
    const api = new API({ cwd: process.cwd(), fs: {
        readFile: path => virtual.get(path), fileExists: path => virtual.has(path) ? true : undefined,
    } });
    try {
        const snapshot = api.updateSnapshot({ openFiles: [...virtual.keys()] });
        let index = 0;
        for (const [path, code] of virtual) {
            const source = snapshot.getDefaultProjectForFile(path)?.program.getSourceFile(path);
            assert.ok(source);
            const violations = markdownBoundaryViolations(source);
            if (index++ < forbidden.length) assert.ok(violations.length, code);
            else assert.deepEqual(violations, [], code);
        }
        snapshot.dispose();
    } finally { api.close(); }
});
});

__suiteDescribe("document-markdown-contract", () => {
const { historicalFixture } = require('./helpers/nativeFixture.js');

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderDocumentMarkdown } = require('../src/l4/format/markdown/renderMarkdown.js');
const { composeDomainDocument } = require('../src/l3b/compose/composeDomainDocument.js');
const exportDomainMarkdown = (conversation: Parameters<typeof composeDomainDocument>[0], account: Parameters<typeof composeDomainDocument>[1]) => renderDocumentMarkdown(composeDomainDocument(conversation, account), {});
const renderFixtureMarkdown = (parsed: ReturnType<typeof historicalFixture>): string => renderDocumentMarkdown(composeDomainDocument(parsed.conversation, parsed.account), {});
const txt = (text: string) => ({ type: 'text', text });
const para = (text: string) => ({ type: 'paragraph', children: [txt(text)] });
function domainFixture(blocks: any[], extra: any = {}): DomainConversationWithDetail {
    return restoreDomainSnapshot({ index: { key: fixtureKey(String('c'), 'gemini'),   titleSource: "derived",   title: 'Title' }, detail: { key: fixtureKey(String('c'), 'gemini'), quality: { status: 'unknown' }, assets: extra.assets ?? [], messages: [{ id: 'm', role: 'assistant', content: blocks, reasoning: extra.reasoning, citations: extra.citations ?? [] }] } });
}
const render = (blocks: any[], extra: any = {}) => renderDocumentMarkdown(composeDomainDocument(domainFixture(blocks, extra), fixtureAccountFor(domainFixture(blocks, extra))), extra.resources ?? {});

test('Markdown literal text escapes thematic breaks and setext underlines without changing structural rules', () => {
    for (const [source, escaped] of [['---', '\\---'], ['***', '\\*\\*\\*'], ['___', '\\_\\_\\_'], ['- - -', '\\- - -'], ['===', '\\==='], ['--', '\\--'], ['  ---  ', '  \\---  '], ['    ---', '    ---'], ['\t---', '\t---']]) {
        const b = domainFixture([para(`Text above\n${source}`), { type: 'thematicBreak' }]);
        b.detail.messages[0].role = 'user';
        const md = exportDomainMarkdown(b, fixtureAccountFor(b));
        assert.ok(md.includes(`Text above\n${escaped}`), JSON.stringify(source));
        assert.ok(md.endsWith('---\n'), 'structural thematic breaks remain Markdown');
    }
    assert.ok(render([para(''), para('ordinary a-b = c')]).includes('ordinary a-b = c'));
});

test('Markdown code serialization preserves existing final newlines without adding a blank line', () => {
    for (const source of ['run()', 'run()\n', 'run()\n\n']) {
        const expected = '```python\n' + source + (source.endsWith('\n') ? '' : '\n') + '```';
        assert.ok(render([{ type: 'code', language: 'python', code: source }]).includes(expected));
    }
});

test('Markdown export envelope uses Domain metadata and omits absent optional fields', async () => {
    const b = domainFixture([]); Object.assign(b.index, { createdAt: Date.parse('2026-01-01T00:00:00Z') });
    const md = await exportDomainMarkdown({ ...b, index: { ...b.index, updatedAt: Date.parse('2026-01-02T00:00:00Z') } }, fixtureAccountFor({ ...b, index: { ...b.index, updatedAt: Date.parse('2026-01-02T00:00:00Z') } }));
    assert.ok(md.startsWith('---\ntitle: "Title"\nid: "c"\nprovider: "gemini"\ndate: "2026-01-01T00:00:00.000Z"\nupdated: "2026-01-02T00:00:00.000Z"\ntags:'));
    assert.ok(md.includes('tags:\n  - gemini-export\n---\n\n# Title'));
    const minimal = await exportDomainMarkdown(domainFixture([]), fixtureAccountFor(domainFixture([]))); assert.ok(!/^url:|^date:|^updated:/m.test(minimal));
});

test('Markdown paragraph preserves nested inline formatting and line breaks', () => {
    const md = render([{ type: 'paragraph', children: [txt('plain '), { type: 'strong', children: [{ type: 'emphasis', children: [txt('nested')] }] }, txt(' '), { type: 'strikethrough', children: [txt('gone')] }, { type: 'lineBreak', kind: 'soft' }, { type: 'inlineCode', code: 'x`y' }, { type: 'lineBreak', kind: 'hard' }, { type: 'link', href: 'https://example.com', children: [txt('link')] }] }]);
    assert.ok(md.includes('plain ***nested*** ~~gone~~\n``x`y``  \n[link](https://example.com/)'));
});

test('Markdown emits headings and every message role in source order', () => {
    const b = domainFixture([{ type: 'heading', level: 3, children: [txt('Section')] }]);
    b.detail.messages = (['user', 'assistant', 'system', 'developer', 'unknown'] as const).map((role, i) => ({ id: `${i}`, role, content: b.detail.messages[0].content }));
    const md = renderDocumentMarkdown(composeDomainDocument(b, fixtureAccountFor(b)), {}); const headings = ['## 👤 You', '## 🤖 Assistant', '## ⚙️ System', '## 🛠 Developer', '## Message'];
    assert.deepEqual(headings.map((h) => md.indexOf(h)), headings.map((h) => md.indexOf(h)).sort((a, b) => a - b));
    assert.ok(md.includes('### Section'));
});

test('Markdown nested lists preserve ordered start and multiline item indentation', () => {
    const md = render([{ type: 'list', ordered: true, start: 3, items: [{ blocks: [para('first'), { type: 'list', ordered: false, items: [{ blocks: [para('nested')] }] }] }, { blocks: [para('second')] }] }]);
    assert.ok(md.includes('3. first\n   \n   - nested\n4. second'));
});

test('Markdown quotes and thematic breaks serialize without losing nested text', () => {
    assert.ok(render([{ type: 'quote', blocks: [para('quote'), para('more')] }, { type: 'thematicBreak' }]).includes('> quote\n> \n> more\n\n---'));
});

test('Markdown code uses standard fences longer than embedded runs and labels metadata', () => {
    const md = render([{ type: 'code', code: '```\n# literal', language: 'md', meta: 'demo' }]);
    assert.ok(md.includes('**demo**\n\n````md\n```\n# literal\n````'));
});

test('Markdown inline and display math use the original LaTeX source', () => {
    const md = render([{ type: 'paragraph', children: [{ type: 'inlineMath', source: '\\alpha' }] }, { type: 'math', source: '\\frac{a}{b}' }]);
    assert.ok(md.includes('$\\alpha$')); assert.ok(md.includes('$$\n\\frac{a}{b}\n$$'));
});

test('Markdown tables serialize alignment, captions, spans, pipes and newlines visibly', () => {
    const md = render([{ type: 'table', caption: [txt('caption')], columns: [{ align: 'left' }, { align: 'right' }], headerRows: [{ cells: [{ children: [txt('A')] }, { children: [txt('B')] }] }], rows: [{ cells: [{ children: [txt('x|y\nz')], colSpan: 2 }] }] }]);
    assert.ok(md.includes('<table>') && md.includes('<caption>caption</caption>'));
    assert.ok(md.includes('<td colspan="2">x|y\nz</td>'), 'merged cell and its original text are preserved');
});

test('Markdown table separators preserve backslashes and formatted inline content', () => {
    const md = render([{ type: 'table', rows: [{ cells: [{ children: [txt('a\\b|c '), { type: 'strong', children: [txt('bold')] }, { type: 'inlineCode', code: 'x|y' }] }] }] }]);
    assert.ok(md.includes('a\\\\b\\|c **bold**`x\\|y`'));
});

test('Markdown block and inline images use prepared local bindings only', () => {
    const md = render([{ type: 'image', assetId: 'a', alt: 'block', caption: [txt('caption')] }, { type: 'paragraph', children: [{ type: 'image', assetId: 'a', alt: 'inline' }] }], { assets: [{ id: 'a', kind: 'image', sourceUri: 'https://remote/pic.png' }], resources: { a: 'assets/pic.png' } });
    assert.ok(md.includes('![block](assets/pic.png)\n\ncaption')); assert.ok(md.includes('![inline](assets/pic.png)')); assert.ok(!md.includes('https://remote'));
});

test('Markdown missing and remote-only images remain visible without remote embedding', () => {
    const md = render([{ type: 'image', assetId: 'a' }, { type: 'paragraph', children: [{ type: 'image', assetId: 'missing', alt: 'inline' }] }], { assets: [{ id: 'a', kind: 'image', name: 'pic.png', sourceUri: 'https://remote/pic.png' }, { id: 'missing', kind: 'image' }] });
    assert.ok(md.includes('[Image unavailable: pic.png]')); assert.ok(md.includes('[Image unavailable: inline]')); assert.ok(!md.includes('https://remote'));
});

test('Markdown files use local links or a visible unavailable label', () => {
    const md = render([{ type: 'file', assetId: 'a', description: [txt('description')] }, { type: 'file', assetId: 'none', label: 'missing.pdf' }], { assets: [{ id: 'a', kind: 'file', name: 'file.pdf' }, { id: 'none', kind: 'file', name: 'missing.pdf' }], resources: { a: 'files/file.pdf' } });
    assert.ok(md.includes('[file.pdf](files/file.pdf)\n\ndescription')); assert.ok(md.includes('[Attachment unavailable: missing.pdf]'));
});

test('Markdown thought blocks contain nested Markdown inside details', () => {
    assert.ok(render([], { reasoning: [para('thinking')] }).includes('<details>\n<summary>Thinking Process</summary>\n\nthinking\n\n</details>'));
});

test('Markdown inline citations link URLs and retain labels without URLs', () => {
    const md = render([{ type: 'paragraph', children: [{ type: 'citationRef', citationId: 'c', label: 'read' }, txt(' '), { type: 'citationRef', citationId: 'd', label: 'offline' }] }], { citations: [{ id: 'c', title: 'Web', url: 'https://example.com' }, { id: 'd', title: 'Local' }] });
    assert.ok(md.includes('[read](https://example.com/) [offline]'));
});

test('Markdown message Sources preserve citation order after the body', () => {
    const b = domainFixture([para('body')], { citations: [{ id: 'c', title: 'Web', url: 'https://example.com' }, { id: 'd', title: 'Local' }] }); b.detail.messages[0].citations!.reverse();
    assert.ok(renderDocumentMarkdown(composeDomainDocument(b, fixtureAccountFor(b)), {}).includes('body\n\n> 🌐 **Sources:**\n> [1] [Local]\n> [2] [Web](https://example.com/)'));
});

test('Markdown unknown content remains visible as escaped text', () => {
    const md = render([{ type: 'unknown', sourceType: 'widget', text: '<script>opaque</script>' }]);
    assert.ok(md.includes('Unsupported · widget')); assert.ok(md.includes('&lt;script&gt;opaque&lt;/script&gt;')); assert.ok(!md.includes('<script>'));
});

test('Gemini structuredContent reaches Document Markdown without using the string body', async () => {
    const result = renderFixtureMarkdown(historicalFixture({ id: 'c', title: 'Structured', messages: [{ id: 'm', role: 'model', content: 'wrong string', structuredContent: { children: [{ nodeType: 18, text: 'structured answer' }] } }] }));
    assert.ok(result.includes('structured answer')); assert.ok(!result.includes('wrong string'));
});

test('Gemini Markdown fallback reaches Document Markdown with semantic formatting', async () => {
    const result = renderFixtureMarkdown(historicalFixture({ id: 'c', title: 'Fallback', messages: [{ id: 'm', role: 'model', content: '**bold**\n\n```js\nconst x = 1;\n```' }] }));
    assert.ok(result.includes('**bold**')); assert.ok(result.includes('```js\nconst x = 1;\n```'));
});

test('Markdown escapes unsafe links, local paths and YAML title boundaries', async () => {
    const b = domainFixture([{ type: 'paragraph', children: [{ type: 'link', href: 'javascript:alert(1)', children: [txt('safe')] }, { type: 'image', assetId: 'a', alt: 'blocked' }] }], { assets: [{ id: 'a', kind: 'image', sourceUri: 'https://remote/pic.png' }] });
    b.index.title = 'Title"\nextra: yes'; const md = await exportDomainMarkdown({ ...b, index: { ...b.index, updatedAt: Date.parse('2026-01-02T00:00:00Z') } }, fixtureAccountFor({ ...b, index: { ...b.index, updatedAt: Date.parse('2026-01-02T00:00:00Z') } }));
    assert.equal(md.split('\n')[1], 'title: ' + JSON.stringify(b.index.title)); assert.ok(!md.includes('javascript:')); assert.ok(!md.includes('https://remote')); assert.ok(md.includes('[Image unavailable: blocked]'));
});

test('Document Markdown preserves both messages with duplicate source IDs', async () => {
    const result = renderFixtureMarkdown(historicalFixture({ id: 'c', messages: [{ id: 'm', role: 'user', content: 'one' }, { id: 'm', role: 'model', content: 'two' }] }));
    assert.ok(result.includes('one'));
    assert.ok(result.includes('two'));
});


test('Markdown table pipe and backslash cases preserve two columns and visible content', async () => {
    const { fromMarkdown } = await import('mdast-util-from-markdown');
    const { gfm } = await import('micromark-extension-gfm');
    const { gfmFromMarkdown } = await import('mdast-util-gfm');
    const samples = [
        { node: txt('a|b'), text: 'a|b' },
        { node: txt('a\\|b'), text: 'a\\|b' },
        { node: txt('a\\\\|b'), text: 'a\\\\|b' },
        { node: { type: 'inlineCode', code: 'a|b' }, text: 'a|b' },
        { node: { type: 'inlineCode', code: 'a\\|b' }, text: 'a\\|b' },
        { node: { type: 'link', href: 'https://example.com', children: [txt('a|b')] }, text: 'a|b' },
    ];
    const md = render([{ type: 'table', headerRows: [{ cells: [{ children: [txt('content')] }, { children: [txt('sentinel')] }] }],
        rows: samples.map(({ node }) => ({ cells: [{ children: [node] }, { children: [txt('kept')] }] })) }]);
    const tree = fromMarkdown(md, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
    const table: any = tree.children.find((node: any) => node.type === 'table');
    const visible = (node: any): string => node.type === 'html' ? '' : typeof node.value === 'string' ? node.value : (node.children ?? []).map(visible).join('');
    assert.ok(table, 'serialized output parses as a GFM table');
    assert.strictEqual(table.children.length, samples.length + 1);
    samples.forEach(({ text }, index) => {
        const row = table.children[index + 1];
        assert.strictEqual(row.children.length, 2, `two columns for ${JSON.stringify(text)}`);
        assert.strictEqual(visible(row.children[0]), text);
        assert.strictEqual(visible(row.children[1]), 'kept');
    });
});
});

__suiteDescribe("chat_formatter", () => {
useIndexStorage();
const { historicalFixture } = require('./helpers/nativeFixture.js');


const assert = require('node:assert');








test__s2('chat_formatter - formatMarkdownDocument', async () => {
    const mockChat = {
        id: '12345678',
        title: 'Quantum Physics Guide',
        url: 'https://gemini.google.com/app/12345678',
        timestamp: 1700000000000,
        messages: [
            { role: 'user', content: 'What is superposition?' },
            { role: 'model', content: 'Superposition is a fundamental principle of quantum mechanics.' }
        ]
    };

    const { document, resources } = await composeFixture(historicalFixture(mockChat).conversation);
    const markdown = renderDocumentMarkdown(document, resources);
    assert.ok(markdown.startsWith('---\n'), 'Markdown must start with YAML frontmatter delimiter');
    assert.ok(markdown.includes('\n---\n\n'), 'YAML frontmatter must close with --- delimiter');
    assert.ok(markdown.includes('title: "Quantum Physics Guide"'), 'Frontmatter must contain title key');
    assert.ok(markdown.includes('id: "12345678"'), 'Frontmatter must contain id key');
    assert.ok(!/^url:/m.test(markdown), 'Composer does not synthesize a source URL');
    assert.ok(markdown.includes('tags:\n  - gemini-export'), 'Frontmatter must contain gemini-export tag');
    assert.ok(markdown.includes('# Quantum Physics Guide'), 'Must render H1 title');
    assert.ok(markdown.includes('What is superposition?'), 'Must contain user message');
    assert.ok(markdown.includes('Superposition is a fundamental principle'), 'Must contain model message');
    const userIdx = markdown.search(/## 👤/);
    const modelIdx = markdown.search(/## 🤖/);
    assert.ok(userIdx !== -1 && modelIdx !== -1, 'Must include both user and model role headings');
    assert.ok(userIdx < modelIdx, 'User heading must precede model heading');
});


test__s2('chat_formatter - convertHtmlToMarkdown converts html elements safely', () => {
    const rawHtml = '<p>Here is a code snippet:</p><pre><code class="language-js">console.log(&quot;hello&quot;);</code></pre><p>And some <b>bold</b> and <i>italic</i> text with <br/>break.</p>';
    const md = convertHtmlToMarkdown(rawHtml);
    assert.ok(md.includes('```js'), 'Code block should have language');
    assert.ok(md.includes('console.log("hello");'), 'Entities should be unescaped');
    assert.ok(md.includes('**bold**'), 'Bold should be markdown');
    assert.ok(md.includes('*italic*'), 'Italic should be markdown');
    const fenceCount = (md.match(/```/g) || []).length;
    assert.strictEqual(fenceCount % 2, 0, 'Code fence backticks must be properly paired');
});

test__s2('htmlConverter preserves emphasis on strong and em tags with attributes', () => {
    const { convertHtmlToMarkdown } = require('../src/l1/parsers/shared/html/htmlToMarkdown.js');
    assert.strictEqual(convertHtmlToMarkdown('<strong class="x">bold</strong>'), '**bold**');
    assert.strictEqual(convertHtmlToMarkdown('<em data-x="1">italics</em>'), '*italics*');
});

test__s2('chat_formatter - convertHtmlToMarkdown converts html tables to GFM tables', () => {
    const tableHtml = '<table><thead><tr><th align="left">维度</th><th align="left">经典</th><th align="left">量子</th></tr></thead><tbody><tr><td>状态</td><td>0 或 1</td><td>叠加态<br>|psi></td></tr></tbody></table>';
    const md = convertHtmlToMarkdown(tableHtml);
    assert.ok(md.includes('| 维度 | 经典 | 量子 |'), 'Table header should be converted');
    assert.ok(md.includes('| --- | --- | --- |'), 'Table separator should be present');
    assert.ok(md.includes('| 状态 | 0 或 1 | 叠加态<br>\\|psi> |'), 'Table cells with pipe and br should be properly formatted');
    assert.ok(/\|\s*:?-{3,}:?\s*\|/.test(md), 'Matches table markdown regex');
});

test__s2('engine - unified export processes a batch, honors abort and completes an empty batch', async t => {
    const host = v2ExportHost(t);
    for (const id of ['queue-one', 'queue-two']) await seedExportConversation(id);
    const controller = new AbortController(); controller.abort();
    assert.equal((await runExport(exportRequest(['queue-one']), { signal: controller.signal })).aborted, true);
    assert.equal(host.clicks(), 0);
    assert.equal((await runExport(exportRequest([]))).exported, 0);
    assert.equal(host.clicks(), 0);
    const result = await runExport(exportRequest(['queue-one']));
    assert.equal(result.exported, 1); assert.equal(host.clicks(), 1);
});

test__s2('engine - L1 rejects a brand placeholder while L2 preserves the derived user question title', async () => {
    const { ingestIndexes } = require('../src/l2/ingestion.js');
    const { getIndex } = require('../src/l3a/storageService.js');
    const { parseGeminiIndexObservation } = require('../src/l1/parsers/gemini/parseIndexObservation.js');
    const key = exportKey('test_123');
    await ingestIndexes(key.accountId, [{ conversationId: key.conversationId,
        fields: { title: '如何设计微服务架构', titleSource: 'derived' } }]);
    await ingestIndexes(key.accountId, [parseGeminiIndexObservation({ id: key.conversationId,
        title: 'Google Gemini', titleSource: 'rpc' }, 'rpc-list')]);
    assert.equal((await getIndex(key))?.title, '如何设计微服务架构');
});



test__s2('engine - completion persists the delivered source version without a recovery session', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('completion', 100);
    const result = await runExport(exportRequest(['completion']));
    assert.equal(result.exported, 1); assert.equal(host.clicks(), 1);
    const record = await getExportRecord(exportKey('completion'));
    assert.equal(record?.chatTime, 100); assert.equal(record?.status, 'ok');
    assert.equal(Number.isSafeInteger(record?.exportedAt), true);
    const local = await chrome.storage.local.get(null);
    assert.equal(Object.hasOwn(local, 'gemini_last_export_session'), false);
});

test__s2('chat_formatter - natural language prompt > 400 chars with code keywords is never mangled into javascript fence', async () => {
    const longPrompt = 'Please explain the following architectural concepts in detail. In JavaScript and TypeScript, developers often ask why const and let were introduced to replace var in ES6, and how lexical scoping works with closures inside a function() declaration. ' + 'Extra discussion text for length padding. '.repeat(10);
    assert.ok(longPrompt.length > 400);
    const mockChat = {
        id: 'natural_lang_prompt_test',
        title: 'Variable Scoping',
        messages: [
            { role: 'user', content: longPrompt },
            { role: 'model', content: 'Here is the detailed explanation of const vs var.' }
        ]
    };
    const { document, resources } = await composeFixture(historicalFixture(mockChat).conversation);
    const markdown = renderDocumentMarkdown(document, resources);
    assert.ok(!markdown.includes('```javascript\nPlease explain'), 'Natural language prompt must not be wrapped in javascript code block');
    assert.ok(markdown.includes('Please explain the following architectural concepts'), 'Prompt content must remain plain text');
});

test__s2('focused formatters consume their declared inputs: Document AST for Markdown and trusted Domain for JSON', async () => {
    const parsed = historicalFixture({ id: 'c1', title: 'Test', messages: [{ role: 'user', content: 'hello' }] });
    const { document, resources } = await composeFixture(parsed.conversation);
    assert.ok(renderDocumentMarkdown(document, resources).includes('title: "Test"'));
    assert.ok(serializeDomainJson(parsed.conversation, parsed.account, {}).includes('"conversationId": "c1"'));
    assert.ok(convertHtmlToMarkdown('<b>bold</b>').includes('**bold**'));
});
});
