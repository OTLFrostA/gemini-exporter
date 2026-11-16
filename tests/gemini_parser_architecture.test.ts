import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isBoundedTuple,
    isExclusiveSlot,
    isHttpUrl,
    isHttpsUrl,
    isIntegerInRange,
    isNonNegativeSafeInt,
    isPositiveSafeInt,
    singleExtensionPayload,
    singleWireSlot,
} from '../src/l1/parsers/gemini/rpc/jspbSchema.js';
import { createCandidateMarkdownIndex } from '../src/l1/parsers/gemini/shared/candidateMarkdown.js';
import { decodeTurn } from '../src/l1/parsers/gemini/rpc/extractors.js';
import { decodeGeminiTurn, decodeGeminiUserResources } from '../src/l1/parsers/gemini/rpc/turnResources.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';
import { parseGeminiBody } from '../src/l1/parsers/gemini/shared/contentAdapter.js';
import { validateParserDomain } from '../src/l2/runtimeValidation.js';
import { composeDomainDocument } from '../src/l3b/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/l4/format/markdown/renderMarkdown.js';
import { citationField, citationText, coverageWire } from './fixtures/providers/gemini/detail/content.js';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';

const account = fixtureAccount('gemini');

test('jspbSchema combinators enforce single-slot protobuf unions, bounded tuples and typed scalars', () => {
    assert.deepEqual(singleWireSlot([null, undefined, 'payload', null]), { slot: 2, payload: 'payload' });
    assert.equal(singleWireSlot([null, null]), null);
    assert.equal(singleWireSlot([null, 'a', 'b']), null, 'competing oneof branches must reject');
    assert.equal(isExclusiveSlot([null, 'only', undefined], 1), true);
    assert.equal(isExclusiveSlot(['extra', 'only'], 1), false);
    assert.equal(isBoundedTuple([1, 2, null, undefined], 2), true);
    assert.equal(isBoundedTuple([1, 2, 'overflow'], 2), false);
    assert.equal(singleExtensionPayload({ '39': ['ok'] }, '39')?.toString(), 'ok');
    assert.equal(singleExtensionPayload({ '39': ['ok'], '40': ['extra'] }, '39'), undefined);
    assert.equal(isNonNegativeSafeInt(0), true);
    assert.equal(isNonNegativeSafeInt(-1), false);
    assert.equal(isPositiveSafeInt(1), true);
    assert.equal(isPositiveSafeInt(0), false);
    assert.equal(isIntegerInRange(6, 0, 6), true);
    assert.equal(isIntegerInRange(7, 0, 6), false);
    assert.equal(isHttpUrl('http://immersive_entry_chip/1'), true);
    assert.equal(isHttpsUrl('http://immersive_entry_chip/1'), false);
    assert.equal(isHttpsUrl('https://example.com/doc'), true);
});

test('CandidateMarkdownIndex evaluates paragraph projections and reference AST lazily once', () => {
    const md = 'Intro with `code`.\n\n<FollowUp query="ignored"/>\n\nSecond paragraph $x_1$.';
    const index = createCandidateMarkdownIndex(md, md);
    assert.equal(index.cleaned().includes('FollowUp'), false);
    const firstParagraphs = index.paragraphs();
    const secondParagraphs = index.paragraphs();
    assert.strictEqual(firstParagraphs, secondParagraphs, 'paragraph projection is memoized');
    const ctx = { diagnostics: [], sourceRef: { providerId: 'gemini', locator: 'test' } };
    const refA = index.referenceBlocks(ctx);
    const refB = index.referenceBlocks(ctx);
    assert.strictEqual(refA, refB, 'reference blocks are memoized across recovery passes');
    assert.equal(refA.length, 2);
});

