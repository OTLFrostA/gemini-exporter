import test from 'node:test';
import assert from 'node:assert/strict';
import { CoverageSession, emptyStream } from '../src/core/domain/streamCoverage.js';
import type { PageObservation } from '../src/core/domain/pageObservation.js';
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
test('unknown context, missing keys, rising times, cursor loops, truncated pages and broken cross-page ordering cannot authorize early stop', () => {
    const baseline = new CoverageSession().observe(emptyStream(), page([100, 90], null, 'old'), true);
    for (const mutation of ['context', 'keys', 'rising', 'loop', 'truncated'] as const) {
        const candidate = page([120, 100], null, 'next');
        if (mutation === 'context') candidate.requestKnown = false;
        if (mutation === 'keys') candidate.ordered = false;
        if (mutation === 'rising') { candidate.keys[0].time = 90; candidate.ordered = false; }
        if (mutation === 'loop') candidate.requestCursor = 'next';
        if (mutation === 'truncated') candidate.valid = false;
        const session = new CoverageSession(); session.observe(baseline, candidate, true);
        assert.equal(session.connects(baseline, candidate), false, mutation);
    }
    const session = new CoverageSession();
    session.observe(baseline, page([120, 110], null, 'next'), true);
    const result = session.observe(baseline, page([115, 90], 'next', 'tail'), true);
    assert.equal(result.range, null); assert.equal(result.orderingInvalidated, true);
    assert.equal(session.connects(baseline, page([120, 110], null, 'next')), false);
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
    assert.deepEqual(new CoverageSession().observe(baseline, { ...page([150, 140]), ordered: false }, true),
        { initialized: true, historyComplete: true, range: null, orderingInvalidated: true });
});

test('unordered recent pages certify exhaustion but cannot establish or later revive time overlap', () => {
    const head = { ...page([100, 60, 90], null, 'next'), ordered: false };
    const tail = page([50, 40], 'next');
    for (const pages of [[head, tail], [tail, head]]) {
        const session = new CoverageSession();
        const partial = session.observe(emptyStream(), pages[0], true);
        const complete = session.observe(partial, pages[1], true);
        assert.deepEqual(complete, { initialized: true, historyComplete: true, range: null, orderingInvalidated: true });
        const restarted = new CoverageSession();
        const orderedHead = page([120, 100], null, 'fresh');
        const refreshed = restarted.observe(complete, orderedHead, true);
        assert.equal(refreshed.range, null);
        assert.equal(restarted.connects(complete, orderedHead), false);
        assert.equal(restarted.observe(refreshed, page([90, 80], 'fresh'), true).orderingInvalidated, true);
    }
});

test('individually ordered pages with rising boundary times still certify only exhaustive traversal', () => {
    const session = new CoverageSession();
    const partial = session.observe(emptyStream(), page([100, 60], null, 'next'), true);
    const complete = session.observe(partial, page([90, 50], 'next'), true);
    assert.deepEqual(complete, { initialized: true, historyComplete: true, range: null, orderingInvalidated: true });
});

test('a late unordered passive head invalidates time trust without replacing the active cursor anchor', () => {
    const session = new CoverageSession();
    const active = page([100, 90], null, 'active-next');
    const prior = session.observe(emptyStream(), active, true);
    const ignoredHead = { ...page([110, 70, 80], null, 'passive-next'), ordered: false };
    const invalidated = session.observe(prior, ignoredHead, true, false);
    assert.equal(invalidated.orderingInvalidated, true);
    const complete = session.observe(invalidated, page([80, 60], 'active-next'), true);
    assert.equal(complete.historyComplete, true);
    assert.equal(complete.range, null);
    assert.equal(session.exhausted(), true);
});

test('unordered pages never excuse missing cursors, invalid terminal pages, repeated IDs or token loops', () => {
    for (const kind of ['missing', 'invalid', 'duplicate', 'loop'] as const) {
        const session = new CoverageSession();
        const head = { ...page([100, 60, 90], null, 'next'), ordered: false };
        const partial = session.observe(emptyStream(), head, true);
        const tail = page([50, 40], kind === 'missing' ? 'unrelated' : 'next');
        if (kind === 'invalid') tail.valid = false;
        if (kind === 'duplicate') tail.keys[0].id = head.keys[0].id;
        if (kind === 'loop') tail.nextCursor = 'next';
        assert.equal(session.observe(partial, tail, true).historyComplete, false, kind);
    }
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

test('equal times within and across cursor-connected pages rebuild a complete range', () => {
    const first = page([100, 90], null, 'next');
    const last = page([90, 80, 80], 'next');
    last.keys.forEach((key, index) => key.id = 'last-' + index);
    const stale = { initialized: true, historyComplete: true,
        range: { head: { id: 'stale-head', time: 200 }, tail: { id: 'stale-tail', time: 150 } } };
    for (const order of [[first, last], [last, first]]) {
        const session = new CoverageSession();
        const partial = session.observe(stale, order[0], true);
        const complete = session.observe(partial, order[1], true);
        assert.deepEqual(complete, { initialized: true, historyComplete: true,
            range: { head: first.keys[0], tail: last.keys[2] } });
    }
});
test('equal times allow verified overlap but still require cursors and distinct conversation IDs', () => {
    const baseline = { initialized: true, historyComplete: false,
        range: { head: { id: 'old-head', time: 90 }, tail: { id: 'old-tail', time: 70 } } };
    const first = page([120, 110], null, 'next');
    const bridge = page([110, 90, 90], 'next', 'unread');
    bridge.keys.forEach((key, index) => key.id = 'bridge-' + index);
    const session = new CoverageSession();
    session.observe(baseline, first, true);
    session.observe(baseline, { ...bridge, requestCursor: 'unrelated' }, true);
    assert.equal(session.connects(baseline, first), false);
    const merged = session.observe(baseline, bridge, true);
    assert.equal(session.connects(baseline, first), true);
    assert.equal(merged.range!.head.time, 120);
    assert.equal(merged.range!.tail.time, 70);
    assert.equal(merged.historyComplete, false);
    for (const invalid of [
        { ...bridge, keys: [{ id: first.keys[1].id, time: 110 }, { id: 'other', time: 90 }] },
        { ...bridge, keys: [{ id: 'too-new', time: 111 }, { id: 'other', time: 90 }] },
    ]) {
        const rejected = new CoverageSession();
        rejected.observe(baseline, first, true);
        rejected.observe(baseline, invalid, true);
        assert.equal(rejected.connects(baseline, first), false);
    }
});

test('a passive head with another cursor cannot replace the active full-scan anchor', () => {
    const active = page([100, 90], null, 'active-next');
    const passive = page([105, 100], null, 'passive-next');
    passive.keys.forEach((key, index) => key.id = 'passive-' + index);
    const tail = page([90, 80], 'active-next');
    tail.keys.forEach((key, index) => key.id = 'tail-' + index);
    const session = new CoverageSession();
    const first = session.observe(emptyStream(), active, true);
    assert.deepEqual(session.observe(first, passive, true, false), first);
    const complete = session.observe(first, tail, true, false);
    assert.equal(complete.historyComplete, true);
    assert.deepEqual(complete.range, { head: active.keys[0], tail: tail.keys[1] });
    const refreshed = session.observe(complete, passive, true);
    assert.equal(refreshed.range!.head.time, 105);
    assert.equal(refreshed.historyComplete, true);
});
