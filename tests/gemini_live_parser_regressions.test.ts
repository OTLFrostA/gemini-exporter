import { describe as __suiteDescribe } from 'node:test';
import { type GeminiStructuredDocument } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseGeminiBody } from "../src/l1/parsers/gemini/shared/contentAdapter.js";
import { GM_TEX_003_BAR_ALIASES } from "../src/l1/parsers/gemini/shared/markdownCompatibility.js";
import { recoverLiteralMath } from "../src/l1/parsers/gemini/shared/literalMathRecovery.js";
import { chatGPTTimestamp } from "../src/l1/parsers/chatgpt/timestamp.js";
import { claudeTimestamp } from "../src/l1/parsers/claude/parseList.js";
import { grokTimestamp } from "../src/l1/parsers/grok/source.js";
import { payloadToMs } from "../src/l1/parsers/gemini/rpc/payload.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { test as test__s2 } from "node:test";
import { parseGeminiRpcConversation } from "../src/l1/parsers/gemini/rpc/parseConversation.js";
import { parseGeminiTakeoutConversation } from "../src/l1/parsers/gemini/takeout/parseConversation.js";
import { detailGen as geminiDetailGen } from "./fixtures/providers/geminiDetail.js";
import katex from "katex";
import { normalizeTextUnderscores } from "../src/shared/utils/latexCompatibility.js";
import { parseGeminiPrompt } from "../src/l1/parsers/gemini/shared/contentAdapter.js";

__suiteDescribe("gemini_live_parser_regressions", () => {
test('live line-start display fence remains a block without a preceding blank line', () => {
    const raw = readFileSync('tests/fixtures/provider/math/gm_md_004_evidence.md', 'utf8').split('-->\n')[1];
    const blocks = parseGeminiBody(raw);
    assert.deepEqual(blocks.map(b => b.type), ['paragraph', 'math']);
    assert.equal(blocks[1].type === 'math' && blocks[1].source, 'A(a, \\lambda) = \\pm 1, \\quad B(b, \\lambda) = \\pm 1');
});

test('display math splits a list paragraph and retains trailing authored prose', () => {
    const blocks = parseGeminiBody('* **零向量**：当 $x = 0$ 时\n  $$H = I, \\quad \\tau = 0, \\quad v = 0$$\n  无需执行消元。');
    assert.equal(blocks[0].type, 'list');
    if (blocks[0].type !== 'list') return;
    assert.deepEqual(blocks[0].items[0].blocks.map(b => b.type), ['paragraph', 'math', 'paragraph']);
    assert.ok(JSON.stringify(blocks).includes('无需执行消元。'));
    const inline = parseGeminiBody('inline $$ x \\$ y $$ text');
    assert.deepEqual(inline.map(b => b.type), ['paragraph']);
});

test('Gemini code preserves its final physical newline, indentation and blank lines', () => {
    for (const code of ['if x:\n    run()\n', 'run()\n\n']) {
        const raw = '```python\n' + code + '```';
        const native: GeminiStructuredDocument = { children: [{ nodeType: 1, code, info: 'python' }] };
        assert.deepEqual(parseGeminiBody(raw), parseGeminiBody(raw, native));
    }
    assert.equal(parseGeminiBody('```python\nrun()')[0].type === 'code' && (parseGeminiBody('```python\nrun()')[0] as {code: string}).code, 'run()');
    assert.deepEqual(parseGeminiBody('```\n```'), [{ type: 'code', code: '' }]);
    assert.deepEqual(parseGeminiBody('> ```python\n> run()\n> ```'), [{ type: 'quote', blocks: [{ type: 'code', code: 'run()\n', language: 'python' }] }]);
});

test('evidence-backed exact bar aliases normalize only parsed math, preserving norm distinction', () => {
    const fixture = JSON.parse(readFileSync(GM_TEX_003_BAR_ALIASES.evidence, 'utf8'));
    const native: GeminiStructuredDocument = { children: [{ nodeType: 12, FTa: fixture.structured }] };
    assert.deepEqual(parseGeminiBody('$$' + fixture.markdown + '$$'), parseGeminiBody('', native));
    assert.equal(GM_TEX_003_BAR_ALIASES.transform('\\Vert{}x\\Vert{} + \\vert{}y\\vert{}'), '\\|x\\| + |y|');
    assert.equal(GM_TEX_003_BAR_ALIASES.transform('\\\\Vert{}'), '\\\\Vert{}');
    const source = '`\\Vert{}` and \\Vert{}\n\n```tex\n\\Vert{}\n```';
    assert.ok(JSON.stringify(parseGeminiBody(source)).includes('\\\\Vert{}'));
});

test('captured native emphasis corruption recovers Q-star from its raw Markdown paragraph', () => {
    const fixture = JSON.parse(readFileSync('tests/fixtures/provider/math/gm_md_005_evidence.json', 'utf8'));
    const diagnostics: import('../src/shared/diagnostics/diagnostic.js').Diagnostic[] = [];
    const content = parseGeminiBody(fixture.markdown, fixture.structured, { diagnostics, sourceRef: { providerId: 'gemini' } });
    assert.deepEqual(content, parseGeminiBody(fixture.markdown));
    assert.ok(JSON.stringify(content).includes('Q^* = 30'));
    assert.equal(diagnostics[0]?.code, 'GEMINI_LITERAL_MATH_RECOVERED');
    const independent = parseGeminiBody(fixture.markdown, fixture.structured,
        { diagnostics: [], sourceRef: { providerId: 'gemini' }, recoverLiteralMath: false });
    assert.notDeepEqual(content, independent, 'audit must still expose the original provider defect');
});

test('literal math recovery rejects unrelated prose, ambiguous matches, code and citations', () => {
    const native = () => parseGeminiBody('Result $Q^ = 30$.');
    const target = parseGeminiBody('Result **$Q^* = 30$**.');
    const rawNative = () => [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text: 'Result $Q^ = 30$.' }] }];
    const recovered = rawNative();
    assert.equal(recoverLiteralMath(recovered, target), 1);
    assert.deepEqual(recovered, target);
    assert.equal(recoverLiteralMath(rawNative(), [...target, ...target]), 0);
    assert.equal(recoverLiteralMath(rawNative(), parseGeminiBody('Different **$Q^* = 30$**.')), 0);
    assert.equal(recoverLiteralMath(parseGeminiBody('`Result $Q^ = 30$.`'), target), 0);
    const cited = rawNative();
    const withCitation: import('../src/l2/content/blocks.js').BlockNode[] = [{ type: 'paragraph', children: [
        ...cited[0].children, { type: 'citationRef', citationId: 'source' },
    ] }];
    assert.equal(recoverLiteralMath(withCitation, target), 0);
    assert.equal(recoverLiteralMath(native(), target), 0, 'already parsed native math stays literal');
    assert.equal(recoverLiteralMath(parseGeminiBody('Price $10 and $20.'), target), 0);
});
});

