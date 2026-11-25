import { describe as __suiteDescribe } from 'node:test';
import { fixtureResourceResults } from "./helpers/documentFixture.js";
import { composeFixture } from "./helpers/documentFixture.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFixture } from "./helpers/documentFixture.js";
import { collectDocumentResources } from "../src/l3b/ast/resourceReferences.js";

__suiteDescribe("html-document-migration", () => {
const { historicalFixture } = require('./helpers/nativeFixture.js');
const { fixtureAccountFor } = require('./helpers/domainFixture.js');
const { composeDomainDocument } = require('../src/l3b/compose/composeDomainDocument.js');
const { renderDocumentHtml } = require('../src/l4/format/html/renderHtml.js');
/**
 * tests/html-document-migration.test.ts
 * Item 1 (P0): the Domain -> Document AST -> HTML interface preserves all content classes.
 *
 * History: this file originally compared the legacy toHtml() output with
 * the new production entry as migration evidence. Item 2 (P0) removed the
 * legacy toHtml() pipeline entirely; the remaining assertions verify the
 * Composer/Renderer boundary directly: turn count/order and no dropped content
 * class (text, attachments, images, thought, code, table, citation).
 * Not pixel-perfect: tags/styles may differ.
 */

const test = require('node:test');
const assert = require('node:assert');

async function renderFixture(native: ReturnType<typeof historicalFixture>) {
    const results = await fixtureResourceResults(native.conversation, native.resourceHints, native.acquisitionHints);
    const resources = Object.fromEntries(results.map(result => [result.resourceId, result.value.path]));
    return renderDocumentHtml(composeDomainDocument(native.conversation, fixtureAccountFor(native.conversation)), resources);
}

const chat: any = {
    id: 'migrate_001',
    title: 'HTML Canonical Migration',
    url: 'https://gemini.google.com/app/migrate_001',
    messages: [
        {
            role: 'user',
            content: 'Please analyze this screenshot and the attached report. The **key metric** is `delta = 42`.',
            attachments: [
                { type: 'image', localName: 'assets/screen.png', name: 'screen.png', mimeType: 'image/png' },
                { type: 'file', localName: 'assets/report.pdf', name: 'report.pdf', title: 'report.pdf' },
            ],
            images: [
                { localName: 'assets/inline-photo.jpg', fileName: 'inline-photo.jpg' },
            ],
        },
        {
            role: 'model',
            thoughts: 'The user wants analysis. Verify the numbers in the table before answering.',
            content: [
                '## Analysis',
                '',
                'The screenshot shows a **rising** trend with `delta = 42`.',
                '',
                '```python',
                'def trend(xs):',
                '    return sum(xs) / len(xs)',
                '```',
                '',
                '| Metric | Value |',
                '|---|---|',
                '| delta | 42 |',
                '| trend | rising |',
                '',
                'See [1] for the raw dataset.',
            ].join('\n'),
            citations: [{ title: 'Raw dataset', url: 'https://example.com/dataset.csv' }],
        },
        {
            role: 'user',
            content: 'Thanks. Now explain the `trend` function step by step.',
        },
        {
            role: 'model',
            content: '1. It sums the values.\n2. It divides by the count.\n\nDone — nothing else to add.',
        },
    ],
};

/** Role sequence of top-level turn sections, in document order. */
function turnRoles(html: string): string[] {
    const roles: string[] = [];
    const re = /<section class="gem-turn gem-turn-(user|model)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) roles.push(m[1]);
    return roles;
}

let newHtml: string;

// Build independent test evidence in a suite hook, not in a preceding test.
test.before(async () => {
    const native = historicalFixture(chat);
    const res = await renderFixture(native);
    assert.ok(res.html.startsWith('<!DOCTYPE html>'), 'must be a full HTML document');
    newHtml = res.html;
});

test('migration: message count and order are correct', () => {
    const newRoles = turnRoles(newHtml);
    assert.deepStrictEqual(newRoles, ['user', 'model', 'user', 'model']);
});

test('migration: body text not dropped', () => {
    for (const needle of [
        'Please analyze this screenshot',
        'key metric',
        'rising',
        'explain the',
        'It sums the values',
    ]) {
        assert.ok(newHtml.includes(needle), `body text missing: ${needle}`);
    }
});

test('migration: attachments and images not dropped', () => {
    assert.ok(newHtml.includes('report.pdf'), 'file attachment name missing');
    assert.ok(newHtml.includes('screen.png'), 'image attachment name missing');
    assert.ok(newHtml.includes('inline-photo.jpg'), 'inline image name missing');
    assert.ok(newHtml.includes('assets/inline-photo.jpg'), 'inline image src missing');
    const imgCount = (newHtml.match(/<img\b/g) || []).length;
    assert.ok(imgCount >= 2, `expected >=2 <img> tags, got ${imgCount}`);
});

test('migration: thought not dropped', () => {
    assert.ok(newHtml.includes('gem-thoughts'), 'thought block missing');
    assert.ok(newHtml.includes('Verify the numbers in the table'), 'thought text missing');
});

test('migration: code block not dropped', () => {
    assert.ok(newHtml.includes('def trend(xs):'), 'code text missing');
    assert.ok(newHtml.includes('language-python'), 'code language marker missing');
});

test('migration: table not dropped', () => {
    assert.ok(newHtml.includes('<table'), 'table element missing');
    assert.ok(newHtml.includes('Metric'), 'table header cell missing');
    assert.ok(newHtml.includes('rising'), 'table body cell missing');
});

test('migration: citation not dropped', () => {
    assert.ok(newHtml.includes('https://example.com/dataset.csv'), 'citation URL missing');
    assert.ok(newHtml.includes('gem-citation'), 'citation markup missing');
});

test('migration: duplicate source message IDs preserve every message at export', async () => {
    const dupChat: any = {
        id: 'dup_001',
        title: 'Duplicate Id Chat',
        messages: [
            { id: 'c_dup_001', role: 'user', content: 'first user prompt' },
            { id: 'rc_dup_1', role: 'model', content: 'model answer' },
            { id: 'c_dup_001', role: 'user', content: 'first user prompt' },
        ],
    };
    const result = await renderFixture(historicalFixture(dupChat));
    assert.deepStrictEqual(turnRoles(result.html), ['user', 'model', 'user']);
    assert.equal(result.html.match(/first user prompt/g)?.length, 2);
    assert.ok(result.html.includes('model answer'));
});
});

