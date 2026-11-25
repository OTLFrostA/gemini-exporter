import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
    compareConversationIndexes,
    mergeConversationIndex,
    type DomainConversationIndex,
} from '../src/l2/conversationIndex.js';
import { TITLE_AUTHORITY_RANK, type TitleSource } from '../src/l2/titleAuthority.js';
import { selectConversationDetail, type DomainConversationDetail } from '../src/l2/conversationDetail.js';
import { CoverageSession, emptyStream } from '../src/l2/streamCoverage.js';

const SEED = 20261124;
const ACCOUNT_ID = '10000000-0000-4000-8000-000000000001';
const CONV_KEY = { accountId: ACCOUNT_ID, conversationId: 'fuzz-conv-1' };

const titleSourceArb = fc.constantFrom<TitleSource>('derived', 'provider', 'user');
const safeTimeArb = fc.option(fc.integer({ min: 0, max: 2_000_000_000_000 }), { nil: undefined });

const indexArb: fc.Arbitrary<DomainConversationIndex> = fc.record({
    titlePair: fc.option(
        fc.tuple(
            fc.string({ minLength: 1, maxLength: 30 }).map(s => s.trim() || 'Title'),
            titleSourceArb,
        ),
        { nil: undefined },
    ),
    createdAt: safeTimeArb,
    updatedAt: safeTimeArb,
    activityAt: safeTimeArb,
}).map(({ titlePair, createdAt, updatedAt, activityAt }) => ({
    key: { ...CONV_KEY },
    ...(titlePair ? { title: titlePair[0], titleSource: titlePair[1] } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(activityAt !== undefined ? { activityAt } : {}),
}));

test('fuzz: mergeConversationIndex satisfies idempotence, timestamp monotonicity, and title authority dominance', () => {
    fc.assert(
        fc.property(indexArb, indexArb, (a, b) => {
            // Idempotence
            assert.deepEqual(mergeConversationIndex(a, a), a);

            const merged = mergeConversationIndex(a, b);
            assert.deepEqual(merged.key, CONV_KEY);

            // Timestamp monotonicity
            if (a.createdAt !== undefined && b.createdAt !== undefined) {
                assert.equal(merged.createdAt, Math.min(a.createdAt, b.createdAt));
            } else {
                assert.equal(merged.createdAt, a.createdAt ?? b.createdAt);
            }
            if (a.updatedAt !== undefined && b.updatedAt !== undefined) {
                assert.equal(merged.updatedAt, Math.max(a.updatedAt, b.updatedAt));
            } else {
                assert.equal(merged.updatedAt, a.updatedAt ?? b.updatedAt);
            }
            if (a.activityAt !== undefined && b.activityAt !== undefined) {
                assert.equal(merged.activityAt, Math.max(a.activityAt, b.activityAt));
            } else {
                assert.equal(merged.activityAt, a.activityAt ?? b.activityAt);
            }

            // Title authority dominance
            const rankA = a.title && a.titleSource ? TITLE_AUTHORITY_RANK[a.titleSource] : -1;
            const rankB = b.title && b.titleSource ? TITLE_AUTHORITY_RANK[b.titleSource] : -1;
            const maxRank = Math.max(rankA, rankB);
            if (maxRank >= 0) {
                assert.ok(merged.titleSource !== undefined);
                assert.equal(TITLE_AUTHORITY_RANK[merged.titleSource], maxRank);
            } else {
                assert.equal(merged.title, undefined);
                assert.equal(merged.titleSource, undefined);
            }
        }),
        { seed: SEED, numRuns: 200 },
    );
});

test('fuzz: compareConversationIndexes forms a strict weak ordering without NaN', () => {
    fc.assert(
        fc.property(indexArb, indexArb, indexArb, (a, b, c) => {
            const aa = compareConversationIndexes(a, a);
            const ab = compareConversationIndexes(a, b);
            const ba = compareConversationIndexes(b, a);
            const bc = compareConversationIndexes(b, c);
            const ac = compareConversationIndexes(a, c);

            assert.equal(Number.isNaN(aa), false);
            assert.equal(Number.isNaN(ab), false);
            assert.equal(aa, 0);
            assert.equal(Math.sign(ab), -Math.sign(ba));
            if (ab <= 0 && bc <= 0) assert.ok(ac <= 0, 'Comparator must be transitive');
            if (ab >= 0 && bc >= 0) assert.ok(ac >= 0, 'Comparator must be transitive');
        }),
        { seed: SEED + 1, numRuns: 200 },
    );
});

const detailArb: fc.Arbitrary<DomainConversationDetail> = fc.record({
    status: fc.constantFrom<'complete' | 'partial' | 'unknown'>('complete', 'partial', 'unknown'),
    savedAt: safeTimeArb,
    msgCount: fc.integer({ min: 0, max: 5 }),
}).map(({ status, savedAt, msgCount }) => ({
    key: { ...CONV_KEY },
    ...(savedAt !== undefined ? { savedAt } : {}),
    quality: { status },
    assets: [],
    messages: Array.from({ length: msgCount }, (_, i) => ({
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text: `msg-${i}` }] }],
    })),
}));

