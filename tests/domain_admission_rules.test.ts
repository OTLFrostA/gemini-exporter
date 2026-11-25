import { describe as __suiteDescribe } from 'node:test';
import { fixtureKey } from "./helpers/domainFixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectConversationDetail } from "../src/l2/conversationDetail.js";
import { type DomainConversationDetail } from "../src/l2/conversationDetail.js";
import test__s1 from "node:test";
import { CoverageSession } from "../src/l2/streamCoverage.js";
import { emptyStream } from "../src/l2/streamCoverage.js";
import { type PageObservation } from "../src/l2/pageObservation.js";
import test__s2 from "node:test";
import { CLOUD_CONVERSATION_SCHEMA } from "../src/l2/cloudPayload.js";
import { CLOUD_CONVERSATION_VERSION } from "../src/l2/cloudPayload.js";
import { decodePortableCloudConversation } from "../src/l2/cloudPayload.js";
import { encodePortableCloudConversation } from "../src/l2/cloudPayload.js";
import { type Account } from "../src/l2/accountRegistry.js";
import { type ReadonlyDomain } from "../src/l2/runtimeValidation.js";

__suiteDescribe("domain_admission_rules", () => {
function snapshot(status: DomainConversationDetail['quality']['status'], count: number, savedAt?: number): DomainConversationDetail {
    return { key: fixtureKey(), ...(savedAt !== undefined ? { savedAt } : {}), quality: { status }, assets: [], messages: Array.from({ length: count }, () => ({ role: 'user' as const, content: [] })) };
}

test('L2 accepts a shorter complete snapshot and never prefers message count', () => {
    const old = snapshot('complete', 10, 10), next = snapshot('complete', 2, 20);
    assert.equal(selectConversationDetail(old, next), next);
});
test('L2 preserves complete content against incomplete captures symmetrically', () => {
    const completeOlder = snapshot('complete', 2, 10);
    const completeUnversioned = snapshot('complete', 2);
    for (const status of ['partial', 'unknown'] as const) {
        const incompleteNewer = snapshot(status, 10, 20);
        assert.equal(selectConversationDetail(completeOlder, incompleteNewer), completeOlder);
        assert.equal(selectConversationDetail(incompleteNewer, completeOlder), completeOlder);
        assert.equal(selectConversationDetail(incompleteNewer, completeUnversioned), completeUnversioned);
    }
});
test('L2 replaces two incomplete snapshots in admission order, including shorter snapshots', () => {
    const old = snapshot('unknown', 10), next = snapshot('partial', 2);
    assert.equal(selectConversationDetail(old, next), next);
});
test('L2 preserves a known source version against older or unversioned replacements', () => {
    const old = snapshot('unknown', 2, 20), stale = snapshot('unknown', 10, 10);
    assert.equal(selectConversationDetail(old, stale), old);
    const unversioned = snapshot('unknown', 1);
    assert.equal(selectConversationDetail(old, unversioned), old);
    assert.equal(selectConversationDetail(unversioned, old), old);
    assert.equal(selectConversationDetail(undefined, stale), stale);
});
});

