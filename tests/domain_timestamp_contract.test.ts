import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTimestamp, normalizeConversationTimes } from '../src/core/domain/time.js';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import { mergeConversationPages } from '../src/core/parsers/gemini/rpc/mergePages.js';
import { exportDomainMarkdown } from '../src/core/export/exportDomainDocument.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
const base = (): DomainConversationDetail => ({ providerId: 'custom', id: 'chat', title: 'Times', completeness: 'unknown', assets: [], messages: [] });
test('conversation times are independent finite epoch milliseconds and unknown facts are absent', () => {
    assert.deepEqual(normalizeConversationTimes({ updatedAt: 0 }), { updatedAt: 0 });
    assert.deepEqual(normalizeConversationTimes({ createdAt: null, updatedAt: '1700000000123' }), { updatedAt: 1700000000123 });
    assert.equal(normalizeTimestamp('2026-10-06T00:00:00Z'), Date.parse('2026-10-06T00:00:00Z'));
    for (const invalid of [null, NaN, Infinity, '', 'bad-date', true, {}]) {
        assert.equal(normalizeTimestamp(invalid), undefined);
        if (invalid !== undefined) assert.throws(() => validateParserDomain({ ...base(), createdAt: invalid as never }));
    }
    assert.deepEqual(restoreDomainSnapshot(base()), base());
});
test('new writes reject aliases; only explicit v1 disk recovery converts old representations', () => {
    for (const key of ['timestamp', 'chatTime', 'lastSeen', 'href', 'titles', 'provenance']) {
        assert.throws(() => restoreDomainSnapshot({ ...base(), [key]: key === 'timestamp' ? null : 'old' }));
    }
    const old = { ...base(), completeness: { status: 'partial', reason: 'Selected' }, timestamp: 123, createdAt: '2026-10-06T00:00:00Z', updatedAt: null, href: 'https://example.test/chat' };
    const restored = restoreDomainSnapshot(old, 1);
    assert.equal(restored.createdAt, Date.parse('2026-10-06T00:00:00Z'));
    assert.equal(restored.updatedAt, undefined);
    assert.equal(restored.url, old.href);
    assert.equal(restored.completeness, 'partial');
    assert.equal(Object.hasOwn(restored, 'timestamp'), false);
    assert.equal(old.updatedAt, null);
    assert.throws(() => restoreDomainSnapshot({ ...old, unexpected: true }, 1));
});
test('message dates do not fabricate conversation creation or update facts during pagination', () => {
    const conversation = validateParserDomain({ ...base(), messages: [{ role: 'user', timestamp: 1700000000000, content: [] }] });
    const merged = mergeConversationPages([{ conversation, resourceHints: {}, acquisitionHints: {}, diagnostics: [] }]);
    assert.equal(merged.conversation.createdAt, undefined);
    assert.equal(merged.conversation.updatedAt, undefined);
    assert.equal(merged.conversation.messages[0].timestamp, 1700000000000);
});
test('Markdown preserves independently known creation/update facts and omits unknown times', async () => {
    const dated = validateParserDomain({ ...base(), createdAt: 0, updatedAt: 1000 });
    const markdown = await exportDomainMarkdown(dated);
    assert.ok(markdown.includes('1970-01-01T00:00:00.000Z'));
    assert.ok(markdown.includes('1970-01-01T00:00:01.000Z'));
    const undated = await exportDomainMarkdown(validateParserDomain(base()));
    assert.equal(undated.includes('date:'), false);
    assert.equal(undated.includes('updated:'), false);
});
