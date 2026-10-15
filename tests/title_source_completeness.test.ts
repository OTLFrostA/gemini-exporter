import test from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_AUTHORITY_RANK, titleAuthorityRank, resolveTitle as resolveAuthorityTitle } from '../src/core/domain/titleAuthority.js';
import { TITLE_SOURCE_PRIORITY, TITLE_TIER_RANK, resolveTitle } from '../src/core/utils/titleUtils.js';

test('canonical title authority gives every declared source a numeric rank', () => {
    for (const [source, rank] of Object.entries(TITLE_AUTHORITY_RANK)) {
        assert.equal(typeof rank, 'number', source);
        assert.equal(titleAuthorityRank(source), rank);
    }
    assert.equal(titleAuthorityRank('unknown'), TITLE_AUTHORITY_RANK.default);
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
    assert.ok(TITLE_AUTHORITY_RANK['api-detail'] > TITLE_AUTHORITY_RANK.sniff);
    assert.deepEqual(resolveAuthorityTitle([
        { source: 'sniff', value: 'Passive title' },
        { source: 'api-detail', value: 'Detailed title' },
    ])?.value, 'Detailed title');
    assert.deepEqual(resolveTitle({
        id: 'c1',
        title: '',
        titles: { 'api-detail': 'Detailed title', sniff: 'Passive title' },
    }), { title: 'Detailed title', source: 'api-detail' });
});