test('block-level isolation preserves sibling inline citations and fills unknown widget gaps from anchored Markdown', () => {
    const introUrl = 'https://example.com/intro-source';
    const outroUrl = 'https://example.com/outro-source';
    const metadata = [null, [
        [['Intro analysis.'], [1], [[introUrl, 'Intro Source']], 'spp_intro'],
        [['Final conclusion.'], [1], [[outroUrl, 'Outro Source']], 'spp_outro'],
    ]];
    const raw = [[[
        citationText('Intro analysis.', [[0, 15, [null, null, null, [null, ['spp_intro']]]]]),
        citationField(38, ['UNSUPPORTED_FUTURE_WIDGET']),
        citationText('Final conclusion.', [[0, 17, [null, null, null, [null, ['spp_outro']]]]]),
    ]]];
    const fallbackMarkdown = 'Intro analysis.\n\nFallback widget summary preserved from Markdown.\n\nFinal conclusion.';
    const wire = coverageWire(raw, [['rc_primary', [[fallbackMarkdown]], metadata]]);

    const page = parseGeminiRpcConversation(wire, { account, providerId: 'gemini' });
    const merged = mergeConversationPages([page], undefined, true);

    assert.equal(merged.conversation.detail.quality.status, 'partial', 'unknown block keeps snapshot partial');
    const fallbackDiag = merged.diagnostics.find(d => d.code === 'GEMINI_STRUCTURED_FALLBACK');
    assert.equal(fallbackDiag?.details && (fallbackDiag.details as { reason?: string }).reason, 'decode_rejected');

    const key = fixtureKey(merged.conversationId);
    const domain = validateParserDomain({
        index: { ...merged.conversation.index, key },
        detail: { ...merged.conversation.detail, key },
    });
    const rendered = renderDocumentMarkdown(composeDomainDocument(domain, account), {});
    assert.ok(rendered.includes(introUrl), 'first sibling paragraph keeps its native inline citation');
    assert.ok(rendered.includes('Fallback widget summary preserved from Markdown.'), 'unknown block gap is filled from candidate Markdown');
    assert.ok(rendered.includes(outroUrl), 'last sibling paragraph keeps its native inline citation');
    assert.ok(rendered.indexOf('Intro analysis') < rendered.indexOf('Fallback widget summary')
        && rendered.indexOf('Fallback widget summary') < rendered.indexOf('Final conclusion'), 'authored block order is preserved');
});

test('block-level isolation rescues valid native cards when another sibling node is unsupported', () => {
    const researchPlan = citationField(27, [[
        ' rescued-plan-title ',
        [[1, 'Step alpha', 'Collect primary data'], [2, 'Step beta']],
        'plan-id', ['Open report'], ['https://example.com/report', 0],
    ]]);
    const raw = [[[
        citationText('Lead paragraph.'),
        researchPlan,
        citationText('Closing paragraph.'),
        citationField(39, ['TRAILING_UNKNOWN_EXTENSION']),
    ]]];
    const fallbackMarkdown = 'Lead paragraph.\n\nClosing paragraph.';
    const page = parseGeminiRpcConversation(
        coverageWire(raw, [['rc_primary', [[fallbackMarkdown]]]]),
        { account, providerId: 'gemini' },
    );
    const merged = mergeConversationPages([page], undefined, true);
    assert.equal(merged.conversation.detail.quality.status, 'partial');

    const key = fixtureKey(merged.conversationId);
    const domain = validateParserDomain({
        index: { ...merged.conversation.index, key },
        detail: { ...merged.conversation.detail, key },
    });
    const rendered = renderDocumentMarkdown(composeDomainDocument(domain, account), {});
    assert.ok(rendered.includes('rescued-plan-title') && rendered.includes('Collect primary data'),
        'valid Research Plan card is no longer lost when an unrelated trailing node fails decoding');
    assert.ok(rendered.includes('https://example.com/report'));
});

