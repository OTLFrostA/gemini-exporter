import test from 'node:test';
import assert from 'node:assert/strict';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import { geminiListObservation, readGeminiListRequest } from '../src/core/provider/gemini/listObservation.js';
const wire = (rows: unknown[], token: string | null = null) => JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, token, rows])]]);
const row = (id: string, seconds: number) => ['c_' + id, id, null, null, null, [seconds, 0]];
const body = (filter: unknown, cursor: unknown = null) => new URLSearchParams({ 'f.req': JSON.stringify([[['MaZiqc', JSON.stringify([50, cursor, filter]), null, 'generic']]]) }).toString();
test('active and passive normalization retain identical independent cursor and ordering evidence', () => {
    for (const streamId of ['recent', 'pinned'] as const) {
        const result = parseList(wire([row('abcdef123', 1700000020), row('abcdef456', 1700000010)]));
        const request = readGeminiListRequest(body([streamId === 'recent' ? 0 : 1, null, 1], 'incoming'));
        assert.deepEqual(request, { streamId, requestCursor: 'incoming' });
        assert.deepEqual(geminiListObservation(result, request, 'account'), geminiListObservation(result, { streamId, requestCursor: 'incoming' }, 'account'));
        assert.equal(geminiListObservation(result, request, 'account').ordered, streamId === 'recent');
    }
});
test('fallback timestamps, rising times, malformed or truncated responses cannot certify ordering', () => {
    const request = { streamId: 'recent' as const, requestCursor: null };
    const fallback = row('abcdef123', 1700000020); fallback[2] = fallback[5]; fallback[5] = null;
    assert.equal(geminiListObservation(parseList(wire([fallback])), request, 'account').ordered, false);
    const parsed = parseList(wire([row('abcdef123', 1700000010), row('abcdef456', 1700000020)]));
    assert.equal(geminiListObservation(parsed, request, 'account').ordered, false);
    assert.equal(geminiListObservation(parsed, request, 'account', true).valid, false);
    assert.equal(geminiListObservation(parsed, null, 'account').requestKnown, false);
    assert.equal(readGeminiListRequest(body([2, null, 1])), null);
});

test('captured empty Gemini list payload [] is valid exhaustion, while unknown nonempty shapes are not', () => {
    const empty = parseList(JSON.stringify([['wrb.fr', 'MaZiqc', '[]']]));
    assert.equal(geminiListObservation(empty, { streamId: 'pinned', requestCursor: null }, 'account').valid, true);
    assert.equal(geminiListObservation(empty, { streamId: 'recent', requestCursor: null }, 'account').ordered, true);
    assert.equal(geminiListObservation({ conversations: [], nextPageToken: null, _raw: [null, { unexpected: true }] }, { streamId: 'recent', requestCursor: null }, 'account').valid, false);
});

test('different conversations with equal official timestamps retain ordering evidence', () => {
    const request = { streamId: 'recent' as const, requestCursor: null };
    const parsed = parseList(wire([row('abcdef123', 1700000020), row('abcdef456', 1700000020), row('abcdef789', 1700000010)]));
    const observation = geminiListObservation(parsed, request, 'account');
    assert.equal(observation.valid, true);
    assert.equal(observation.ordered, true);
    assert.equal(observation.keys[0].time, observation.keys[1].time);
    const sameMillisecond = row('abcdef456', 1700000020);
    sameMillisecond[5] = [1700000020, 100];
    assert.equal(geminiListObservation(parseList(wire([sameMillisecond, row('abcdef123', 1700000020)])), request, 'account').ordered, true);
    const duplicate = geminiListObservation(parseList(wire([row('abcdef123', 1700000020), row('abcdef123', 1700000020)])), request, 'account');
    assert.equal(duplicate.valid, false);
    assert.equal(duplicate.ordered, false);
});
