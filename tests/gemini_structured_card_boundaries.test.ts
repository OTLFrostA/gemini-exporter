import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDocumentLinks, decodeResearchPlan, decodeMailCard } from '../src/l1/parsers/gemini/rpc/cardNodes.js';
import { decodeGeminiStructuredPayload } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import { citationField } from './fixtures/providers/gemini/detail/content.js';
import { parseGeminiBody } from '../src/l1/parsers/gemini/shared/contentAdapter.js';
import type { GeminiStructuredNode } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import type { Diagnostic } from '../src/shared/diagnostics/diagnostic.js';

test('document links validate every chip and do not coerce kinds or accept unsafe URLs', () => {
    const chip = (target: string, kind: string | number = 1) => [[target], 'id', null, 'Title', null, null, null, kind];
    assert.ok(decodeDocumentLinks([chip('https://example.com/one'), chip('http://example.com/two', 3)]));
    for (const target of ['javascript:alert(1)', 'data:text/html,body', 'https://', 'not-a-url']) {
        assert.equal(decodeDocumentLinks([chip('https://example.com/one'), chip(target)]), null);
    }
    assert.equal(decodeDocumentLinks([chip('https://example.com', '1')]), null);
    assert.equal(decodeDocumentLinks([chip('https://example.com', 26)]), null);
    assert.equal(decodeDocumentLinks([chip('https://example.com'), [...chip('https://example.com'), 'unknown-body']]), null);
});

test('research plans reject missing step order and unknown trailing body fields', () => {
    assert.ok(decodeResearchPlan([['Plan', [[1, 'First'], [2, 'Second']], 'id']]));
    assert.equal(decodeResearchPlan([['Plan', [[2, 'First']], 'id']]), null);
    assert.equal(decodeResearchPlan([['Plan', [[1, 'First']], 'id', ['Result'], ['javascript:alert(1)', 0]]]), null);
    assert.equal(decodeResearchPlan([['Plan', [[1, 'First']], 'id', null, null, null, 'Unknown content']]), null);
});

test('mail cards reject unrecognized summary and action extensions', () => {
    const summary = { 133: [null, null, [null, 'Subject', 'Summary', ['Sender']]] };
    const mail = { 1144: ['id', null, null, ['Preview'], [['<p>Body</p>']], 2, false] };
    const card = (action: unknown, extension: unknown) => [[['https://example.com/mail'], [[2, 0, 'request', 'thread', action]], null, null, ['thread'], extension]];
    assert.ok(decodeMailCard(card(mail, summary)));
    assert.equal(decodeMailCard(card({ ...mail, 999: ['Unknown body'] }, summary)), null);
    assert.equal(decodeMailCard(card(mail, { ...summary, 999: ['Unknown body'] })), null);
    assert.equal(decodeMailCard(card({ 1144: ['id', null, null, ['Preview'], 42] }, summary)), null);
});

test('explicit image panels require an actual HTTP URL and image MIME', () => {
    const image = (target: string, mime: string) => citationField(9, [[[
        [null, null, null, [null, 1, 'image-tag', null, [3, null, 'Registration failed'], null, null, null, null, null, null, mime]],
        [target], null, [], null, null, null, null, null, null, null, [true],
    ]]]);
    assert.ok(decodeGeminiStructuredPayload([[[image('https://example.com/image.jpg', 'image/jpeg')]]]));
    for (const target of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://']) {
        assert.equal(decodeGeminiStructuredPayload([[[image(target, 'image/jpeg')]]]), null);
    }
    assert.equal(decodeGeminiStructuredPayload([[[image('https://example.com/file', 'text/plain')]]]), null);
});

test('source-only degradation works inside lists, quotes and table cells without repairing bad formatting', () => {
    const text: GeminiStructuredNode = { nodeType: 18, text: 'code tail', annotations: [
        { start: 0, end: 4, type: 7 }, { start: 0, end: 99, type: 'source', sourceIds: ['spp_fixture'] },
    ] };
    const wrappers: GeminiStructuredNode[] = [
        { nodeType: 20, items: [{ children: [text] }] }, { nodeType: 15, children: [text] },
        { nodeType: 17, rows: [{ cells: [{ children: [text] }] }] },
    ];
    for (const node of wrappers) {
        const diagnostics: Diagnostic[] = [];
        let partial = false;
        const blocks = parseGeminiBody('Fallback', { children: [node] }, {
            diagnostics, sourceRef: { providerId: 'gemini', locator: 'fixture' },
            sourceCitations: new Map([['spp_fixture', [{ id: 'source', url: 'https://example.com/source' }]]]),
            onStructuredFallback: () => { partial = true; },
        });
        assert.equal(partial, true);
        assert.ok(JSON.stringify(blocks).includes('"code":"code"'));
        assert.ok(JSON.stringify(blocks).includes('"citationId":"source"'));
        assert.ok(diagnostics.some(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK'));
    }
});