__suiteDescribe("l1-source-timestamps", () => {
test('ChatGPT source timestamps normalize seconds and reject unsafe or fabricated time', () => {
    assert.equal(chatGPTTimestamp(1700000000.125), 1700000000125);
    assert.equal(claudeTimestamp(1700000000.1259), 1700000000125);
    assert.equal(grokTimestamp('2023-11-14T22:13:20Z'), 1700000000000);
    assert.equal(grokTimestamp(1700000000), undefined);
    assert.equal(chatGPTTimestamp(1700000000123), 1700000000123);
    assert.equal(chatGPTTimestamp(1700000000.1259), 1700000000125);
    assert.equal(chatGPTTimestamp(1700000000123.9), 1700000000123);
    assert.equal(chatGPTTimestamp('2023-11-14T22:13:20Z'), 1700000000000);
    for (const value of [null, undefined, 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2, 'invalid']) {
        assert.equal(chatGPTTimestamp(value), undefined);
    }
});

test('Gemini native source time accepts characterized tuples but never unsafe epoch values', () => {
    assert.equal(payloadToMs([1700000000, 123456789]), 1700000000123);
    assert.equal(payloadToMs([1792011603, 510828000]), 1792011603510);
    assert.equal(payloadToMs([1700000000, 123999999]), 1700000000123);
    assert.equal(payloadToMs([1700000000, 999999999]), 1700000000999);
    assert.equal(payloadToMs(1700000000.1259), 1700000000125);
    assert.equal(payloadToMs(1700000000123.9), 1700000000123);
    assert.equal(payloadToMs(1700000000), 1700000000000);
    assert.equal(payloadToMs(1700000000123), 1700000000123);
    for (const value of [[1700000000, -1], [1700000000, 1000000000],
        [1700000000, NaN], [Number.MAX_SAFE_INTEGER + 2, 0], 0, -1, NaN, Infinity]) {
        assert.equal(payloadToMs(value), null);
    }
});
});

