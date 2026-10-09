import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import { decodeGeminiDetail, findTurnsDeep } from '../src/core/parsers/gemini/rpc/detailDecoder.js';
import { robustFirstPayload, extractModelCandidates, extractCandidateText, extractThoughts, extractCitations } from '../src/core/parsers/gemini/rpc/extractors.js';
import { extractInnerPayload, extractNextPageToken } from '../src/core/parsers/gemini/rpc/payload.js';
import { extractImages, extractUserFiles, extractDocumentsMeta } from '../src/core/compatibility/gemini/attachments.js';
import { decodeGeminiStructuredPayload } from '../src/core/parsers/gemini/rpc/structuredContent.js';

// Synthetic boundary probes based on existing gemini_parser/parse_observability
// fixtures; they characterize current behavior, not new wire compatibility.
// The final test reuses sanitized Tier-2 wire evidence from PR #705.
const ID = 'c_boundary12345678';
function rpc(inner: unknown, method = 'hNvQHb', header = 'wrb.fr'): string {
    return `)]}'\n\n${JSON.stringify([[header, method, JSON.stringify(inner)]])}`;
}
function turn(prompt = 'Boundary user prompt', seconds: number | null = 1700000000, candidates: unknown[] = [['rc_boundary', [['Boundary model answer'], 'en']]]): unknown[] {
    return [[ID, 'r_AB12'], seconds === null ? null : [seconds, 500000000], [[prompt]], [candidates]];
}

test('wire framing: complete chunks survive a malformed chunk and an unfinished tail', () => {
    const first = ['wrb.fr', 'MaZiqc', '[["quoted [bracket] and \\"escape\\""]]'];
    const second = ['wrb.fr', 'hNvQHb', '[]'];
    const input = `)]}'\n123\n${JSON.stringify([first])}\n[not-json]\n${JSON.stringify([second])}\n[["unfinished`;
    assert.deepEqual(robustFirstPayload(input), [first, second]);
    assert.deepEqual(robustFirstPayload('[["closed string"'), [['closed string']]);
    assert.equal(robustFirstPayload('[["unfinished'), null);
    assert.equal(robustFirstPayload('{"not":"an array"}'), null);
});

test('inner payload decoding does not yet validate the decoded shape', () => {
    for (const inner of [null, [], { unexpected: true }, 42, 'scalar']) {
        const innerStr = JSON.stringify(inner);
        assert.deepEqual(extractInnerPayload([['wrb.fr', 'hNvQHb', innerStr]], { rpcId: 'hNvQHb' }), {
            inner, innerStr, isStandardWrb: true, bardError: null
        });
    }
    assert.deepEqual(extractInnerPayload([['wrb.fr', 'hNvQHb', '[broken']], { rpcId: 'hNvQHb' }), {
        inner: null, innerStr: '[broken', isStandardWrb: true, bardError: null
    });
});

test('list: official timestamp and count slots win while extra fields survive only in raw evidence', () => {
    const row = [ID, 'Boundary title - Gemini', [1690000000], [1680000000], 2, [1700000000, 500000000], null, { extra: true }, null, 7];
    const inner = [null, [row], null, null, 'tC_fallback_cursor', { future: true }];
    const parsed = parseList(rpc(inner, 'MaZiqc'));
    assert.deepEqual(parsed.conversations, [{
        id: 'boundary12345678', title: 'Boundary title', titleSource: 'rpc', titles: { rpc: 'Boundary title' },
        createdAt: 1680000000000, updatedAt: 1700000000500, chatTime: 1700000000500, timestamp: 1700000000500,
        messageCount: 7, url: 'https://gemini.google.com/app/boundary12345678'
    }]);
    assert.equal(parsed.nextPageToken, 'tC_fallback_cursor');
    assert.deepEqual(parsed._raw, inner);
});

