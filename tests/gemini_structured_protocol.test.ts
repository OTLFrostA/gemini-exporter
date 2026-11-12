import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGeminiStructuredNode, decodeGeminiStructuredPayload } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { assertDomainClosure } from '../src/l2/closure.js';
import { validateParserDomain } from '../src/l2/runtimeValidation.js';
import { composeDomainDocument } from '../src/l3b/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/l4/format/markdown/renderMarkdown.js';
import { closeGeminiCodeCitations } from '../src/l1/parsers/gemini/shared/codeCitations.js';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { citationField, citationText } from './fixtures/providers/gemini/detail/content.js';

import { detailGen } from './fixtures/providers/geminiDetail.js';
import { citation, workspace, fileSource, webSource, sourceUrl } from './fixtures/providers/gemini/detail/nativeCitationCases.js';

test('document rendering trailers are separate from body nodes at every sequence length', () => {
    for (const count of [1, 2, 3, 14, 25]) for (const flag of [0, 1, 2, 7, 128]) {
        const nodes = Array.from({ length: count }, (_, index) => citationText(`Paragraph ${index}.`));
        const document = [[nodes, [null, null, null, null, flag]]];
        assert.deepEqual(decodeGeminiStructuredPayload(document), {
            children: nodes.map((_, index) => ({ nodeType: 18, text: `Paragraph ${index}.` })),
        });
    }
});

test('another body, unknown trailer payload or unsupported child rejects the entire document', () => {
    const body = [citationText('Known body.')];
    for (const trailer of [[citationText('Second body.')], [null, null, 'authored text', null, 1],
        [null, null, null, null, 'unknown'], [null, null, null, null, -1]]) {
        assert.equal(decodeGeminiStructuredPayload([[body, trailer]]), null);
    }
    assert.equal(decodeGeminiStructuredPayload([[body], [body]]), null);
    assert.equal(decodeGeminiStructuredPayload([[ [...body, citationField(38, ['unknown'])],
        [null, null, null, null, 1] ]]), null);
});

test('citation marker metadata is a nonnegative integer rather than a fixed enum', () => {
    for (const offset of [0, 1, 2, 13, 128]) {
        const node = citationField(31, [citation([fileSource()], '1', offset)]);
        assert.deepEqual(decodeGeminiStructuredNode(node), { nodeType: 'citation', number: 1, title: 'example.txt' });
    }
    for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(decodeGeminiStructuredNode(citationField(31, [citation([fileSource()], '1', offset)])), null);
    }
});

test('short and extended Workspace source metadata decode to the same citation facts', () => {
    for (const extended of [false, true]) for (const source of [[workspace(extended)], [workspace(extended), null, '']]) {
        assert.deepEqual(decodeGeminiStructuredNode(citationField(31, [citation([source])])), {
            nodeType: 'citation', number: 1, title: 'Example source', url: sourceUrl,
        });
    }
});

test('compact web citations retain their marker binding and reject conflicting source numbers', () => {
    const compact = [[' [cite: 1]'], [webSource(1)]];
    assert.deepEqual(decodeGeminiStructuredNode(citationField(31, [compact])), {
        nodeType: 'citation', number: 1, title: 'Example source', url: sourceUrl,
    });
    assert.equal(decodeGeminiStructuredNode(citationField(31, [[[' [cite: 1]'], [webSource(2)]]])), null);
    const empty = citationField(31, [[[' [cite: ]']]]);
    const decoded = decodeGeminiStructuredNode(empty);
    assert.deepEqual(decoded, { nodeType: 'citationGroup', children: [] });
    assert.deepEqual(decodeGeminiStructuredNode(decoded), decoded);
});