__suiteDescribe("html-document-migration-other-layers", () => {
// Retained Application export-entry scenarios; still included in normal discovery.

const { historicalFixture } = require('./helpers/nativeFixture.js');
/**
 * tests/html-document-migration.test.ts
 * Item 1 (P0): production HTML export routes through the canonical path
 * (Domain -> Document AST -> HTML renderer).
 *
 * History: this file originally compared the legacy toHtml() output with
 * the new production entry as migration evidence. Item 2 (P0) removed the
 * legacy toHtml() pipeline entirely; the remaining assertions verify the
 * production entry directly: turn count/order and no dropped content
 * class (text, attachments, images, thought, code, table, citation).
 * Not pixel-perfect: tags/styles may differ.
 */

const test = require('node:test');
const assert = require('node:assert');



const chat: any = {
    id: 'migrate_001',
    title: 'HTML Canonical Migration',
    url: 'https://gemini.google.com/app/migrate_001',
    messages: [
        {
            role: 'user',
            content: 'Please analyze this screenshot and the attached report. The **key metric** is `delta = 42`.',
            attachments: [
                { type: 'image', localName: 'assets/screen.png', name: 'screen.png', mimeType: 'image/png' },
                { type: 'file', localName: 'assets/report.pdf', name: 'report.pdf', title: 'report.pdf' },
            ],
            images: [
                { localName: 'assets/inline-photo.jpg', fileName: 'inline-photo.jpg' },
            ],
        },
        {
            role: 'model',
            thoughts: 'The user wants analysis. Verify the numbers in the table before answering.',
            content: [
                '## Analysis',
                '',
                'The screenshot shows a **rising** trend with `delta = 42`.',
                '',
                '```python',
                'def trend(xs):',
                '    return sum(xs) / len(xs)',
                '```',
                '',
                '| Metric | Value |',
                '|---|---|',
                '| delta | 42 |',
                '| trend | rising |',
                '',
                'See [1] for the raw dataset.',
            ].join('\n'),
            citations: [{ title: 'Raw dataset', url: 'https://example.com/dataset.csv' }],
        },
        {
            role: 'user',
            content: 'Thanks. Now explain the `trend` function step by step.',
        },
        {
            role: 'model',
            content: '1. It sums the values.\n2. It divides by the count.\n\nDone — nothing else to add.',
        },
    ],
};

/** Role sequence of top-level turn sections, in document order. */
function turnRoles(html: string): string[] {
    const roles: string[] = [];
    const re = /<section class="gem-turn gem-turn-(user|model)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) roles.push(m[1]);
    return roles;
}

let newHtml: string;

// Build independent test evidence in a suite hook, not in a preceding test.
test.before(async () => {
    const native = historicalFixture(chat);
    const { document, resources } = await composeFixture(native.conversation, native.resourceHints);
    const { html } = await renderDocumentHtml(document, resources);
    assert.ok(html.startsWith('<!DOCTYPE html>'), 'must be a full HTML document');
    newHtml = html;
});

test('migration: message count and order are correct', () => {
    const newRoles = turnRoles(newHtml);
    assert.deepStrictEqual(newRoles, ['user', 'model', 'user', 'model']);
});

test('migration: body text not dropped', () => {
    for (const needle of [
        'Please analyze this screenshot',
        'key metric',
        'rising',
        'explain the',
        'It sums the values',
    ]) {
        assert.ok(newHtml.includes(needle), `body text missing: ${needle}`);
    }
});

test('migration: attachments and images not dropped', () => {
    assert.ok(newHtml.includes('report.pdf'), 'file attachment name missing');
    assert.ok(newHtml.includes('screen.png'), 'image attachment name missing');
    assert.ok(newHtml.includes('inline-photo.jpg'), 'inline image name missing');
    assert.ok(newHtml.includes('assets/inline-photo.jpg'), 'inline image src missing');
    const imgCount = (newHtml.match(/<img\b/g) || []).length;
    assert.ok(imgCount >= 2, `expected >=2 <img> tags, got ${imgCount}`);
});

test('migration: thought not dropped', () => {
    assert.ok(newHtml.includes('gem-thoughts'), 'thought block missing');
    assert.ok(newHtml.includes('Verify the numbers in the table'), 'thought text missing');
});

test('migration: code block not dropped', () => {
    assert.ok(newHtml.includes('def trend(xs):'), 'code text missing');
    assert.ok(newHtml.includes('language-python'), 'code language marker missing');
});

test('migration: table not dropped', () => {
    assert.ok(newHtml.includes('<table'), 'table element missing');
    assert.ok(newHtml.includes('Metric'), 'table header cell missing');
    assert.ok(newHtml.includes('rising'), 'table body cell missing');
});

test('migration: citation not dropped', () => {
    assert.ok(newHtml.includes('https://example.com/dataset.csv'), 'citation URL missing');
    assert.ok(newHtml.includes('gem-citation'), 'citation markup missing');
});

test('migration: duplicate source message IDs preserve every message at export', async () => {
    const dupChat: any = {
        id: 'dup_001',
        title: 'Duplicate Id Chat',
        messages: [
            { id: 'c_dup_001', role: 'user', content: 'first user prompt' },
            { id: 'rc_dup_1', role: 'model', content: 'model answer' },
            { id: 'c_dup_001', role: 'user', content: 'first user prompt' },
        ],
    };
    const { document, resources } = await composeFixture(historicalFixture(dupChat).conversation);
    const { html } = await renderDocumentHtml(document, resources);
    assert.deepStrictEqual(turnRoles(html), ['user', 'model', 'user']);
    assert.equal(html.match(/first user prompt/g)?.length, 2);
    assert.ok(html.includes('model answer'));
});
});

