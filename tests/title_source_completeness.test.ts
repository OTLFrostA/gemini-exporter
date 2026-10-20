import test from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_AUTHORITY_RANK, titleAuthorityRank, resolveTitle as resolveAuthorityTitle } from '../src/l2/titleAuthority.js';
import { TITLE_SOURCE_PRIORITY, TITLE_TIER_RANK, resolveTitle } from '../src/shared/utils/titleUtils.js';

test('canonical title authority gives every declared source a numeric rank', () => {
    for (const [source, rank] of Object.entries(TITLE_AUTHORITY_RANK)) {
        assert.equal(typeof rank, 'number', source);
        assert.equal(titleAuthorityRank(source), rank);
    }
    assert.equal(titleAuthorityRank('unknown'), 0);
});

test('compatibility title priority is a unique, ranked subset of canonical authority', () => {
    assert.equal(new Set(TITLE_SOURCE_PRIORITY).size, TITLE_SOURCE_PRIORITY.length);
    for (const source of TITLE_SOURCE_PRIORITY) {
        assert.equal(TITLE_TIER_RANK[source], TITLE_AUTHORITY_RANK[source]);
    }
    const ranks = TITLE_SOURCE_PRIORITY.map(source => TITLE_AUTHORITY_RANK[source]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
});

test('detail title outranks passive sniff in canonical merge and compatibility resolution', () => {
    assert.ok(TITLE_AUTHORITY_RANK.provider > TITLE_AUTHORITY_RANK.derived);
    assert.deepEqual(resolveAuthorityTitle([
        { source: "derived", value: 'Passive title' },
        { source: "provider", value: 'Detailed title' },
    ])?.value, 'Detailed title');
    assert.deepEqual(resolveTitle({
        id: 'c1',
        title: 'Detailed title', titleSource: 'provider',
    }), { title: 'Detailed title', source: 'provider' });
});