test('combined heterogeneous citations preserve source order and validate the whole group', () => {
    assert.deepEqual(decodeGeminiStructuredNode(citationField(31, [citation([fileSource(), webSource(2)], '1, 2')])), {
        nodeType: 'citationGroup', children: [
            { nodeType: 'citation', number: 1, title: 'example.txt' },
            { nodeType: 'citation', number: 2, title: 'Example source', url: sourceUrl },
        ],
    });
    for (const marker of ['1, 1', '1, 01', '1, 0', '1, 2, 3', '1.1']) {
        assert.equal(decodeGeminiStructuredNode(citationField(31, [citation([fileSource(), webSource(2)], marker)])), null);
    }
    const invalid = workspace(true);
    invalid[1] = 'javascript:invalid';
    assert.equal(decodeGeminiStructuredNode(citationField(31, [citation([[invalid]])])), null);
});

test('native field 44 and structured references share one URL identity in both body paths', () => {
    const wire = detailGen('G_NATIVE_CITATION_WORKSPACE');
    for (const mode of ['structured', 'markdown'] as const) {
        const account = fixtureAccount('gemini');
        const result = parseGeminiRpcConversation(wire, { account, providerId: 'gemini', bodyRepresentation: mode });
        const message = result.conversation.detail.messages[1];
        assert.deepEqual(message.citations, [{ id: 'citation-0', url: sourceUrl, title: 'Example source' }]);
        assertDomainClosure(result.conversation.detail);
        assert.ok(JSON.stringify(message.content).includes('"citationId":"citation-0"'));
        const key = fixtureKey(result.conversationId, 'gemini');
        const domain = validateParserDomain({ index: { ...result.conversation.index, key }, detail: { ...result.conversation.detail, key } });
        const output = renderDocumentMarkdown(composeDomainDocument(domain, account), {});
        assert.ok(output.includes(`](https://example.com/source)`), 'rendered Markdown has a linked source');
        assert.ok(!output.includes('> [2]'), 'no phantom source is introduced');
    }
});

test('a later unsupported node still falls back with the same bound source URL', () => {
    const result = parseGeminiRpcConversation(detailGen('G_NATIVE_CITATION_ADAPTER_FALLBACK'), { account: fixtureAccount('gemini'), providerId: 'gemini' });
    const diagnostic = result.diagnostics.find(d => d.code === 'GEMINI_STRUCTURED_FALLBACK');
    assert.ok(diagnostic?.details && typeof diagnostic.details === 'object' && !Array.isArray(diagnostic.details));
    assert.equal(diagnostic.details.sourceCitationsJson, JSON.stringify([['grounding-1', [
        { id: 'citation-0', url: sourceUrl, title: 'Example source' },
    ]]]));
    const message = result.conversation.detail.messages[1];
    assert.deepEqual(message.citations, [{ id: 'citation-0', url: sourceUrl, title: 'Example source' }]);
    assert.deepEqual(message.content, [{ type: 'paragraph', children: [
        { type: 'text', text: 'A claim. ' }, { type: 'citationRef', citationId: 'citation-0', label: '[1]' },
    ] }]);
});

test('compound identifiers and excerpt location groups preserve whole-source bindings', () => {
    for (const [marker, sources, expected] of [
        ['1.4', [[workspace(false)]], [{ title: 'Example source', url: sourceUrl }]],
        ['24,25', [fileSource()], [{ title: 'example.txt' }]],
        ['22-32,112-122', [fileSource()], [{ title: 'example.txt' }]],
    ] as const) {
        const decoded = decodeGeminiStructuredNode(citationField(31, [citation([...sources], marker)]));
        assert.deepEqual(decoded, { nodeType: 'sourceReference', marker: `[cite: ${marker.split(',').join(', ')}]`, sources: expected });
        assert.deepEqual(decodeGeminiStructuredNode(decoded), decoded);
    }
    for (const marker of ['0', '1.0', '2-1', '1,1', '1.4,1.4', '9007199254740992', '1-9007199254740992']) {
        assert.equal(decodeGeminiStructuredNode(citationField(31, [citation([fileSource()], marker)])), null, marker);
    }
    // Multiple legacy source chips must not be guessed into a single location.
    assert.equal(decodeGeminiStructuredNode(citationField(31, [citation([fileSource(), fileSource()], '1.4')])), null);
});