__suiteDescribe("html-document-orchestration", () => {
/** Public HTML orchestration and the pure Document AST backend. */





test('HTML export returns the delivery contract and uses prepared offline destinations', async () => {
    const raw = { id: 'html', title: 'HTML export', messages: [{ role: 'user', content: 'look at this', attachments: [{ type: 'image', localName: 'assets/x.png', name: 'x.png' }] }] };
    const { domain, document, resources } = await parseFixture(raw);
    const result = renderDocumentHtml(document, resources);
    assert.ok(result.html.startsWith('<!DOCTYPE html>'));
    assert.ok(result.html.includes('assets/x.png'));
    assert.deepEqual([...collectDocumentResources(document).referencedIds], [domain.detail.assets[0].id]);
    assert.equal(resources[domain.detail.assets[0].id], 'assets/x.png');
    assert.ok(!JSON.stringify(domain).includes('assets/x.png'));
});
test('unprepared resources remain visible and carry an explicit backend diagnostic', async () => {
    const { document } = await parseFixture({ id: 'missing', messages: [{ role: 'model', content: 'file below', attachments: [{ type: 'file', name: 'y.pdf' }] }] });
    const result = renderDocumentHtml(document, {});
    assert.ok(result.html.includes('gem-missing-asset'));
    assert.ok(result.html.includes('y.pdf'));
    assert.equal(result.diagnostics.filter(d => d.code === 'HTML_ASSET_UNRESOLVED').length, 1);
});
});