test('fuzz: selectConversationDetail enforces idempotence, completeness protection, and version monotonicity', () => {
    fc.assert(
        fc.property(detailArb, detailArb, (existing, incoming) => {
            assert.strictEqual(selectConversationDetail(existing, existing), existing);
            const selected = selectConversationDetail(existing, incoming);

            // Completeness protection: never downgrade complete -> incomplete
            if (existing.quality.status === 'complete' && incoming.quality.status !== 'complete') {
                assert.strictEqual(selected, existing);
            }
            // Upgrade incomplete -> complete always wins
            if (existing.quality.status !== 'complete' && incoming.quality.status === 'complete') {
                assert.strictEqual(selected, incoming);
            }
            // Same completeness class: never drop savedAt or regress to an older savedAt
            const sameClass = (existing.quality.status === 'complete') === (incoming.quality.status === 'complete');
            if (sameClass && existing.savedAt !== undefined) {
                if (incoming.savedAt === undefined || incoming.savedAt < existing.savedAt) {
                    assert.strictEqual(selected, existing);
                } else {
                    assert.strictEqual(selected, incoming);
                }
            }
        }),
        { seed: SEED + 2, numRuns: 200 },
    );
});

test('fuzz: CoverageSession handles random valid/invalid/conflicting page sequences and >2000-page cap without losing anchor', () => {
    const pageOpArb = fc.record({
        requestCursor: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 6 }).map(n => `c${n}`)),
        nextCursor: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 6 }).map(n => `c${n}`)),
        requestedAt: fc.integer({ min: 1000, max: 2000 }),
        valid: fc.boolean(),
        ordered: fc.boolean(),
        requestKnown: fc.boolean(),
        keyCount: fc.integer({ min: 0, max: 3 }),
        baseTime: fc.integer({ min: 100, max: 500 }),
    });

    fc.assert(
        fc.property(fc.array(pageOpArb, { minLength: 1, maxLength: 30 }), (ops) => {
            const session = new CoverageSession();
            let coverage = emptyStream();
            for (let i = 0; i < ops.length; i++) {
                const op = ops[i];
                const keys = Array.from({ length: op.keyCount }, (_, k) => ({
                    id: `k-${i}-${k}`,
                    time: op.baseTime - k,
                }));
                coverage = session.observe(coverage, {
                    providerId: 'gemini',
                    accountId: ACCOUNT_ID,
                    streamId: 'recent',
                    requestCursor: op.requestCursor,
                    nextCursor: op.nextCursor,
                    requestedAt: op.requestedAt,
                    requestKnown: op.requestKnown,
                    valid: op.valid,
                    ordered: op.ordered,
                    keys,
                });
                assert.ok(coverage && ('range' in coverage));
                if (coverage.range) {
                    assert.ok(coverage.range.head.time >= coverage.range.tail.time);
                }
            }
        }),
        { seed: SEED + 3, numRuns: 100 },
    );

    // Explicit >2000-page eviction invariant: null anchor must survive
    const session = new CoverageSession();
    let coverage = emptyStream();
    coverage = session.observe(coverage, {
        providerId: 'gemini', accountId: ACCOUNT_ID, streamId: 'recent',
        requestCursor: null, nextCursor: 'p1', requestedAt: 1,
        requestKnown: true, valid: true, ordered: true,
        keys: [{ id: 'head', time: 10_000 }],
    });
    for (let i = 1; i <= 2050; i++) {
        coverage = session.observe(coverage, {
            providerId: 'gemini', accountId: ACCOUNT_ID, streamId: 'recent',
            requestCursor: `orphan-${i}`, nextCursor: `orphan-${i + 1}`, requestedAt: i + 1,
            requestKnown: true, valid: true, ordered: true,
            keys: [{ id: `o-${i}`, time: 9_000 - i }],
        });
    }
    coverage = session.observe(coverage, {
        providerId: 'gemini', accountId: ACCOUNT_ID, streamId: 'recent',
        requestCursor: 'p1', nextCursor: null, requestedAt: 3000,
        requestKnown: true, valid: true, ordered: true,
        keys: [{ id: 'tail', time: 5_000 }],
    });
    assert.equal(session.exhausted(), true, 'Null anchor page must never be evicted under >2000-page load');
    assert.equal(coverage.range?.head.id, 'head');
    assert.equal(coverage.range?.tail.id, 'tail');
});