test('list: null rows, truncated rows and malformed titles retain current defaults', () => {
    const ids = ['c_missingtitle123', 'c_nulltitle123456', 'c_objecttitle1234', 'c_blanktitle12345'];
    const rows = [null, [], 'not-a-row', [ids[0]], [ids[1], null], [ids[2], { title: 'wrong shape' }], [ids[3], ' \t ']];
    const parsed = parseList(rpc([null, rows], 'MaZiqc'));
    assert.deepEqual(parsed.conversations.map(c => [c.id, c.title, c.titleSource, c.timestamp, c.messageCount]), [
        [ids[0].slice(2), ids[0].slice(2), 'default', null, 0],
        [ids[1].slice(2), ids[1].slice(2), 'default', null, 0],
        [ids[2].slice(2), '', 'default', null, 0],
        [ids[3].slice(2), '', 'default', null, 0]
    ]);
    assert.equal(parseList(rpc([null, null, [[ID, 'Secondary title']]], 'MaZiqc')).conversations[0].title, 'Secondary title');
});

test('missing or malformed envelopes distinguish list diagnostics from detail failures', () => {
    for (const text of ['', 'not-json', '[]', rpc(null), rpc([], 'MaZiqc').replace('"[]"', '"[broken"')]) {
        const list = parseList(text);
        assert.deepEqual(list.conversations, []);
        assert.equal(list.nextPageToken, null);
        assert.equal(list._debug!.error, 'NO_INNER_STR');
    }
    for (const text of ['', '[]', rpc(null), rpc(false)]) assert.throws(() => decodeGeminiDetail(text), /detail parse fail: invalid/);
    const empty = decodeGeminiDetail(rpc([]), ID);
    assert.equal(empty.id, ID);
    assert.deepEqual(empty.messages, []);
    assert.equal(empty.titleSource, 'default');
    assert.equal(empty.timestamp, null);
    assert.equal(empty.schemaDrift, undefined);
    assert.equal(empty._debug!.turnsLen, 0);
    const emptyList = parseList(rpc([null, [], 'tC_empty_page'], 'MaZiqc'));
    assert.deepEqual(emptyList.conversations, []);
    assert.equal(emptyList.nextPageToken, 'tC_empty_page');
    assert.equal(emptyList._debug, undefined);
});

test('detail: reverse wire ordering, candidates and authoritative timestamps remain stable', () => {
    const newest = turn('Newest prompt', 1700000010, [['rc_new_a', [['First variant']]], ['rc_new_b', 'Second variant']]);
    const oldest = turn('Oldest prompt', 1700000000, [['rc_old', [['Old answer']]]]);
    const parsed = decodeGeminiDetail(rpc([[newest, oldest], 'tC_detail_cursor', 'Official detail title', { extra: true }]));
    assert.equal(parsed.id, ID);
    assert.deepEqual(parsed.messages.map(m => [m.role, m.content]), [
        ['user', 'Oldest prompt'], ['model', 'Old answer'], ['user', 'Newest prompt'], ['model', 'First variant']
    ]);
    assert.equal(parsed.messages[0].providerRequestId, 'r_AB12');
    assert.equal(parsed.messages[1].id, 'rc_old');
    assert.equal(parsed.createdAt, 1700000000500);
    assert.equal(parsed.updatedAt, 1700000010500);
    assert.equal(parsed.chatTime, parsed.updatedAt);
    assert.equal(parsed.nextPageToken, 'tC_detail_cursor');
    assert.deepEqual(parsed.titles, { rpc: 'Official detail title' });
    assert.equal(parsed.schemaDrift, undefined);
});

test('detail: absent optional fields and truncated candidates do not fabricate messages or timestamps', () => {
    const userOnly = [[ID], null, [['User only prompt']]];
    const modelOnly = [[ID], null, null, [[['rc_model_only', [['Model only answer']]]]]];
    for (const [wireTurn, expected] of [[userOnly, ['User only prompt']], [modelOnly, ['Model only answer']]] as const) {
        const parsed = decodeGeminiDetail(rpc([[wireTurn]]));
        assert.deepEqual(parsed.messages.map(m => m.content), expected);
        assert.equal(parsed.timestamp, null);
        assert.equal(parsed.createdAt, null);
        assert.equal(parsed.attachmentCount, 0);
        assert.equal(parsed.turnsRejected, undefined);
    }
});