__suiteDescribe("timestamp_honesty", () => {
test__s2('timestamp_honesty - RPC Domain messages omit timestamps when source dates are absent', () => {
    const { conversation } = parseGeminiRpcConversation(geminiDetailGen('G_TIMESTAMP_HONESTY_01'), { account: fixtureAccount('gemini'), providerId: 'gemini' });
    assert.equal(conversation.detail.messages.length, 2);
    assert.ok(conversation.index, 'conversation index must exist');
    assert.equal(Object.hasOwn(conversation.index, 'updatedAt'), false, 'unknown updatedAt must be omitted');
    assert.equal(Object.hasOwn(conversation.index, 'createdAt'), false, 'unknown createdAt must be omitted');
    assert.equal(Object.hasOwn(conversation.index, 'activityAt'), false, 'unknown activityAt must be omitted');
    assert.equal(Object.hasOwn(conversation.detail, 'savedAt'), false, 'unknown savedAt must be omitted');
    for (const message of conversation.detail.messages) {
        assert.equal(Object.hasOwn(message, 'timestamp'), false, 'unknown message timestamp must be omitted');
    }
});

test__s2('timestamp_honesty - Takeout Domain messages omit dates instead of fabricating now', () => {
    const htmlText = `<div class="outer-cell"><a href="https://gemini.google.com/app/no_timestamp">Chat</a>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Question<br><p>Answer</p></div></div>`;
    const { conversation } = parseGeminiTakeoutConversation({ htmlText }, { account: fixtureAccount('gemini'), providerId: 'gemini' });
    assert.equal(conversation.detail.messages.length, 2);
    assert.ok(conversation.index, 'conversation index must exist');
    assert.equal(Object.hasOwn(conversation.index, 'updatedAt'), false, 'unknown updatedAt must be omitted');
    assert.equal(Object.hasOwn(conversation.index, 'createdAt'), false, 'unknown createdAt must be omitted');
    assert.equal(Object.hasOwn(conversation.index, 'activityAt'), false, 'unknown activityAt must be omitted');
    assert.equal(Object.hasOwn(conversation.detail, 'savedAt'), false, 'unknown savedAt must be omitted');
    for (const message of conversation.detail.messages) {
        assert.equal(Object.hasOwn(message, 'timestamp'), false, 'unknown message timestamp must be omitted');
    }
});
});

__suiteDescribe("gemini_text_math", () => {
test('captured text identifiers match Gemini display and render as valid MathML', () => {
    const source = readFileSync('tests/fixtures/provider/math/gm_tex_002_evidence.tex', 'utf8').split('\n')[2];
    const expected = String.raw`\text{run\_length} \leftarrow \text{run\_length} + 1`;
    assert.equal(normalizeTextUnderscores(source), expected);
    assert.equal(normalizeTextUnderscores(expected), expected);
    assert.throws(() => katex.renderToString(source, { throwOnError: true }));
    assert.match(katex.renderToString(expected, { throwOnError: true, output: 'mathml' }), /<mtext>run_length<\/mtext>/);
    const blocks = parseGeminiBody('$$\n' + source + '\n$$');
    assert.deepEqual(blocks, [{ type: 'math', source: expected }]);
});

test('only math nodes change, including nested lists, tables and structured math', () => {
    const source = String.raw`\text{run_length}`;
    const expected = String.raw`\text{run\_length}`;
    const blocks = parseGeminiBody('- **$' + source + '$**\n\n| Value |\n| --- |\n| $' + source + '$ |');
    const list = blocks[0], table = blocks[1];
    assert.equal(list.type, 'list');
    assert.ok(JSON.stringify(list).includes(JSON.stringify(expected).slice(1, -1)));
    assert.equal(table.type, 'table');
    assert.ok(JSON.stringify(table).includes(JSON.stringify(expected).slice(1, -1)));
    assert.deepEqual(parseGeminiBody('', { children: [{ nodeType: 12, FTa: source }] }), [{ type: 'math', source: expected }]);
    assert.deepEqual(parseGeminiBody('`' + source + '`'), [{ type: 'paragraph', children: [{ type: 'inlineCode', code: source }] }]);
    assert.deepEqual(parseGeminiPrompt(source), [{ type: 'paragraph', children: [{ type: 'text', text: source }] }]);
});

test('subscripts, escaped macros, existing escapes and unsupported nested groups stay intact', () => {
    for (const source of [String.raw`x_i + a_{run_length}`, String.raw`\text{run\_length}`,
        String.raw`\\text{run_length}`, String.raw`\text{nested{run_length}}`, String.raw`\texttt{run_length}`]) {
        assert.equal(normalizeTextUnderscores(source), source);
    }
    assert.equal(normalizeTextUnderscores(String.raw`\text{a\\_b}`), String.raw`\text{a\\\_b}`);
});
});

