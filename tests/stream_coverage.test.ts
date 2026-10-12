import test from 'node:test';
import assert from 'node:assert/strict';
import { CoverageSession, emptyStream } from '../src/core/sync/streamCoverage.js';
import type { PageObservation } from '../src/core/sync/pageObservation.js';
function page(times: number[], requestCursor: string | null = null, nextCursor: string | null = null): PageObservation<unknown> {
    return { providerId: 'other-provider', accountId: 'a', streamId: 'activity', items: [], requestCursor, nextCursor,
        requestKnown: true, requestedAt: Date.now(), valid: true, ordered: true, keys: times.map(time => ({ id: 'id' + time, time })) };
}
test('partial continuous pages initialize a non-head baseline without claiming full history', () => {
    const session = new CoverageSession();
    const first = session.observe(emptyStream(), page([100, 90], 'incoming', 'next'), true);
    assert.equal(first.initialized, true); assert.equal(first.historyComplete, false);
    const next = session.observe(first, page([80, 70], 'next'), true);
    assert.deepEqual(next.range, { head: { id: 'id100', time: 100 }, tail: { id: 'id70', time: 70 } });
    assert.equal(next.historyComplete, false);
});
test('out-of-order arrivals and duplicates form the same coverage through cursor evidence', () => {
    const pages = [page([100, 90], null, 'next'), page([80, 70], 'next')];
    const outcomes = [[0, 1], [1, 0], [1, 1, 0, 0]].map(order => {
        const session = new CoverageSession(); let result = emptyStream();
        for (const i of order) result = session.observe(result, pages[i], true);
        return result;
    });
    assert.deepEqual(outcomes[0], outcomes[1]); assert.deepEqual(outcomes[0], outcomes[2]);
    assert.equal(outcomes[0].historyComplete, true);
});
test('trusted time overlap merges different IDs, while disjoint pages need a cursor-connected bridge', () => {
    const baseline = new CoverageSession().observe(emptyStream(), page([100, 70], null, 'old-tail'), true);
    const session = new CoverageSession();
    const head = page([120, 110], null, 'next');
    const disconnected = session.observe(baseline, head, true);
    assert.deepEqual(disconnected.range, baseline.range);
    assert.equal(session.connects(baseline, head), false);
    // An independent interval cannot fill the unobserved gap after the head.
    session.observe(disconnected, page([95, 85], 'unrelated', 'unread'), true);
    assert.equal(session.connects(baseline, head), false);
    const connected = session.observe(disconnected, page([105, 85], 'next', 'unread-old-history'), true);
    assert.equal(connected.range?.head.time, 120); assert.equal(connected.historyComplete, false);
    assert.equal(connected.range?.tail.time, 70);
    assert.equal(session.connects(baseline, head), true);
    const differentIds = page([120, 85], null, 'unread'); differentIds.keys.forEach(key => key.id = 'different-' + key.time);
    const overlapping = new CoverageSession();
    assert.deepEqual(overlapping.observe(baseline, differentIds, true).range,
        { head: { id: 'different-120', time: 120 }, tail: { id: 'id70', time: 70 } });
    assert.equal(overlapping.connects(baseline, differentIds), true);
});
test('unknown context, missing keys, ties, cursor loops, truncated pages and broken cross-page ordering cannot authorize early stop', () => {
    const baseline = new CoverageSession().observe(emptyStream(), page([100, 90], null, 'old'), true);
    for (const mutation of ['context', 'keys', 'tie', 'loop', 'truncated'] as const) {
        const candidate = page([120, 100], null, 'next');
        if (mutation === 'context') candidate.requestKnown = false;
        if (mutation === 'keys') candidate.ordered = false;
        if (mutation === 'tie') { candidate.keys[0].time = 100; candidate.ordered = false; }
        if (mutation === 'loop') candidate.requestCursor = 'next';
        if (mutation === 'truncated') candidate.valid = false;
        const session = new CoverageSession(); session.observe(baseline, candidate, true);
        assert.equal(session.connects(baseline, candidate), false, mutation);
    }
    const session = new CoverageSession();
    session.observe(baseline, page([120, 110], null, 'next'), true);
    const result = session.observe(baseline, page([115, 90], 'next', 'tail'), true);
    assert.equal(result.range?.head.time, 100); assert.equal(session.connects(baseline, page([120, 110], null, 'next')), false);
});
test('natural complete chains rebuild disjoint stale coverage, including an empty current account', () => {
    const baseline = { initialized: true, historyComplete: true,
        range: { head: { id: 'old-head', time: 100 }, tail: { id: 'old-tail', time: 70 } } };
    const session = new CoverageSession();
    const head = page([150, 140], null, 'end');
    assert.deepEqual(session.observe(baseline, head, true), baseline);
    const rebuilt = session.observe(baseline, page([130, 120], 'end'), true);
    assert.deepEqual(rebuilt, { initialized: true, historyComplete: true,
        range: { head: { id: 'id150', time: 150 }, tail: { id: 'id120', time: 120 } } });
    assert.equal(session.connects(baseline, head), false);
    assert.deepEqual(new CoverageSession().observe(baseline, page([]), true),
        { initialized: true, historyComplete: true, range: null });
    assert.deepEqual(new CoverageSession().observe(baseline, { ...page([150, 140]), ordered: false }, true), baseline);
});
test('conflicting cursors and loops remain isolated when a new head replaces the old snapshot', () => {
    const baseline = new CoverageSession().observe(emptyStream(), page([100, 70], null, 'old'), true);
    const session = new CoverageSession();
    const head = page([120, 110], null, 'middle');
    session.observe(baseline, head, true);
    session.observe(baseline, page([105, 95], 'middle', 'tail'), true);
    session.observe(baseline, page([104, 94], 'middle', 'tail'), true);
    assert.equal(session.connects(baseline, head), false);
    assert.deepEqual(session.observe(baseline, page([85, 75], 'tail', 'middle'), true), baseline);
    assert.equal(session.connects(baseline, head), false);
    const ambiguousHead = page([125, 115], null, 'middle');
    session.observe(baseline, ambiguousHead, true);
    assert.equal(session.connects(baseline, ambiguousHead), false);
    const newHead = page([125, 115], null, 'fresh');
    session.observe(baseline, newHead, true);
    session.observe(baseline, page([105, 85], 'fresh', 'unread'), true);
    assert.equal(session.connects(baseline, head), false);
    assert.equal(session.connects(baseline, newHead), true);
});
test('a changed head retains prior token observations but cannot use an unrelated page to bridge a gap', () => {
    const session = new CoverageSession();
    const baseline = session.observe(emptyStream(), page([100, 70], null, 'old-tail'), true);
    session.observe(baseline, page([105, 95], 'middle', 'unread'), true);
    const head = page([120, 110], null, 'middle');
    const merged = session.observe(baseline, head, true);
    assert.equal(merged.range!.head.time, 120);
    assert.equal(merged.range!.tail.time, 70);
    assert.equal(session.connects(baseline, head), true);
    session.observe(merged, page([105, 95], 'middle', 'middle'), true);
    assert.equal(session.connects(baseline, head), false, 'a cursor loop cannot reuse older evidence for the same token');
});
test('a valid overlapping head is not vetoed by a stale suffix that repeats a promoted conversation', () => {
    const session = new CoverageSession();
    const baseline = session.observe(emptyStream(), page([100, 70], null, 'middle'), true);
    session.observe(baseline, page([60, 50], 'middle', 'unread'), true);
    const head = page([120, 90], null, 'middle');
    head.keys[0].id = 'id50'; // An older conversation has moved into the current head.
    const merged = session.observe(baseline, head, true);
    assert.equal(merged.range!.head.time, 120);
    assert.equal(session.connects(baseline, head), true);
    assert.equal(merged.historyComplete, false);
});
test('unordered independent streams and empty accounts certify only natural contiguous exhaustion', () => {
    const session = new CoverageSession();
    const partial = session.observe(emptyStream(), { ...page([90, 100], null, 'next'), ordered: false }, false);
    assert.equal(partial.initialized, false);
    const complete = session.observe(partial, { ...page([110], 'next'), ordered: false }, false);
    assert.equal(complete.initialized, true); assert.equal(complete.historyComplete, true); assert.equal(complete.range, null);
    assert.equal(new CoverageSession().observe(emptyStream(), page([]), true).historyComplete, true);
    assert.equal(new CoverageSession().observe(emptyStream(), { ...page([]), valid: false }, true).initialized, false);
});
