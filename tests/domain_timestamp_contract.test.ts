import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTimestamp, normalizeConversationTimes } from '../src/core/domain/time.js';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import { mergeConversationPages } from '../src/core/parsers/gemini/rpc/mergePages.js';
import { parseConversationRecord } from '../src/core/compatibility/record/parseConversationRecord.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { exportDomainMarkdown, exportDomainHtml } from '../src/core/export/exportDomainDocument.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import type { ResourceConversationParseResult } from '../src/core/parsers/parsingResult.js';

function baseDomain(extra: Partial<DomainConversationDetail> = {}): DomainConversationDetail {
    return {
        providerId: 'gemini',
        id: 'c_test_norm',
        title: 'Timestamp Normalization Test',
        timestamp: null,
        assets: [],
        messages: [{
            id: 'm1',
            role: 'user',
            content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello' }] }],
        }],
        ...extra,
    };
}

test('1. 时间存在: normalizeConversationTimes preserves valid numeric millisecond timestamps', () => {
    const tCreated = 1700000000000;
    const tUpdated = 1700000005000;
    const tStamp = 1700000005000;

    const normalized = normalizeConversationTimes({
        createdAt: tCreated,
        updatedAt: tUpdated,
        timestamp: tStamp,
    });

    assert.strictEqual(normalized.createdAt, tCreated);
    assert.strictEqual(normalized.updatedAt, tUpdated);
    assert.strictEqual(normalized.timestamp, tStamp);

    const domain = validateParserDomain(baseDomain(normalized));
    assert.strictEqual(domain.createdAt, tCreated);
    assert.strictEqual(domain.updatedAt, tUpdated);
    assert.strictEqual(domain.timestamp, tStamp);
});

test('2. 时间缺失: normalizeConversationTimes omits optional fields and defaults timestamp to null', () => {
    const normalized = normalizeConversationTimes({});

    assert.strictEqual(normalized.timestamp, null);
    assert.strictEqual(Object.hasOwn(normalized, 'createdAt'), false);
    assert.strictEqual(Object.hasOwn(normalized, 'updatedAt'), false);
    assert.strictEqual(normalized.createdAt, undefined);
    assert.strictEqual(normalized.updatedAt, undefined);

    const domain = validateParserDomain(baseDomain(normalized));
    assert.strictEqual(domain.timestamp, null);
    assert.strictEqual(domain.createdAt, undefined);
    assert.strictEqual(domain.updatedAt, undefined);
    assert.strictEqual(Object.hasOwn(domain, 'createdAt'), false);
    assert.strictEqual(Object.hasOwn(domain, 'updatedAt'), false);
});

test('3. null 输入: normalizeConversationTimes strips null for optional fields without fabricating', () => {
    const normalized = normalizeConversationTimes({
        createdAt: null,
        updatedAt: null,
        timestamp: null,
    });

    assert.strictEqual(normalized.timestamp, null);
    assert.strictEqual(Object.hasOwn(normalized, 'createdAt'), false);
    assert.strictEqual(Object.hasOwn(normalized, 'updatedAt'), false);

    // validateParserDomain strictly rejects null for createdAt and updatedAt
    assert.throws(
        () => validateParserDomain(baseDomain({ createdAt: null as never })),
        /Invalid persisted Domain contract: createdAt/
    );
    assert.throws(
        () => validateParserDomain(baseDomain({ updatedAt: null as never })),
        /Invalid persisted Domain contract: updatedAt/
    );
});

test('4. 字符串时间输入: boundary normalizes ISO strings and numeric strings to Unix ms', () => {
    const isoCreated = '2026-10-06T12:00:00Z';
    const isoUpdated = '2026-10-06T13:30:00Z';
    const msCreated = Date.parse(isoCreated);
    const msUpdated = Date.parse(isoUpdated);

    // ISO strings
    const fromIso = normalizeConversationTimes({
        createdAt: isoCreated,
        updatedAt: isoUpdated,
    });
    assert.strictEqual(fromIso.createdAt, msCreated);
    assert.strictEqual(fromIso.updatedAt, msUpdated);
    assert.strictEqual(fromIso.timestamp, null);

    // Numeric strings
    const fromNumStr = normalizeConversationTimes({
        createdAt: '1700000000000',
        updatedAt: '1700000010000',
    });
    assert.strictEqual(fromNumStr.createdAt, 1700000000000);
    assert.strictEqual(fromNumStr.updatedAt, 1700000010000);

    // Compatibility parseConversationRecord boundary
    const parsed = parseConversationRecord({
        id: 'c_compat',
        title: 'Compat',
        createdAt: isoCreated,
        updatedAt: isoUpdated,
        messages: [{ role: 'user', content: 'Hi' }],
    }, { providerId: 'gemini' });
    assert.strictEqual(parsed.conversation.createdAt, msCreated);
    assert.strictEqual(parsed.conversation.updatedAt, msUpdated);
});

