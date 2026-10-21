import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList } from '../src/l1/parsers/gemini/rpc/parseList.js';
import { geminiListObservation } from '../src/l1/client/gemini/listObservation.js';

const wrb = (rpc: string, inner: unknown): unknown[] => ['wrb.fr', rpc, JSON.stringify(inner)];
const text = (...rows: unknown[][]): string => JSON.stringify(rows);
const row = ['c_verifiedrpc123', 'Verified', null, null, null, [1700000050, 0]];

test('unrelated RPC empty array cannot certify an empty natural LIST terminal', () => {
    const input = text(wrb('hNvQHb', []), ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 429]]);
    const parsed = parseList(input);
    assert.equal(parsed.failure, 'invalid_response');
    assert.equal(parsed.pageEvidence.valid, false);
    assert.deepEqual(parsed.conversations, []);
    const observed = geminiListObservation(parsed, { streamId: 'recent', requestCursor: null }, 'account', false);
    assert.equal(observed.valid, false);
    assert.equal(observed.terminal, undefined);
});

test('missing LIST envelope does not allow non-target rows or terminal sentinels', () => {
    for (const inner of [[], [null, null, [row]], [null, 'tC_next', [row]]]) {
        const parsed = parseList(text(wrb('hNvQHb', inner)));
        assert.equal(parsed.failure, 'invalid_response');
        assert.equal(parsed.pageEvidence.valid, false);
        assert.deepEqual(parsed.conversations, []);
    }
});

test('actual LIST wrapper wins over unrelated RPC output irrespective of row order', () => {
    for (const rows of [[wrb('hNvQHb', []), wrb('MaZiqc', [null, null, [row]])],
        [wrb('MaZiqc', [null, 'tC_next', [row]]), wrb('hNvQHb', [])]]) {
        const parsed = parseList(text(...rows));
        assert.equal(parsed.failure, undefined);
        assert.equal(parsed.conversations[0].id, 'verifiedrpc123');
        assert.equal(parsed.pageEvidence.valid, true);
    }
});

test('only explicit LIST BardErrorInfo 1096 can certify the provider window limit', () => {
    const listLimit = ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]];
    const limited = parseList(text(wrb('hNvQHb', []), listLimit));
    assert.equal(limited.failure, 'hit_google_limit');
    assert.equal(limited.pageEvidence.valid, false);
    const unrelated = parseList(text(['wrb.fr', 'hNvQHb', null, null, null, ['BardErrorInfo', 1096]]));
    assert.equal(unrelated.failure, 'invalid_response');
});

// Error envelope characterized from a live hNvQHb NotFound response, 2026-10-20.
// LIST / 1096 below is a synthetic boundary regression using that native Any schema.
const nativeError = (rpc: string, code: unknown, type = 'type.googleapis.com/assistant.boq.bard.application.BardErrorInfo') =>
    ['wrb.fr', rpc, null, null, null, [5, null, [[type, [code]]]], 'generic'];

test('LIST window limit recognizes the native protobuf Any error envelope', () => {
    const parsed = parseList(text(nativeError('MaZiqc', 1096)));
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
    for (const packet of [nativeError('hNvQHb', 1096), nativeError('MaZiqc', 1167),
        nativeError('MaZiqc', 10961), nativeError('MaZiqc', '1096'),
        nativeError('MaZiqc', 1096, 'type.googleapis.com/other.BardErrorInfo'),
        ['wrb.fr', 'MaZiqc', null, null, null, [1096]],
    ]) {
        const parsed = parseList(text(packet));
        assert.equal(parsed.failure, 'invalid_response');
        assert.equal(parsed.pageEvidence.valid, false);
    }
});
