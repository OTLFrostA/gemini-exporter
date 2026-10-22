import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiListFixtures } from './fixtures/providers/gemini.js';
import { geminiListObservation } from '../src/l1/client/gemini/listObservation.js';
import { readGeminiListRequest } from '../src/l1/parsers/gemini/rpc/listRequest.js';
test('active and passive normalization retain identical independent cursor and ordering evidence', () => {
    for (const streamId of ['recent', 'pinned'] as const) {
        const result = geminiListFixtures.observationOrderedPage();
        const request = readGeminiListRequest(geminiListFixtures.observationRequest(streamId, 'incoming'));
        assert.deepEqual(request, { streamId, requestCursor: 'incoming' });
        const observation = geminiListObservation(result, request, 'account');
        assert.equal(observation.providerId, 'gemini');
        assert.equal(observation.accountId, 'account');
        assert.equal(observation.streamId, streamId);
        assert.equal(observation.requestKnown, true);
        assert.equal(observation.requestCursor, 'incoming');
        assert.equal(observation.nextCursor, null);
        assert.equal(observation.valid, true);
        assert.deepEqual(observation.keys, [
            { id: 'abcdef123', time: 1700000020000 },
            { id: 'abcdef456', time: 1700000010000 },
        ]);
        assert.equal(observation.ordered, streamId === 'recent');
    }
});
test('fallback timestamps, rising times, malformed or truncated responses cannot certify ordering', () => {
    const request = { streamId: 'recent' as const, requestCursor: null };
    assert.equal(geminiListObservation(geminiListFixtures.observationFallbackTimePage(), request, 'account').ordered, false);
    const parsed = geminiListFixtures.observationRisingTimePage();
    assert.equal(geminiListObservation(parsed, request, 'account').ordered, false);
    assert.equal(geminiListObservation(parsed, request, 'account', true).valid, false);
    assert.equal(geminiListObservation(parsed, null, 'account').requestKnown, false);
    assert.equal(readGeminiListRequest(geminiListFixtures.observationUnknownRequest()), null);
});

test('captured empty Gemini list payload [] is valid exhaustion, while unknown nonempty shapes are not', () => {
    const empty = geminiListFixtures.observationCapturedEmpty();
    assert.equal(geminiListObservation(empty, { streamId: 'pinned', requestCursor: null }, 'account').valid, true);
    assert.equal(geminiListObservation(empty, { streamId: 'recent', requestCursor: null }, 'account').ordered, true);
    assert.equal(geminiListObservation(geminiListFixtures.observationUnknownNonempty(), { streamId: 'recent', requestCursor: null }, 'account').valid, false);
});

test('different conversations with equal official timestamps retain ordering evidence', () => {
    const request = { streamId: 'recent' as const, requestCursor: null };
    const parsed = geminiListFixtures.observationEqualTimes();
    const observation = geminiListObservation(parsed, request, 'account');
    assert.equal(observation.valid, true);
    assert.equal(observation.ordered, true);
    assert.equal(observation.keys[0].time, observation.keys[1].time);
    assert.equal(geminiListObservation(geminiListFixtures.observationSubsecondTie(), request, 'account').ordered, true);
    const duplicate = geminiListObservation(geminiListFixtures.observationDuplicate(), request, 'account');
    assert.equal(duplicate.valid, false);
    assert.equal(duplicate.ordered, false);
});

test('captured expanded webpage recent filter establishes request identity without accepting arbitrary layouts', () => {
    const { valid, invalid } = geminiListFixtures.observationExpandedRequests();
    assert.deepEqual(readGeminiListRequest(valid), { streamId: 'recent', requestCursor: null });
    for (const request of invalid) {
        assert.equal(readGeminiListRequest(request), null);
    }
});

test('list coverage uses the parser failure outcome, never the diagnostic payload', () => {
    const result = geminiListFixtures.observationSinglePage();
    const request = { streamId: 'recent' as const, requestCursor: null };
    const debug = { error: 'NO_INNER_STR' as const, bardError: null, textLen: 3, rawPreview: 'bad', topParsed: null };
    assert.deepEqual(geminiListObservation({ ...result, _debug: debug }, request, 'account'),
        geminiListObservation(result, request, 'account'));
    assert.equal(geminiListObservation({ ...result, failure: 'invalid_response' }, request, 'account').valid, false);
});