test('compound Workspace references retain URLs through structured, adapter and decoder fallback paths', () => {
    for (const key of [
        'G_NATIVE_CITATION_COMPOUND', 'G_NATIVE_CITATION_COMPOUND_ADAPTER_FALLBACK', 'G_NATIVE_CITATION_COMPOUND_DECODE_FALLBACK', 'G_NATIVE_CITATION_NESTED_METADATA',
    ] as const) for (const mode of ['structured', 'markdown'] as const) {
        const result = parseGeminiRpcConversation(detailGen(key), {
            account: fixtureAccount('gemini'), providerId: 'gemini', bodyRepresentation: mode,
        });
        const message = result.conversation.detail.messages[1];
        assert.deepEqual(message.citations, [{ id: 'citation-0', title: 'Example source', url: sourceUrl }]);
        assert.ok(JSON.stringify(message.content).includes('"citationId":"citation-0"'));
        assert.ok(!JSON.stringify(message.content).includes('cite:'));
        assertDomainClosure(result.conversation.detail);
    }
});

test('file location groups stay hidden in both body paths without inventing one file per number', () => {
    for (const key of ['G_NATIVE_CITATION_FILE_LOCATIONS', 'G_NATIVE_CITATION_FILE_RANGES'] as const) {
        for (const mode of ['structured', 'markdown'] as const) {
            const result = parseGeminiRpcConversation(detailGen(key), {
                account: fixtureAccount('gemini'), providerId: 'gemini', bodyRepresentation: mode,
            });
            const message = result.conversation.detail.messages[1];
            assert.equal(message.citations?.length, 1);
            assert.equal(message.citations?.[0].title, 'example.txt');
            assert.ok(!JSON.stringify(message.content).includes('citationRef'));
            assert.ok(!JSON.stringify(message.content).includes('cite:'));
            assertDomainClosure(result.conversation.detail);
        }
    }
});

test('marker whitespace aliases resolve native groups while plain identifiers and unbound markers stay literal', () => {
    const literal = 'Plain [1] [1.4] [1-2] [1,2]; unknown [cite:9.9].';
    const result = parseGeminiRpcConversation(detailGen('G_NATIVE_CITATION_WHITESPACE'), {
        account: fixtureAccount('gemini'), providerId: 'gemini',
    });
    const message = result.conversation.detail.messages[1];
    assert.equal(message.citations?.length, 1);
    const serialized = JSON.stringify(message.content);
    assert.equal(serialized.split('"citationId":"citation-0"').length - 1, 2);
    assert.ok(serialized.includes(literal));
    assertDomainClosure(result.conversation.detail);
});

test('native bindings belong only to the selected candidate', () => {
    const result = parseGeminiRpcConversation(detailGen('G_NATIVE_CITATION_OTHER_CANDIDATE'), { account: fixtureAccount('gemini'), providerId: 'gemini' });
    const message = result.conversation.detail.messages[1];
    assert.ok(!message.citations?.length);
    assert.ok(JSON.stringify(message.content).includes('Claim[cite:1.4]'));
});

test('code cleanup removes confirmed compound tokens and preserves quoted and unconfirmed tokens', () => {
    const blocks = [{ type: 'code' as const, code: 'label[cite:1.4,2-3] "[cite:1.4,2-3]" [cite:9.9]' }];
    closeGeminiCodeCitations(blocks, ['[cite: 1.4, 2-3]']);
    assert.equal(blocks[0].code, 'label "[cite:1.4,2-3]" [cite:9.9]');
});


test('compact file and web descriptors take their title from the native source metadata', () => {
    const source = fileSource();
    const descriptor = source[1];
    assert.ok(Array.isArray(descriptor));
    source[1] = descriptor.slice(0, 5);
    assert.deepEqual(decodeGeminiStructuredNode(citationField(31, [citation([source])])), {
        nodeType: 'citation', number: 1, title: 'example.txt',
    });
    const web = webSource(1);
    const page = web[3];
    assert.ok(Array.isArray(page));
    page[0] = [sourceUrl, 'Compact source'];
    assert.deepEqual(decodeGeminiStructuredNode(citationField(31, [[[' [cite: 1]'], [web]]])), {
        nodeType: 'citation', number: 1, title: 'Compact source', url: sourceUrl,
    });
});