test('5. 无效时间: invalid timestamps are safely omitted from optional fields and timestamp is null', () => {
    const invalids = ['not-a-date', '', '   ', NaN, Infinity, -Infinity, true, false, {}, []];

    for (const invalid of invalids) {
        assert.strictEqual(normalizeTimestamp(invalid), undefined);

        const normalized = normalizeConversationTimes({
            createdAt: invalid,
            updatedAt: invalid,
            timestamp: invalid,
        });
        assert.strictEqual(normalized.timestamp, null);
        assert.strictEqual(Object.hasOwn(normalized, 'createdAt'), false);
        assert.strictEqual(Object.hasOwn(normalized, 'updatedAt'), false);
    }

    // Direct domain validation rejects string or non-number timestamps
    assert.throws(
        () => validateParserDomain(baseDomain({ createdAt: 'invalid' as never })),
        /Invalid persisted Domain contract: createdAt/
    );
});

test('6. 旧快照读取: restoreDomainSnapshot handles historical null and ISO string without data loss', () => {
    const legacySnapshot = {
        providerId: 'gemini',
        id: 'c_legacy_snap',
        title: 'Legacy Snapshot',
        timestamp: null,
        createdAt: '2026-10-06T00:00:00Z',
        updatedAt: null,
        assets: [],
        messages: [{
            id: 'm1',
            role: 'user',
            content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Restored message' }] }],
        }],
    };

    const restored = restoreDomainSnapshot(legacySnapshot);
    assert.strictEqual(restored.createdAt, Date.parse('2026-10-06T00:00:00Z'));
    assert.strictEqual(restored.updatedAt, undefined);
    assert.strictEqual(Object.hasOwn(restored, 'updatedAt'), false);
    assert.strictEqual(restored.timestamp, null);
    assert.strictEqual(restored.messages[0].id, 'm1');

    // Snapshot corrupted in non-timestamp fields still throws TypeError
    const corrupted = { ...legacySnapshot, providerId: 12345 };
    assert.throws(() => restoreDomainSnapshot(corrupted), /Invalid persisted Domain contract/);
});

test('7. Merge 行为不变: mergeConversationPages retains earliest createdAt and latest updatedAt', () => {
    const makePage = (id: string, time: number): ResourceConversationParseResult => ({
        conversation: validateParserDomain(baseDomain({
            id: 'c_merge',
            timestamp: time,
            createdAt: time,
            updatedAt: time,
            messages: [{
                id,
                role: 'user',
                timestamp: time,
                content: [{ type: 'paragraph', children: [{ type: 'text', text: `Page ${id}` }] }],
            }],
        })),
        diagnostics: [],
        resourceHints: {},
        acquisitionHints: {},
    });

    const page1 = makePage('p1', 1700000000000);
    const page2 = makePage('p2', 1700000050000);
    const page3 = makePage('p3', 1700000020000);

    const merged = mergeConversationPages([page1, page2, page3]);
    assert.strictEqual(merged.conversation.createdAt, 1700000000000);
    assert.strictEqual(merged.conversation.updatedAt, 1700000050000);
    assert.strictEqual(merged.conversation.timestamp, 1700000050000);

    // Merge pages when timestamp is omitted on some pages
    const emptyPage: ResourceConversationParseResult = {
        conversation: validateParserDomain(baseDomain({
            id: 'c_merge_empty',
            timestamp: null,
            messages: [{ id: 'm_empty', role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'No dates' }] }] }],
        })),
        diagnostics: [],
        resourceHints: {},
        acquisitionHints: {},
    };
    const mergedEmpty = mergeConversationPages([emptyPage]);
    assert.strictEqual(mergedEmpty.conversation.timestamp, null);
    assert.strictEqual(mergedEmpty.conversation.createdAt, undefined);
    assert.strictEqual(mergedEmpty.conversation.updatedAt, undefined);
});

test('8. Export 行为不变: compose and export render correct dates from normalized timestamps', async () => {
    const tCreated = Date.parse('2026-10-06T10:00:00Z');
    const tUpdated = Date.parse('2026-10-07T15:30:00Z');

    const domainWithTimes = validateParserDomain(baseDomain({
        createdAt: tCreated,
        updatedAt: tUpdated,
        timestamp: tUpdated,
    }));

    // composeDomainDocument picks updatedAt as the display date
    const { document } = composeDomainDocument(domainWithTimes);
    assert.strictEqual(document.header.date, '2026-10-07');

    // exportDomainMarkdown includes date and updated frontmatter
    const md = await exportDomainMarkdown(domainWithTimes);
    assert.ok(md.includes('date: "2026-10-06T10:00:00.000Z"'));
    assert.ok(md.includes('updated: "2026-10-07T15:30:00.000Z"'));

    // exportDomainHtml renders cleanly
    const html = await exportDomainHtml(domainWithTimes);
    assert.ok(html.includes('Timestamp Normalization Test'));

    // Conversation with no timestamps: frontmatter omits date/updated
    const domainNoTimes = validateParserDomain(baseDomain({ timestamp: null }));
    const { document: docNoTimes } = composeDomainDocument(domainNoTimes);
    assert.strictEqual(docNoTimes.header.date, undefined);

    const mdNoTimes = await exportDomainMarkdown(domainNoTimes);
    assert.strictEqual(mdNoTimes.includes('date:'), false);
    assert.strictEqual(mdNoTimes.includes('updated:'), false);
});
