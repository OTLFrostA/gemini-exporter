// Integration ownership: L1 source-version evidence, L2 Domain trust, Application
// freshness decisions, and L4 JSON. The removed v1 export-completion helper is not a v2 dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';
import type { SourceConversationParseResult } from '../src/l1/parsers/parsingResult.js';
import { restoreDomainSnapshot } from '../src/l2/runtimeValidation.js';
import { savedConversationVersion } from '../src/l2/conversationVersion.js';
import { shouldSkipExport } from '../src/application/export/runExport.js';
import type { ExportRecord, ExportRequest } from '../src/application/export/types.js';
import { serializeDomainJson, JSON_ARCHIVE_VERSION } from '../src/l4/format/json/serializeDomainJson.js';

const account = fixtureAccount('gemini');
const key = fixtureKey('version_chat');
const request: ExportRequest = {
    keys: [key], format: 'markdown', delivery: 'browserDownload', includeAssets: true, skipUnchanged: true,
};
const wire = (rows: Array<[string, unknown]>) =>
    JSON.stringify(rows.map(([rpc, payload]) => ['wrb.fr', rpc, JSON.stringify(payload)]));
function detail(messageTime: number[], version?: number[], more = false) {
    const turn = [['c_version_chat', 'r_request'], null, [['Question']], [[['rc_answer', [['Answer']]]]], messageTime];
    const calls: Array<[string, unknown]> = [['hNvQHb', [[turn], more ? 'tCnext' : null, null, []]]];
    if (version) calls.push(['MaZiqc', [null, null, [['c_version_chat', 'Source title', null, null, null, version]]]]);
    return parseGeminiRpcConversation(wire(calls), { account, providerId: 'gemini', targetConvId: key.conversationId });
}
function toDomain(source: SourceConversationParseResult) {
    return restoreDomainSnapshot({
        index: { key, title: 'Source title', titleSource: 'provider', ...(source.sourceVersion !== undefined ? { updatedAt: source.sourceVersion } : {}) },
        detail: { key, ...(source.sourceVersion !== undefined ? { savedAt: source.sourceVersion } : {}),
            quality: source.conversation.detail.quality,
            messages: source.conversation.detail.messages, assets: source.conversation.detail.assets },
    });
}

test('v2 export freshness compares L1 source version to L2 Index rather than the local export clock', () => {
    const parsed = detail([1700000000, 0], [1700000000, 0]);
    const conversation = toDomain(parsed);
    const sourceVersion = savedConversationVersion(conversation, parsed.sourceVersion);
    assert.equal(sourceVersion, parsed.sourceVersion);
    const record: ExportRecord = { exportedAt: 1900000000000, chatTime: sourceVersion, format: 'markdown', status: 'ok' };
    assert.equal(shouldSkipExport(record, conversation.index.updatedAt, request), true);
    assert.equal(shouldSkipExport(record, conversation.index.updatedAt! + 1, request), false);
    assert.equal(shouldSkipExport({ ...record, chatTime: undefined }, conversation.index.updatedAt, request), false);
    assert.equal(shouldSkipExport({ ...record, status: 'partial' }, conversation.index.updatedAt, request), false);
    assert.equal(savedConversationVersion(toDomain(detail([1700000000, 0]))), undefined);
});

test('v2 JSON carries L2 savedAt as a Detail fact, not an obsolete top-level sourceVersion', () => {
    const parsed = detail([1700000000, 0], [1700000000, 0]);
    const conversation = toDomain(parsed);
    const archive = JSON.parse(serializeDomainJson(conversation, account, {}));
    assert.equal(archive.version, JSON_ARCHIVE_VERSION);
    assert.equal(archive.conversation.detail.savedAt, parsed.sourceVersion);
    assert.equal('updatedAt' in archive.conversation, false);
    assert.equal('sourceVersion' in archive, false);
    const partial = toDomain(detail([1700000000, 0], [1700000000, 0], true));
    const partialArchive = JSON.parse(serializeDomainJson(partial, account, {}));
    assert.equal(partialArchive.conversation.detail.savedAt, partial.detail.savedAt);
    assert.equal(partialArchive.conversation.detail.quality.status, partial.detail.quality.status);
});

test('L1 diagnostic differences cannot silently change L2 quality or Application export eligibility', () => {
    const healthy = detail([1700000000, 0], [1700000005, 0]);
    const mismatched = detail([1700000010, 0], [1700000005, 0]);
    const warnings = [
        { severity: 'error' as const, code: 'GEMINI_TURNS_REJECTED', message: 'diagnostic only' },
        { severity: 'error' as const, code: 'CONVERSATION_VERSION_MISMATCH', message: 'diagnostic only' },
    ];
    for (const source of [healthy, mismatched]) {
        const summaries = [[], warnings].map(diagnostics => {
            const merged = mergeConversationPages([{ ...source, diagnostics }]);
            const conversation = toDomain(merged);
            const record: ExportRecord = {
                exportedAt: 1900000000000, format: 'markdown', chatTime: conversation.detail.savedAt,
                status: conversation.detail.quality.status === 'complete' ? 'ok' : 'partial',
            };
            return {
                quality: conversation.detail.quality.status,
                status: record.status,
                eligibleToSkip: shouldSkipExport(record, conversation.index.updatedAt, request),
            };
        });
        assert.deepEqual(summaries[0], summaries[1]);
    }
});

test('skip permits only same-version, same-format partials whose sole failures are attachment 404s', () => {
    const base: ExportRecord = { exportedAt: 200, chatTime: 100, format: 'markdown', status: 'partial',
        attachmentIssues: [{ resourceId: 'image', name: 'image', code: 'RESOURCE_SOURCE_EXPIRED', httpStatus: 404 }] };
    const enabled = { ...request, format: 'markdown' as const, skipUnchanged: true };
    assert.equal(shouldSkipExport(base, 100, enabled), true);
    assert.equal(shouldSkipExport({ ...base, otherContentMissing: false }, 100, enabled), true);
    for (const record of [{ ...base, otherContentMissing: true }, { ...base, attachmentIssues: [] },
        { ...base, attachmentIssues: [...base.attachmentIssues!, { resourceId: 'other', name: 'other', code: 'RESOURCE_SOURCE_EXPIRED', httpStatus: 403 }] },
        { ...base, attachmentIssues: [{ resourceId: 'other', name: 'other', code: 'RESOURCE_PROCESSING_FAILED', httpStatus: 404 }] }]) {
        assert.equal(shouldSkipExport(record, 100, enabled), false);
    }
    assert.equal(shouldSkipExport(base, 101, enabled), false);
    assert.equal(shouldSkipExport(base, undefined, enabled), false);
    assert.equal(shouldSkipExport(base, 100, { ...enabled, skipUnchanged: false }), false);
    assert.equal(shouldSkipExport(base, 100, { ...enabled, format: 'pdf' }), false);
});