__suiteDescribe("stream_coverage", () => {
function page(times: number[], requestCursor: string | null = null, nextCursor: string | null = null): PageObservation {
    return { providerId: 'other-provider', accountId: 'a', streamId: 'activity', requestCursor, nextCursor,
        requestKnown: true, requestedAt: 1, valid: true, ordered: true, keys: times.map(time => ({ id: 'id' + time, time })) };
}
test__s1('partial and disconnected pages never establish a new trusted history boundary', () => {
    const s = new CoverageSession();
    assert.deepEqual(s.observe(emptyStream(), page([100, 90], null, 'next')), { range: null });
    assert.deepEqual(s.observe(emptyStream(), page([80], 'unrelated')), { range: null });
    assert.equal(s.exhausted(), false);
});
test__s1('out of order arrival and repeated identical pages certify the same terminal chain', () => {
    const pages = [page([100, 90], null, 'next'), page([80, 70], 'next')];
    for (const order of [[0, 1], [1, 0], [1, 1, 0, 0]]) {
        const s = new CoverageSession(); let result = emptyStream();
        for (const i of order) result = s.observe(result, pages[i]);
        assert.deepEqual(result, { range: { head: pages[0].keys[0], tail: pages[1].keys[1] } });
        assert.equal(s.exhausted(), true);
    }
});
test__s1('a provider history limit is a terminal boundary only behind a continuous head chain', () => {
    const s = new CoverageSession(), head = page([100], null, 'limit');
    const limit = { ...page([], 'limit'), terminal: 'provider_limit' as const };
    assert.deepEqual(s.observe(emptyStream(), limit), emptyStream());
    assert.deepEqual(s.observe(emptyStream(), head), { range: { head: head.keys[0], tail: head.keys[0] } });
});
test__s1('interruption retains the prior range, and only a connected current head can extend it', () => {
    const prior = { range: { head: { id: 'old100', time: 100 }, tail: { id: 'old70', time: 70 } } };
    const s = new CoverageSession(), head = page([120, 110], null, 'bridge');
    assert.deepEqual(s.observe(prior, head), prior);
    s.observe(prior, page([105, 85], 'unrelated', 'unread'));
    assert.equal(s.connects(prior, head), false);
    s.observe(prior, page([105, 85], 'bridge', 'unread'));
    assert.equal(s.connects(prior, head), true);
    assert.deepEqual(s.extend(prior), { range: { head: head.keys[0], tail: prior.range.tail } });
    assert.equal(s.connects(emptyStream(), head), false);
});
test__s1('invalid evidence, cursor loops and repeated IDs cannot certify a terminal chain', () => {
    for (const kind of ['invalid', 'unknown', 'loop', 'duplicate', 'missing']) {
        const s = new CoverageSession(), head = page([100], null, 'next');
        s.observe(emptyStream(), head);
        const tail = page([80], kind === 'missing' ? 'unrelated' : 'next');
        if (kind === 'invalid') tail.valid = false;
        if (kind === 'unknown') tail.requestKnown = false;
        if (kind === 'loop') tail.nextCursor = 'next';
        if (kind === 'duplicate') tail.keys[0].id = head.keys[0].id;
        assert.deepEqual(s.observe(emptyStream(), tail), emptyStream(), kind);
        assert.equal(s.exhausted(), false, kind);
    }
});
test__s1('complete disjoint snapshots replace the old boundary; empty history retains only range null', () => {
    const prior = { range: { head: { id: 'old', time: 100 }, tail: { id: 'tail', time: 70 } } };
    assert.deepEqual(new CoverageSession().observe(prior, page([200, 150])), { range: { head: { id: 'id200', time: 200 }, tail: { id: 'id150', time: 150 } } });
    assert.deepEqual(new CoverageSession().observe(prior, page([])), emptyStream());
});
test__s1('unordered source rows never certify Coverage or a trusted early-stop boundary', () => {
    const s = new CoverageSession();
    assert.deepEqual(s.observe(emptyStream(), { ...page([100, 60, 90], null, 'tail'), ordered: false }), emptyStream());
    assert.deepEqual(s.observe(emptyStream(), page([80, 50], 'tail')), emptyStream());
    assert.equal(s.exhausted(), false);
});
test__s1('a cursor link cannot stitch pages of different accounts, streams or acquisition order', () => {
    for (const patch of [{ accountId: 'other' }, { streamId: 'other' }, { providerId: 'other' }, { requestedAt: 0 }]) {
        const s = new CoverageSession(), head = page([100], null, 'next');
        s.observe(emptyStream(), head);
        assert.deepEqual(s.observe(emptyStream(), { ...page([90], 'next'), ...patch }), emptyStream());
        assert.equal(s.exhausted(), false);
    }
    const crossPageTime = new CoverageSession();
    crossPageTime.observe(emptyStream(), page([100], null, 'next'));
    assert.deepEqual(crossPageTime.observe(emptyStream(), page([110], 'next')), emptyStream());
});

test__s1('Coverage observations require safe-integer Unix milliseconds, not merely finite numbers', () => {
    for (const time of [0.5, Number.MAX_SAFE_INTEGER + 1]) {
        const session = new CoverageSession();
        assert.deepEqual(session.observe(emptyStream(), page([time])), emptyStream());
        assert.equal(session.exhausted(), false);
        assert.deepEqual(session.observe(emptyStream(), { ...page([100]), requestedAt: time }), emptyStream());
    }
});

test__s1('replayed Coverage observations identify keys by ID and source time, not object property order', () => {
    const s = new CoverageSession();
    const head = page([100], null, 'next');
    assert.deepEqual(s.observe(emptyStream(), head), emptyStream());
    const replay = { ...head, keys: [{ time: 100, id: 'id100' }] };
    assert.deepEqual(s.observe(emptyStream(), replay), emptyStream());
    const tail = page([80], 'next');
    assert.deepEqual(s.observe(emptyStream(), tail), { range: { head: head.keys[0], tail: tail.keys[0] } });
});

test__s1('Coverage caches only cursor evidence, never extra properties', () => {
    const s = new CoverageSession();
    const rows = [{ token: 'source-only-secret' }];
    const observation = {
        ...page([100]), items: rows,
    };
    assert.deepEqual(s.observe(emptyStream(), observation), {
        range: { head: observation.keys[0], tail: observation.keys[0] },
    });
    const pages: unknown = Reflect.get(s, 'pages');
    assert.ok(pages instanceof Map);
    const retained: unknown = pages.get(null);
    assert.ok(retained && typeof retained === 'object');
    assert.notStrictEqual(retained, observation);
    assert.equal(Object.hasOwn(retained, 'items'), false, 'source items must not be retained in coverage');
});

test__s1('Coverage early-stop matching accepts evidence without source items', () => {
    const prior = { range: { head: { id: 'old100', time: 100 }, tail: { id: 'old70', time: 70 } } };
    const s = new CoverageSession();
    const head = page([120, 110], null, 'bridge');
    s.observe(prior, head);
    s.observe(prior, page([105, 85], 'bridge', 'more'));
    assert.equal(s.connects(prior, head), true);
});

test__s1('Coverage page cap eviction never deletes the null anchor page', () => {
    const s = new CoverageSession();
    const head = page([10_000], null, 'p1');
    s.observe(emptyStream(), head);
    for (let i = 1; i <= 2005; i++) {
        s.observe(emptyStream(), page([10_000 - i], `p${i}`, `p${i + 1}`));
    }
    const pages: unknown = Reflect.get(s, 'pages');
    assert.ok(pages instanceof Map);
    assert.equal(pages.size, 2000);
    assert.ok(pages.has(null), 'null anchor page must survive cap eviction');
});
});

