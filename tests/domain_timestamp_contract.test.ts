import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTimestamp, normalizeConversationTimes } from '../src/core/domain/time.js';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import { mergeConversationPages } from '../src/core/parsers/gemini/rpc/mergePages.js';
import { exportDomainMarkdown } from '../src/core/export/exportDomainDocument.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
const base = (): DomainConversationWithDetail => ({ index: { cloudAvailability: 'unknown', hasTakeoutImport: false, titleSource: 'legacy', providerId: 'custom', id: 'chat', title: 'Times' }, detail: { completeness: 'unknown', assets: [], messages: [] } });
test('conversation times are independent finite epoch milliseconds and unknown facts are absent', () => {
    assert.deepEqual(normalizeConversationTimes({ updatedAt: 0 }), { updatedAt: 0 });
    assert.deepEqual(normalizeConversationTimes({ createdAt: null, updatedAt: '1700000000123' }), { updatedAt: 1700000000123 });
    assert.equal(normalizeTimestamp('2026-10-06T00:00:00Z'), Date.parse('2026-10-06T00:00:00Z'));
    for (const invalid of [null, NaN, Infinity, '', 'bad-date', true, {}]) {
        assert.equal(normalizeTimestamp(invalid), undefined);
        if (invalid !== undefined) assert.throws(() => validateParserDomain({ index: { ...base().index, createdAt: invalid as never }, detail: { ...base().detail } }));
    }
    assert.deepEqual(restoreDomainSnapshot(base()), base());
});
test('current snapshots reject historical aliases and representations', () => {
    for (const key of ['updatedAt', 'timestamp', 'chatTime', 'lastSeen', 'href', 'titles', 'provenance']) {
        assert.throws(() => restoreDomainSnapshot({ index: { ...base().index }, detail: { ...base().detail }, [key]: key === 'timestamp' ? null : 'old' }));
    }
    const old = { index: { ...base().index, createdAt: '2026-10-06T00:00:00Z', updatedAt: null }, detail: { ...base().detail, completeness: { status: 'partial', reason: 'Selected' } }, timestamp: 123, href: 'https://example.test/chat' };
    assert.throws(() => restoreDomainSnapshot(old));
});
test('message dates do not fabricate conversation creation or update facts during pagination', () => {
    const conversation = validateParserDomain({ index: { ...base().index }, detail: { ...base().detail, messages: [{ role: 'user', timestamp: 1700000000000, content: [] }] } });
    const merged = mergeConversationPages([{ conversation, resourceHints: {}, acquisitionHints: {}, diagnostics: [] }]);
    assert.equal(merged.conversation.index.createdAt, undefined);
    assert.equal(merged.sourceVersion, undefined);
    assert.equal(merged.conversation.detail.messages[0].timestamp, 1700000000000);
});
test('Markdown preserves independently known creation/update facts and omits unknown times', async () => {
    const dated = validateParserDomain({ index: { ...base().index, createdAt: 0 }, detail: { ...base().detail } });
    const markdown = await exportDomainMarkdown({ ...dated, index: { ...dated.index, updatedAt: 1000 } });
    assert.ok(markdown.includes('1970-01-01T00:00:00.000Z'));
    assert.ok(markdown.includes('1970-01-01T00:00:01.000Z'));
    const undated = await exportDomainMarkdown(validateParserDomain(base()));
    assert.equal(undated.includes('date:'), false);
    assert.equal(undated.includes('updated:'), false);
});
