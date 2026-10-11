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
test('new high water advances only by exact shared ID/key overlap, never by numerical overlap or arrival order', () => {
    const baseline = new CoverageSession().observe(emptyStream(), page([100, 90], null, 'old-tail'), true);
    const session = new CoverageSession();
    const disconnected = session.observe(baseline, page([120, 110], null, 'next'), true);
    assert.deepEqual(disconnected.range, baseline.range);
    const connected = session.observe(disconnected, page([100, 90], 'next', 'unread-old-history'), true);
    assert.equal(connected.range?.head.time, 120); assert.equal(connected.historyComplete, false);
    assert.equal(session.connects(baseline, null, 'next'), true);
    const wrongIds = page([120, 100]); wrongIds.keys[1].id = 'different';
    assert.deepEqual(new CoverageSession().observe(baseline, wrongIds, true).range, baseline.range);
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
        assert.equal(session.connects(baseline, null, candidate.requestCursor), false, mutation);
    }
    const session = new CoverageSession();
    session.observe(baseline, page([120, 95], null, 'next'), true);
    const result = session.observe(baseline, page([100, 90], 'next', 'tail'), true);
    assert.equal(result.range?.head.time, 100); assert.equal(session.connects(baseline, null, 'next'), false);
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