__suiteDescribe("provider-gemini-markup-sanitization", () => {
/**
 * tests/provider-gemini-markup-sanitization.test.ts
 * Runtime provider content-adapter and Document renderer contract.
 *
 * Verifies that Gemini provider-specific structured markup:
 * - <ElicitationsGroup message="..."> ... </ElicitationsGroup>
 * - <Elicitation label="..." query="..." />
 * - <FollowUp label="..." query="..." />
 * - <GenerateWidget id="..." />
 *
 * is intercepted and sanitized at the Gemini content adapter,
 * preventing any proprietary metadata syntax from leaking into Domain content
 * or final HTML / Markdown exports.
 */

const test = require('node:test');
const assert = require('node:assert');

const { parseGeminiBody, parseSourceReasoning } = require('../src/l1/parsers/gemini/shared/contentAdapter.js');

test('Gemini interactive markup is removed by provider content adapter before source AST output', () => {
    const rawContent = [
        '经典比特（Bit）与量子比特（Qubit）有着本质区别：',
        '',
        '| 对比维度 | 经典比特 (Bit) | 量子比特 (Qubit) |',
        '| :--- | :--- | :--- |',
        '| **叠加态** | **确定状态**<br>0 或 1 | **连续叠加**<br>线性组合 |',
        '',
        '<ElicitationsGroup message="想要进一步探索量子计算的相关概念，可以尝试以下方向：">',
        '  <Elicitation label="了解量子退相干（Decoherence）的物理机制" query="请详细解释量子退相干（Decoherence）的物理机制以及它是如何破坏量子叠加态的。"/>',
        '  <Elicitation label="对比 Shor 算法与 Grover 算法的原理及加速效果" query="请对比 Shor 算法与 Grover 算法的基本原理，以及它们相对于经典算法分别带来了怎样的加速效果。"/>',
        '</ElicitationsGroup>',
        '',
        '<FollowUp label="想了解阿斯佩（Aspect）等经典实验如何闭合检测漏洞与定域漏洞吗？" query="详细解释阿斯佩实验。"/>',
        '',
        '<GenerateWidget id="widget_interactive_quantum_sim" type="simulator" />',
        '',
        '总结：量子比特具备指数级并行潜力。',
    ].join('\n');

    // This is the same provider adapter used by native Gemini RPC parsing.
    // Do not re-import the body through the historical record compatibility fixture.
    const reasoning = parseSourceReasoning(
        '思考过程：\n<Elicitation label="内部测试"/>\n分析比特与量子比特。',
        { diagnostics: [], sourceRef: { providerId: 'gemini', locator: 'messages[0].reasoning' } },
    );
    const msg = { content: parseGeminiBody(rawContent), reasoning };
    assert.ok(msg.reasoning?.length, 'authored reasoning must remain visible');
    assert.ok(JSON.stringify(msg.reasoning).includes('分析比特与量子比特'));

    // Domain content assertions
    const allText = JSON.stringify(msg.content);
    assert.strictEqual(allText.includes('ElicitationsGroup'), false, 'Domain content blocks must not contain ElicitationsGroup');
    assert.strictEqual(allText.includes('Elicitation'), false, 'Domain content blocks must not contain Elicitation');
    assert.strictEqual(allText.includes('FollowUp'), false, 'Domain content blocks must not contain FollowUp');
    assert.strictEqual(allText.includes('GenerateWidget'), false, 'Domain content blocks must not contain GenerateWidget');

    // Valid user content is preserved
    assert.ok(allText.includes('经典比特（Bit）与量子比特（Qubit）'));
    assert.ok(allText.includes('量子比特具备指数级并行潜力。'));

});
});
