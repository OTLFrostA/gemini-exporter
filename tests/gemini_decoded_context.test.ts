import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiRequest } from '../src/l1/parsers/gemini/rpc/request.js';
import { parseGeminiCredential } from '../src/l1/parsers/gemini/credentials.js';

const body = (groups: unknown[]) => new URLSearchParams({ 'f.req': JSON.stringify(groups) }).toString();
const list = ['MaZiqc', JSON.stringify([100, null, [0, null, 1]])];
const detail = ['hNvQHb', JSON.stringify(['c_12345678abcd', 10, 'older', 1, [1], [4], null, 1])];
const deletion = ['GzXR5e', JSON.stringify(['c_12345678abcd'])];

test('one mixed batch decodes once and yields independent, concrete RPC contexts', () => {
    const request = body([[list, detail, deletion, ['unknown', 'broken']]]);
    const batch = new URLSearchParams(request).get('f.req');
    const parse = JSON.parse;
    let batchReads = 0;
    JSON.parse = (text, reviver) => { if (text === batch) batchReads++; return parse(text, reviver); };
    try {
        assert.deepEqual(parseGeminiRequest(request), {
            list: { streamId: 'recent', requestCursor: null },
            detail: { conversationId: '12345678abcd', requestCursor: 'older' },
            deletionId: 'c_12345678abcd',
        });
        assert.equal(batchReads, 1);
    } finally { JSON.parse = parse; }
});

test('duplicate RPC identity is rejected across groups without discarding unrelated valid calls', () => {
    assert.deepEqual(parseGeminiRequest(body([[list, deletion], [list, deletion, detail]])), {
        list: null, deletionId: null, detail: { conversationId: '12345678abcd', requestCursor: 'older' },
    });
    assert.deepEqual(parseGeminiRequest(body([[list, ['hNvQHb', 'broken'], deletion]])), {
        list: { streamId: 'recent', requestCursor: null }, detail: null, deletionId: 'c_12345678abcd',
    });
    for (const raw of [null, {}, '', 'f.req=broken', body([null])]) {
        assert.deepEqual(parseGeminiRequest(raw), { list: null, detail: null, deletionId: null });
    }
});

test('credential boundary rejects wrong field types before bootstrap consumes them', () => {
    const parsed = parseGeminiCredential({ sid: 12, at: {}, bl: 'build', lastUsed: Infinity,
        accountSlot: ['u0'], accountId: 'local-account' });
    assert.equal(parsed.sid, undefined);
    assert.equal(parsed.at, undefined);
    assert.equal(parsed.bl, 'build');
    assert.equal(parsed.lastUsed, undefined);
    assert.equal(parsed.accountSlot, undefined);
    assert.equal(parsed.accountId, 'local-account');
    assert.throws(() => parseGeminiCredential({ sid: 'sid', accountObservation: { providerId: 'gemini' } }));
});