test('detail: extra wrapping and renamed envelope use the existing fallback and report envelope drift', () => {
    const wireTurn = turn();
    const wrapped = { additional: { layers: [[[wireTurn]]] }, extra: true };
    assert.deepEqual(findTurnsDeep(wrapped), [wireTurn]);
    const parsed = decodeGeminiDetail(rpc(wrapped, 'renamedRpc', 'renamedEnvelope'));
    assert.deepEqual(parsed.messages.map(m => m.content), ['Boundary user prompt', 'Boundary model answer']);
    assert.ok(parsed.schemaDrift?.some(w => w.startsWith('Envelope drift:')));
    assert.deepEqual(parsed._debug!.schemaDriftWarnings, parsed.schemaDrift);
    let atLimit: unknown = [wireTurn];
    for (let depth = 0; depth < 6; depth++) atLimit = [atLimit];
    assert.deepEqual(findTurnsDeep(atLimit), [wireTurn]);
    assert.equal(findTurnsDeep([atLimit]), null);
});

test('detail: alternate envelope chunks are searched when the matching RPC has no turns', () => {
    const wireTurn = turn();
    const text = JSON.stringify([['wrb.fr', 'hNvQHb', '[null]'], ['wrb.fr', 'otherRpc', JSON.stringify([[wireTurn]])]]);
    const parsed = decodeGeminiDetail(text);
    assert.equal(parsed.messages.length, 2);
    assert.deepEqual(parsed._raw, [[wireTurn]]);
    assert.equal(parsed.schemaDrift, undefined);
});

test('detail: missing or malformed titles keep the existing newest-wire-prompt fallback', () => {
    for (const title of [undefined, null, [], { title: 'wrong shape' }, '', '  ', 'Google Gemini']) {
        const parsed = decodeGeminiDetail(rpc([[turn('Newest prompt title'), turn('Oldest prompt title')], null, title]));
        assert.equal(parsed.title, 'Newest prompt title');
        assert.equal(parsed.titleSource, 'sniff');
        assert.deepEqual(parsed.titles, { sniff: parsed.title });
    }
    const flatUser = turn();
    flatUser[2] = ['Flat user prompt title'];
    assert.equal(decodeGeminiDetail(rpc([[flatUser]])).title, 'Flat user prompt title');
});

test('detail: metadata-only and undiscoverable-turn payloads retain distinct drift diagnostics', () => {
    const metadata = decodeGeminiDetail(rpc([null, null, [[ID, 'Metadata title']]]));
    assert.deepEqual(metadata.messages, []);
    assert.ok(metadata.schemaDrift?.some(w => w.startsWith('metadata-only payload:')));
    assert.deepEqual(metadata._debug!.schemaDriftWarnings, metadata.schemaDrift);
    const missingTurns = decodeGeminiDetail(rpc([null, { extra: true }]));
    assert.deepEqual(missingTurns.messages, []);
    assert.ok(missingTurns.schemaDrift?.some(w => w.startsWith('Payload drift:')));
});

test('known behavior: rejected turn with a user payload still emits a user message', () => {
    // Known mismatch: turnsRejected counts rejected recognizers, but the message
    // loop does not skip them. Characterize here; fix separately from typing.
    const rejected = [['x_not_a_turn'], null, [['Rejected recognizer prompt']]];
    const parsed = decodeGeminiDetail(rpc([[turn(), rejected]]));
    assert.equal(parsed.turnsRejected, 1);
    assert.equal(parsed.messages[0].content, 'Rejected recognizer prompt');
    assert.equal(parsed.messages[0].role, 'user');
    assert.ok(parsed.schemaDrift?.some(w => w.includes('Turn ID meta')));
});

test('candidate extraction accepts the compact layout without scanning telemetry as variants', () => {
    const compact = [[ID], null, [], [['rc_compact', 'Compact answer'], 'google', 'S', 6]];
    assert.deepEqual(extractModelCandidates(compact), [['rc_compact', 'Compact answer']]);
    assert.equal(extractCandidateText(['rc_parts', [['Part one', [' + part two'], null, 42], 'en']]), 'Part one + part two');
    for (const candidate of [null, [], ['rc_wrong', { wrong: true }]]) assert.equal(extractCandidateText(candidate), '');
});

test('thinking and citation helpers ignore malformed nodes, deduplicate URLs and preserve thought order', () => {
    const body = [['Visible answer'], ['THOUGHT', 'First thought'], [null, 'thought-details', 'Second thought'],
        ['THOUGHT', null], ['https://example.com/source', 'First source title'], ['https://example.com/source', 'Duplicate title'],
        ['https://example.com/malformed', 42], ['https://googleusercontent.com/immersive_entry_chip/a', 'Internal chip']];
    assert.equal(extractThoughts(body), 'First thought\n\nSecond thought');
    assert.deepEqual(extractCitations(body), [{ url: 'https://example.com/source', title: 'First source title' }]);
    const parsed = decodeGeminiDetail(rpc([[turn('Cited prompt', null, [['rc_cited', body]])]]));
    const model = parsed.messages.find(m => m.role === 'model');
    assert.equal(model?.content, 'Visible answer');
    assert.equal(model?.thoughts, 'First thought\n\nSecond thought');
    assert.deepEqual(model?.citations, extractCitations(body));
});