__suiteDescribe("domain_cloud_payload", () => {
const DEVICE_A_ACCOUNT: Account = {
    id: '11111111-1111-4111-8111-111111111111',
    providerId: 'gemini',
    providerAccountId: '109876543210',
    email: 'alice@example.com',
    displayName: 'Alice',
};

function richConversation(accountId = DEVICE_A_ACCOUNT.id, conversationId = 'c_rich_01'): ReadonlyDomain {
    const key = { accountId, conversationId };
    return {
        index: {
            key,
            title: 'Quantum Harmonic Oscillator',
            titleSource: 'provider',
            createdAt: 1700000000000,
            updatedAt: 1700000500000,
        },
        detail: {
            key,
            savedAt: 1700000500000,
            quality: { status: 'complete', sourceTurn: 'finished' },
            assets: [
                {
                    id: 'img-gen-1',
                    kind: 'image',
                    name: 'wavefunction.png',
                    mediaType: 'image/png',
                    sourceUri: 'https://lh3.googleusercontent.com/d/durable-asset',
                    generation: { prompt: 'Plot ground state wavefunction', imageOrdinal: 0 },
                },
                {
                    id: 'canvas-doc-1',
                    kind: 'file',
                    name: 'solver.py',
                    mediaType: 'text/x-python',
                    document: { id: 'doc-1', contentMarkdown: '```python\nimport numpy as np\n```' },
                },
            ],
            messages: [
                {
                    id: 'm-1',
                    role: 'user',
                    timestamp: 1700000001000,
                    content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Derive the ground state energy.' }] }],
                },
                {
                    id: 'm-2',
                    role: 'assistant',
                    model: 'gemini-2.5-pro',
                    timestamp: 1700000005000,
                    reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Use ladder operators.' }] }],
                    citations: [{ id: 'cit-1', url: 'https://example.edu/qm', title: 'QM Notes' }],
                    attachmentIds: ['img-gen-1', 'canvas-doc-1'],
                    content: [
                        {
                            type: 'paragraph',
                            children: [
                                { type: 'text', text: 'Ground state energy is ' },
                                { type: 'inlineMath', source: '\\frac{1}{2}\\hbar\\omega' },
                                { type: 'citationRef', citationId: 'cit-1', label: '1' },
                            ],
                        },
                        { type: 'math', source: 'H|0\\rangle = \\frac{1}{2}\\hbar\\omega|0\\rangle' },
                        { type: 'image', assetId: 'img-gen-1', alt: 'Wavefunction' },
                        { type: 'file', assetId: 'canvas-doc-1', label: 'solver.py' },
                    ],
                },
            ],
        },
    };
}

test__s2('L2 cloudPayload strips device-local Account UUID and preserves full semantic AST, reasoning, citations, and Canvas text', () => {
    const conv = richConversation();
    const encoded = encodePortableCloudConversation(DEVICE_A_ACCOUNT, conv);
    assert.ok(!encoded.includes(DEVICE_A_ACCOUNT.id), 'device-local Account UUID must never appear in portable cloud JSON');

    const decoded = decodePortableCloudConversation(encoded);
    assert.equal(decoded.schema, CLOUD_CONVERSATION_SCHEMA);
    assert.equal(decoded.version, CLOUD_CONVERSATION_VERSION);
    assert.deepEqual(decoded.account, {
        providerId: 'gemini',
        providerAccountId: '109876543210',
        email: 'alice@example.com',
        displayName: 'Alice',
    });
    assert.equal(decoded.conversationId, 'c_rich_01');
    assert.equal('key' in decoded.index, false);
    assert.ok(decoded.detail);
    assert.equal('key' in decoded.detail, false);
    assert.equal(decoded.index.title, 'Quantum Harmonic Oscillator');
    assert.deepEqual(decoded.detail.messages, conv.detail?.messages);
    assert.equal(decoded.detail?.assets[1]?.document?.contentMarkdown, '```python\nimport numpy as np\n```');

    // Privacy-minimal Index-only mode omits detail completely
    const indexOnlyJson = encodePortableCloudConversation(DEVICE_A_ACCOUNT, { index: conv.index });
    assert.equal(indexOnlyJson.includes('messages'), false);
    assert.equal(indexOnlyJson.includes('Derive the ground state energy'), false);
    const decodedIndexOnly = decodePortableCloudConversation(indexOnlyJson);
    assert.equal(decodedIndexOnly.detail, undefined);
    assert.equal(decodedIndexOnly.index.title, 'Quantum Harmonic Oscillator');
});

test__s2('L2 cloudPayload rejects default placeholder accounts, key mismatches, dangling references, and malformed schemas', () => {
    const conv = richConversation();
    assert.throws(
        () => encodePortableCloudConversation({ ...DEVICE_A_ACCOUNT, providerAccountId: 'default' }, conv),
        /default placeholder/,
    );
    assert.throws(
        () => encodePortableCloudConversation({ ...DEVICE_A_ACCOUNT, id: '22222222-2222-4222-8222-222222222222' }, conv),
        /mismatch/,
    );

    const validRaw = JSON.parse(encodePortableCloudConversation(DEVICE_A_ACCOUNT, conv)) as Record<string, unknown>;

    // Extra top-level property
    assert.throws(() => decodePortableCloudConversation(JSON.stringify({ ...validRaw, extra: 1 })), /Unexpected top-level/);
    // Wrong version
    assert.throws(() => decodePortableCloudConversation(JSON.stringify({ ...validRaw, version: 99 })), /Unsupported/);
    // Embedded local key in detail
    assert.throws(
        () => decodePortableCloudConversation(JSON.stringify({
            ...validRaw,
            detail: { ...(validRaw.detail as object), key: { accountId: DEVICE_A_ACCOUNT.id, conversationId: 'c_rich_01' } },
        })),
        /Invalid portable Detail/,
    );
    // Dangling assetId reference violates L2 closure
    assert.throws(
        () => decodePortableCloudConversation(JSON.stringify({
            ...validRaw,
            detail: { ...(validRaw.detail as object), assets: [] },
        })),
        /asset|closure|reference/i,
    );
    // Signed / ephemeral URL in sourceUri is rejected by L2 schema
    assert.throws(
        () => decodePortableCloudConversation(JSON.stringify({
            ...validRaw,
            detail: {
                ...(validRaw.detail as object),
                assets: [{ id: 'img-gen-1', kind: 'image', sourceUri: 'https://example.com/a.png?X-Amz-Signature=secret' }, (validRaw.detail as { assets: unknown[] }).assets[1]],
            },
        })),
        /Invalid persisted Domain contract/,
    );
});
});
