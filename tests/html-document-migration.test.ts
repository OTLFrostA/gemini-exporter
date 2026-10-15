import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureResourceResults } from './helpers/documentFixture.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { ChatFormatter } from '../src/core/engine/chatFormatter.js';

// This tests the current HTML export entry. Historical records are adapted
// explicitly in the fixture; the test does not claim to exercise live RPC input.
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


/** Role sequence of top-level exported turns, in display order. */
function turnRoles(html: string): string[] {
    const roles: string[] = [];
    const re = /<section class="gem-turn gem-turn-(user|model)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) roles.push(m[1]);
    return roles;
}

test('HTML production export retains every message and authored content type', async t => {
    const native = historicalFixture(chat);
    const res = await ChatFormatter.formatHtmlDocument(native, {
        resourceResults: await fixtureResourceResults(native.conversation, native.resourceHints),
    });
    const html = String(res.content);

    await t.test('complete offline HTML document and ordered turns', () => {
        assert.equal(res.ext, 'html');
        assert.equal(res.mime, 'text/html');
        assert.ok(html.startsWith('<!DOCTYPE html>'));
        assert.deepEqual(turnRoles(html), ['user', 'model', 'user', 'model']);
    });
    await t.test('authored body text remains present', () => {
        for (const phrase of [
            'Please analyze this screenshot', 'key metric', 'rising',
            'explain the', 'It sums the values',
        ]) assert.ok(html.includes(phrase), `body text missing: ${phrase}`);
    });
    await t.test('image placements and downloadable files retain their prepared paths', () => {
        for (const path of ['report.pdf', 'screen.png', 'inline-photo.jpg', 'assets/inline-photo.jpg']) {
            assert.ok(html.includes(path), `missing export resource: ${path}`);
        }
        assert.ok((html.match(/<img\b/g) || []).length >= 2, 'two image placements must survive export');
    });
    await t.test('authored reasoning text survives', () => {
        assert.ok(html.includes('gem-thoughts'));
        assert.ok(html.includes('Verify the numbers in the table'));
    });
    await t.test('code contents and language remain visible', () => {
        assert.ok(html.includes('def trend(xs):'));
        assert.ok(html.includes('language-python'));
    });
    await t.test('table structure and cells survive', () => {
        assert.ok(html.includes('<table'));
        assert.ok(html.includes('Metric'));
        assert.ok(html.includes('rising'));
    });
    await t.test('citations retain their source URL', () => {
        assert.ok(html.includes('https://example.com/dataset.csv'));
        assert.ok(html.includes('gem-citation'));
    });
});

test('HTML export preserves distinct turns even when the provider reuses a message id', async () => {
    const repeated = historicalFixture({
        id: 'dup_001', title: 'Repeated Message ID',
        messages: [
            { id: 'c_dup_001', role: 'user', content: 'the first user prompt' },
            { id: 'rc_dup_1', role: 'model', content: 'middle model answer' },
            { id: 'c_dup_001', role: 'user', content: 'the later user prompt' },
        ],
    });
    const result = await ChatFormatter.formatHtmlDocument(repeated);
    const html = result.content;
    assert.deepEqual(turnRoles(html), ['user', 'model', 'user'], 'two distinct turns cannot collapse due to a reused source id');
    const first = html.indexOf('the first user prompt');
    const middle = html.indexOf('middle model answer');
    const last = html.indexOf('the later user prompt');
    assert.ok(first >= 0 && first < middle && middle < last, 'repeated source IDs must not reorder or drop authored bodies');
});