__suiteDescribe("html_export", () => {
const { historicalFixture } = require('./helpers/nativeFixture.js');
/**
 * Item 2 (P0): the legacy sync toHtml() / formatContent(chat, 'html') path
 * was removed; these tests now exercise the canonical renderer, which
 * shares GEM_HTML_CSS / GEM_HTML_SCRIPT from htmlTemplate.ts.
 */

const test = require('node:test');
const assert = require('node:assert');


test('html_export - formatHtmlDocument returns valid structure, metadata, and styles', async () => {
    const mockChat = {
        id: 'chat_html_test_123',
        title: 'Quantum Computing & Algorithms',
        url: 'https://gemini.google.com/app/chat_html_test_123',
        createdAt: 1700000000000,
        messages: [
            {
                role: 'user',
                content: 'What is Grover\'s algorithm?\n\nPlease explain the quadratic speedup.',
                attachments: [
                    {
                        type: 'image',
                        localName: 'assets/grover_circuit.png',
                        name: 'grover_circuit.png'
                    },
                    {
                        type: 'file',
                        localName: 'assets/quantum_notes.pdf',
                        name: 'quantum_notes.pdf',
                        title: 'quantum_notes.pdf'
                    }
                ]
            },
            {
                role: 'model',
                thoughts: 'Analyzing quantum search complexity and amplitude amplification principles...',
                content: 'Grover\'s algorithm provides a quadratic speedup for unstructured search.\n\n### Complexity Comparison\n\n| Algorithm | Classical | Quantum (Grover) |\n|---|---|---|\n| Search | $O(N)$ | $O(\\sqrt{N})$ |\n\nHere is a simple example in Python:\n\n```python\ndef grover_iterations(n):\n    import math\n    return int(math.pi / 4 * math.sqrt(n))\n```\n\nKey advantage is amplitude amplification.'
            }
        ]
    };

    const native = historicalFixture(mockChat);
    const { document, resources } = await composeFixture(native.conversation, native.resourceHints);
    const { html } = await renderDocumentHtml(document, resources);

    assert.ok(html.startsWith('<!DOCTYPE html>'), 'Must start with <!DOCTYPE html>');
    assert.ok(html.includes('<title>Quantum Computing &amp; Algorithms</title>'), 'Title must be safely escaped in <title>');
    assert.ok(html.includes('generator" content="Gemini Exporter"'), 'Must contain generator meta');

    assert.ok(html.includes('@media print'), 'Must include @media print styles for PDF readiness');
    assert.ok(!html.includes('gem-top-bar'), 'Must NOT contain top bar to keep 1:1 fidelity');
    assert.ok(html.includes('prefers-color-scheme'), 'Must support adaptive system theme');

    assert.ok(html.includes('gem-turn-user'), 'Must contain user turn section');
    assert.ok(html.includes('gem-user-bubble'), 'Must contain user bubble');
    assert.ok(html.includes("What is Grover&#39;s algorithm?"), 'Must contain user text escaped');
    assert.ok(!html.includes('gem-carousel-wrapper'), 'Must NOT render attachment carousel');
    assert.ok(html.includes('gem-image-block'), 'Must render image attachment block');
    assert.ok(html.includes('assets/grover_circuit.png'), 'Must link image attachment to assets/ path');
    assert.ok(html.includes('assets/quantum_notes.pdf'), 'Must link file attachment to assets/ path');
    assert.ok(html.includes('download="quantum_notes.pdf"'), 'File card must include download attribute');

    assert.ok(html.includes('gem-turn-model'), 'Must contain model turn section');
    assert.ok(html.includes('gem-thoughts'), 'Must contain thoughts accordion');
    assert.ok(html.includes('amplitude amplification principles'), 'Must contain thoughts text');
    assert.ok(html.includes('gem-table'), 'Must render markdown table');
    assert.ok(html.includes('<th>Algorithm</th>'), 'Must render table header cell');
    assert.ok(html.includes('<td>Search</td>'), 'Must render table data cell');
    assert.ok(html.includes('gem-code-block'), 'Must render code block container');
    assert.ok(html.includes('gem-copy-btn'), 'Must render copy code button');
    assert.ok(html.includes('grover_iterations'), 'Must contain code block content');
    assert.ok(html.includes('gem-math-inline'), 'Must format inline math');

    assert.ok(!html.includes('class="sidebar"'), 'Must NOT contain sidebar');
    assert.ok(!html.includes('id="chat-input"'), 'Must NOT contain chat input box');
    assert.ok(!html.includes('thumb_up'), 'Must NOT contain thumbs up/down buttons');
});

test('html_export - supports English localization and handles empty conversation', async () => {
    const emptyChat = {
        id: 'empty_chat_001',
        title: 'Empty Session',
        messages: []
    };

    const { document, resources } = await composeFixture(historicalFixture(emptyChat).conversation);
    const { html: htmlEn } = await renderDocumentHtml(document, resources, { locale: 'en' });
    assert.ok(htmlEn.includes('<html>'), 'Unknown document language must not be inferred from English UI');
    assert.ok(htmlEn.includes('Empty conversation.'), 'Must render English empty notice');

    const { html: htmlZh } = await renderDocumentHtml(document, resources, { locale: 'zh' });
    assert.ok(htmlZh.includes('<html>'), 'Unknown document language must not be inferred from Chinese UI');
    assert.ok(htmlZh.includes('暂无对话记录。'), 'Must render Chinese empty notice');
});

test('html_export - XSS protection escapes malicious tags', async () => {
    const attackChat = {
        id: 'xss_test',
        title: '<script>alert("hacked")</script>',
        messages: [
            {
                role: 'user',
                content: '<img src=x onerror=alert(1)>'
            }
        ]
    };

    const { document, resources } = await composeFixture(historicalFixture(attackChat).conversation);
    const { html } = await renderDocumentHtml(document, resources);
    assert.ok(!html.includes('<script>alert("hacked")</script>'), 'Title script tags must be escaped');
    assert.ok(html.includes('&lt;script&gt;alert(&quot;hacked&quot;)&lt;/script&gt;'), 'Title must be HTML encoded');
});

test('html_export - XSS pseudo-protocols in markdown links are disarmed to safe href', async () => {
    const attackChat = {
        id: 'xss_link_test',
        title: 'Safe Title',
        messages: [
            {
                role: 'user',
                content: '[Click Evil](javascript:alert("pwned")) and [Data Link](data:text/html,<script>alert(1)</script>) and [Safe Link](https://example.com)'
            },
            {
                role: 'model',
                content: '[![Evil Image](javascript:alert(2))](vbscript:msgbox(1)) and ![Good Image](https://example.com/pic.png)'
            }
        ]
    };

    const { document, resources } = await composeFixture(historicalFixture(attackChat).conversation);
    const { html } = await renderDocumentHtml(document, resources);
    assert.ok(!html.includes('href="javascript:'), 'Must NOT contain javascript: in href');
    assert.ok(!html.includes('href="vbscript:'), 'Must NOT contain vbscript: in href');
    assert.ok(!html.includes('href="data:text/html'), 'Must NOT contain data:text/html in href');
    assert.ok(!html.includes('src="javascript:'), 'Must NOT contain javascript: in src');
    assert.ok(html.includes('href="https://example.com/"'), 'Valid https links must be preserved');
    // Canonical renderer is offline-first: remote asset bytes are never
    // embedded, so a remote image renders a visible missing-asset placeholder
    // (alt text kept) instead of a remote <img src>.
    assert.ok(!html.includes('src="https://example.com/pic.png"'), 'Must NOT leak remote asset URLs into src');
    assert.ok(html.includes('gem-missing-inline'), 'Remote image must render a visible placeholder');
    assert.ok(html.includes('Good Image'), 'Placeholder must keep the alt text visible');
});
});
