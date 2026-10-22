import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geminiListFixtures } from './fixtures/providers/gemini.js';
import { geminiListObservation } from '../src/l1/client/gemini/listObservation.js';


test('unrelated RPC empty array cannot certify an empty natural LIST terminal', () => {
    const parsed = geminiListFixtures.rpcIsolationUnrelatedError();
    assert.equal(parsed.failure, 'invalid_response');
    assert.equal(parsed.pageEvidence.valid, false);
    assert.deepEqual(parsed.conversations, []);
    const observed = geminiListObservation(parsed, { streamId: 'recent', requestCursor: null }, 'account', false);
    assert.equal(observed.valid, false);
    assert.equal(observed.terminal, undefined);
});

test('missing LIST envelope does not allow non-target rows or terminal sentinels', () => {
    for (const parsed of geminiListFixtures.rpcIsolationMissingEnvelope()) {
        assert.equal(parsed.failure, 'invalid_response');
        assert.equal(parsed.pageEvidence.valid, false);
        assert.deepEqual(parsed.conversations, []);
    }
});

test('actual LIST wrapper wins over unrelated RPC output irrespective of row order', () => {
    for (const parsed of geminiListFixtures.rpcIsolationTargetWins()) {
        assert.equal(parsed.failure, undefined);
        assert.equal(parsed.conversations[0].id, 'verifiedrpc123');
        assert.equal(parsed.pageEvidence.valid, true);
    }
});

test('only explicit LIST BardErrorInfo 1096 can certify the provider window limit', () => {
    const { limited, unrelated } = geminiListFixtures.rpcIsolationProviderLimit();
    assert.equal(limited.failure, 'hit_google_limit');
    assert.equal(limited.pageEvidence.valid, false);
    assert.equal(unrelated.failure, 'invalid_response');
});

test('LIST window limit recognizes the native protobuf Any error envelope', () => {
    const parsed = geminiListFixtures.rpcIsolationNativeLimit();
    assert.equal(parsed.failure, 'hit_google_limit');
    const bound = geminiListObservation(parsed, { streamId: 'recent', requestCursor: 'tC_last' }, 'account');
    assert.equal(bound.valid, true);
    assert.equal(bound.ordered, true);
    assert.equal(bound.terminal, 'provider_limit');
    for (const request of [{ streamId: 'recent' as const, requestCursor: null },
        { streamId: 'pinned' as const, requestCursor: 'tC_last' }]) {
        assert.equal(geminiListObservation(parsed, request, 'account').valid, false);
    }
});

test('native error envelopes still require the exact type, numeric code, and target LIST RPC', () => {
    for (const parsed of geminiListFixtures.rpcIsolationInvalidNativeErrors()) {
        assert.equal(parsed.failure, 'invalid_response');
        assert.equal(parsed.pageEvidence.valid, false);
    }
});