test('adapter-level block isolation preserves valid sibling citations when one block has malformed formatting', () => {
    const sources = new Map([['spp_ok', [{ id: 'citation-0', url: 'https://example.com/ok', title: 'OK' }]]]);
    const diagnostics: import('../src/shared/diagnostics/diagnostic.js').Diagnostic[] = [];
    let fallbackReason: string | undefined;
    const blocks = parseGeminiBody(
        'First valid paragraph.\n\nBroken formatting paragraph.\n\nThird valid paragraph.',
        {
            children: [
                { nodeType: 18, text: 'First valid paragraph.', annotations: [{ start: 0, end: 5, type: 'source', sourceIds: ['spp_ok'] }] },
                { nodeType: 18, text: 'Broken formatting paragraph.', annotations: [{ start: 0, end: 999, type: 0 }] },
                { nodeType: 18, text: 'Third valid paragraph.' },
            ],
        },
        {
            diagnostics,
            sourceRef: { providerId: 'gemini', locator: 'test' },
            sourceCitations: sources,
            onStructuredFallback: reason => { fallbackReason = reason; },
        },
    );
    assert.equal(fallbackReason, 'body');
    assert.ok(diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
    assert.equal(blocks.length, 3);
    assert.ok(JSON.stringify(blocks[0]).includes('"citationId":"citation-0"'));
    assert.ok(JSON.stringify(blocks[1]).includes('Broken formatting paragraph.'));
});

test('block-level isolation refuses ambiguous anchors or unproven card-vs-gap ordering', () => {
    const sources = new Map([['spp_ok', [{ id: 'citation-0', url: 'https://example.com/ok' }]]]);
    // Ambiguous repeated anchor paragraph in Markdown -> must fall back cleanly without guessing
    const ambiguous = parseGeminiBody(
        'Repeated anchor.\n\nGap one.\n\nRepeated anchor.\n\nGap two.',
        {
            children: [
                { nodeType: 18, text: 'Repeated anchor.', annotations: [{ start: 0, end: 8, type: 'source', sourceIds: ['spp_ok'] }] },
                { nodeType: 18, text: 'Broken', annotations: [{ start: 0, end: 999, type: 0 }] },
            ],
        },
        { diagnostics: [], sourceRef: { providerId: 'gemini', locator: 'test' }, sourceCitations: sources },
    );
    assert.equal(ambiguous.length, 4);
    assert.equal(JSON.stringify(ambiguous).includes('citationRef'), false, 'ambiguous anchor alignment must fall back conservatively');

    // Card and rejected node sharing the same interval with leftover Markdown -> order unproven -> refuse
    const unprovenOrder = parseGeminiBody(
        'Anchor.\n\nUnordered gap prose.',
        {
            children: [
                { nodeType: 18, text: 'Anchor.', annotations: [{ start: 0, end: 6, type: 'source', sourceIds: ['spp_ok'] }] },
                { nodeType: 'fragment', children: [{ nodeType: 18, text: 'Card text absent from Markdown.' }] },
                { nodeType: 18, text: 'Broken', annotations: [{ start: 0, end: 999, type: 0 }] },
            ],
        },
        { diagnostics: [], sourceRef: { providerId: 'gemini', locator: 'test' }, sourceCitations: sources },
    );
    assert.equal(unprovenOrder.length, 2);
    assert.equal(JSON.stringify(unprovenOrder).includes('Card text absent from Markdown.'), false);
});

test('empty candidate BODY never concatenates sibling metadata or artifact labels as answer text or legacy citations', () => {
    const candidate: unknown[] = [
        'rc_empty_body',
        [''],
        [[['quoted'], [1], [['https://example.com/meta-only', 'Meta Source']], 'spp_meta']],
    ];
    candidate[30] = [['artifact_id', null, 'Internal Artifact Label', null, 'Artifact body']];
    const turn = [['c_chat', 'r_req'], [1700000000, 0], [['User prompt']], [[candidate]]];
    const decoded = decodeTurn(turn);
    assert.ok(decoded?.candidate);
    assert.equal(decoded.candidate.text, '', 'sibling metadata/artifact strings must not leak into empty answer text');
    assert.deepEqual(decoded.candidate.citations, [], 'sibling sourceMetadata tuples must not leak into legacy body citations');
});

test('valid inline user image tuples do not duplicate as phantom user file attachments', () => {
    const imgUrl = 'https://lh3.googleusercontent.com/rd-gg/user-upload-screenshot';
    const rawTurn = [
        ['c_chat', 'r_req'],
        [1700000000, 0],
        [['Describe this screenshot', [imgUrl, 1280, 720, 'img_tok_1']]],
        [[['rc_ans', [['It shows a dashboard.']]]]],
    ];
    const userResources = decodeGeminiUserResources(rawTurn);
    assert.equal(userResources.images.length, 1);
    assert.equal(userResources.images[0].sourceUrl, imgUrl);
    assert.deepEqual(userResources.files, [], 'valid inline image must not also produce a phantom attachment file');

    const parsedTurn = decodeTurn(rawTurn);
    assert.ok(parsedTurn);
    const messages = decodeGeminiTurn(parsedTurn, rawTurn);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].attachments?.length, 1);
    assert.equal(messages[0].attachments?.[0].type, 'image');
});