test('attachment helpers ignore null, empty and malformed shapes; valid response images remain attachments', () => {
    for (const raw of [null, [], [null, []], { extra: true }, [['broken.png']]]) {
        assert.deepEqual(extractImages(raw), []);
        assert.deepEqual(extractUserFiles(raw), []);
        assert.deepEqual(extractDocumentsMeta(raw), []);
    }
    const url = 'https://lh3.googleusercontent.com/boundary-image';
    const image = [url, 640, 480, 'boundary-token'];
    const parsed = decodeGeminiDetail(rpc([[turn('Look at the image', null, [['rc_image', [[`![Image](${url})`], image, null, ['broken.png']]]])]]));
    assert.equal(parsed.attachmentCount, 1);
    const model = parsed.messages.find(m => m.role === 'model');
    assert.equal(model?.images?.[0].sourceUrl, url);
    assert.equal(model?.attachments?.[0].type, 'image');
    assert.equal('localName' in model!.attachments![0], false);
    assert.equal(model?.documents, undefined);
});

test('cursor fallback scans extra slots and ignores malformed candidates', () => {
    assert.equal(extractNextPageToken([null, 42, [], { token: 'tC_wrong_shape' }, 'tC_extra']), 'tC_extra');
    assert.equal(extractNextPageToken([null, 'tC_first', 'tC_second']), 'tC_first');
    assert.equal(extractNextPageToken([null, 42, []]), null);
});

test('sanitized Tier-2 wire fixtures retain structured nodes and search images through detail parsing', () => {
    const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures/provider/structured_rpc', name), 'utf8'));
    const candidate = fixture('wire-case-b-cand.json');
    const document = fixture('wire-turn-3-12-b-stack.json');
    const decoded = decodeGeminiStructuredPayload(document);
    assert.ok(decoded);
    assert.equal(decoded.children.length, 49);
    assert.equal(decoded.children.filter(node => node.nodeType === 12).length, 13);
    const wireTurn = turn('Explain Bell inequalities', null, [candidate]);
    assert.ok(Array.isArray(wireTurn[3]));
    wireTurn[3][12] = document;
    const parsed = decodeGeminiDetail(rpc([[wireTurn]]));
    const model = parsed.messages.find(m => m.role === 'model');
    assert.deepEqual(model?.structuredContent, decoded);
    assert.ok(model?.content.includes('CHSH'));
    assert.ok((model?.images?.length ?? 0) > 0);
    assert.equal(parsed.schemaDrift, undefined);
    // A truncated field-12 tree must fall back, retaining the raw answer.
    wireTurn[3][12] = [[[null]]];
    const fallback = decodeGeminiDetail(rpc([[wireTurn]])).messages.find(m => m.role === 'model');
    assert.equal(fallback?.structuredContent, undefined);
    assert.equal(fallback?.content, model?.content);
});


test('known behavior: an ID-only candidate becomes model content through the single-element fallback', () => {
    // Existing fallback treats a one-element candidate as its text body.
    assert.equal(extractCandidateText(['rc_missing']), 'rc_missing');
    const parsed = decodeGeminiDetail(rpc([[turn('Missing body prompt', null, [['rc_missing']])]]));
    assert.equal(parsed.messages.find(m => m.role === 'model')?.content, 'rc_missing');
});

test('known behavior: a malformed image tuple is eligible for generic user-file fallback', () => {
    const raw = [['https://lh3.googleusercontent.com/example', 'wrong-width', 200]];
    assert.deepEqual(extractImages(raw), []);
    assert.deepEqual(extractUserFiles(raw), [{
        sourceUrl: 'https://lh3.googleusercontent.com/example', fileName: 'attachment',
        id: 'wrong-width', thumbnailUrl: undefined
    }]);
    assert.deepEqual(extractDocumentsMeta(raw), []);
});
