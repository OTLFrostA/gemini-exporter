import { describe as __suiteDescribe } from 'node:test';
import { useIndexStorage } from "./helpers/indexStorage.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { readStoredConversation } from "./helpers/readStoredConversation.js";
import { type SourceConversationParseResult } from "../src/l1/parsers/parsingResult.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseGeminiRpcConversation } from "../src/l1/parsers/gemini/rpc/parseConversation.js";
import { parseList } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { mergeConversationPages } from "../src/l1/parsers/gemini/rpc/mergePages.js";
import { listGen as geminiListGen } from "./fixtures/providers/gemini.js";
import { detailGen as geminiDetailGen } from "./fixtures/providers/geminiDetail.js";
import test__s1 from "node:test";
import { fixtureKey } from "./helpers/domainFixture.js";
import { restoreDomainSnapshot } from "../src/l2/runtimeValidation.js";
import { shouldSkipExport } from "../src/application/export/runExport.js";
import { type ExportRecord } from "../src/application/export/types.js";
import { type ExportRequest } from "../src/application/export/types.js";
import { serializeDomainJson } from "../src/l4/format/json/serializeDomainJson.js";
import { JSON_ARCHIVE_VERSION } from "../src/l4/format/json/serializeDomainJson.js";
import { ingestIndexes } from "../src/l2/ingestion.js";
import { getIndex } from "../src/l3a/storageService.js";
import { getDetail } from "../src/l3a/storageService.js";
import { runExport } from "../src/application/export/runExport.js";
import { __setZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { v2ExportHost } from "./helpers/v2ExportHost.js";
import { exportKey } from "./helpers/v2ExportHost.js";
import { exportRequest } from "./helpers/v2ExportHost.js";
import { seedExportConversation } from "./helpers/v2ExportHost.js";
import { readDeliveredFiles } from "./helpers/v2ExportHost.js";

__suiteDescribe("conversation_version", () => {
useIndexStorage();













function detail(key: Parameters<typeof geminiDetailGen>[0], more = false, id = 'version_chat') {
    const result = parseGeminiRpcConversation(geminiDetailGen(key), {
        account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: id,
    });
    if (!more && result.conversation.detail.quality.status !== 'partial') result.conversation.detail.quality.status = 'complete';
    return result;
}
const versionDetailKeys = [
    'G_VERSION_PAIR_DETAIL_01', 'G_VERSION_PAIR_DETAIL_02', 'G_VERSION_PAIR_DETAIL_03',
    'G_VERSION_PAIR_DETAIL_04', 'G_VERSION_PAIR_DETAIL_05', 'G_VERSION_PAIR_DETAIL_06',
] as const;
const versionListKeys = [
    'G_VERSION_PAIR_LIST_01', 'G_VERSION_PAIR_LIST_02', 'G_VERSION_PAIR_LIST_03',
    'G_VERSION_PAIR_LIST_04', 'G_VERSION_PAIR_LIST_05', 'G_VERSION_PAIR_LIST_06',
] as const;

test('six anonymized live pairs preserve identical List/Detail versions and latest turn times', () => {
    const pairs: Array<{ listUpdatedAt: number; detailUpdatedAt: number; maxMessageAt: number; listWire: number[]; detailTurnWire: number[]; metadataWire: number[] }> =
        JSON.parse(readFileSync('tests/fixtures/gemini_timestamp_pairs.json', 'utf8'));
    for (const [i, pair] of pairs.entries()) {
        assert.equal(pair.listUpdatedAt, pair.maxMessageAt);
        assert.equal(pair.detailUpdatedAt, pair.listUpdatedAt);
        const parsed = detail(versionDetailKeys[i]!);
        const index = parseList(geminiListGen(versionListKeys[i]!)).conversations[0];
        assert.equal(parsed.sourceVersion, index.updatedAt);
        assert.equal(parsed.sourceVersion, pair.listUpdatedAt);
        assert.equal(parsed.conversation.index.updatedAt, pair.listUpdatedAt);
    }
});
test('matching metadata owns the update version, while message dates remain message facts', () => {
    const parsed = detail('G_VERSION_DETAIL_MATCHING_01');
    assert.equal(parsed.sourceVersion, 1700000005123);
    assert.equal(parsed.conversation.detail.messages[0].timestamp, 1700000000000);
    assert.equal(detail('G_VERSION_DETAIL_NO_META_01').sourceVersion, undefined);
    const unrelated = geminiDetailGen('G_VERSION_DETAIL_UNRELATED_01');
    assert.equal(parseGeminiRpcConversation(unrelated, { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'actual_chat' }).sourceVersion, undefined);
    const list = parseList(geminiListGen('G_VERSION_CREATION_SLOT_LIST_01')).conversations[0];
    assert.equal(list.updatedAt, undefined, 'creation/unknown wire slots cannot substitute for the update slot');
});
test('savedAt is the committed source version and retains the complete body version when a newer partial capture loses selection', async () => {
    const first = await commitSource(detail('G_VERSION_DETAIL_SAVED_AT_01'));
    assert.equal(first.conversation.detail.savedAt, 1700000000000);
    assert.equal('updatedAt' in first.conversation, false);
    assert.equal(first.sourceVersion, first.conversation.detail.savedAt);
    const repeated = await commitSource(detail('G_VERSION_DETAIL_SAVED_AT_02'));
    assert.equal(repeated.conversation.detail.savedAt, first.conversation.detail.savedAt);
    assert.deepEqual(repeated.conversation.detail, first.conversation.detail);
    const newer = await commitSource(detail('G_VERSION_DETAIL_NEWER_01'));
    assert.equal(newer.conversation.detail.savedAt, 1700000005000);
    const rejected = await commitSource(detail('G_VERSION_DETAIL_PARTIAL_NEWER_01', true));
    assert.equal(rejected.conversation.detail.savedAt, newer.conversation.detail.savedAt);
    assert.deepEqual(rejected.conversation.detail, newer.conversation.detail);
    assert.equal(rejected.conversation.index.updatedAt, 1700000010000);
    const older = await commitSource(detail('G_VERSION_DETAIL_OLDER_01'));
    assert.equal(older.conversation.detail.savedAt, newer.conversation.detail.savedAt);
});
test('Detail savedAt follows known source evidence even for partial or metadata-only captures', async () => {
    const partial = await commitSource(detail('G_VERSION_DETAIL_PARTIAL_ID_01', true, 'partial_chat'));
    assert.equal(partial.conversation.detail.savedAt, 1700000000000);
    const unknown = await commitSource(detail('G_VERSION_DETAIL_UNKNOWN_ID_01', false, 'unknown_chat'));
    assert.equal(unknown.conversation.detail.savedAt, undefined);
    const conflicting = await commitSource(detail('G_VERSION_DETAIL_CONFLICT_ID_01', false, 'conflicting_chat'));
    assert.equal(conflicting.conversation.detail.quality.status, 'complete');
    assert.equal(conflicting.conversation.detail.savedAt, 1700000000000);
    const metadata = parseGeminiRpcConversation(geminiDetailGen('G_VERSION_DETAIL_METADATA_ONLY_01'), {
        account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'metadata_chat',
    });
    assert.equal((await commitSource(metadata)).conversation.detail.savedAt, 1700000000000);
});
test('a version change during pagination invalidates the saved version until a consistent refetch', async () => {
    const first = detail('G_VERSION_DETAIL_PAGE_FIRST_01', true);
    const changed = detail('G_VERSION_DETAIL_PAGE_CHANGED_01');
    const mixed = mergeConversationPages([first, changed]);
    assert.equal(mixed.conversation.detail.quality.status, 'partial');
    assert.ok(mixed.diagnostics.some(d => d.code === 'CONVERSATION_VERSION_CHANGED'));
    assert.equal((await commitSource(mixed)).conversation.detail.savedAt, undefined);
    const consistent = mergeConversationPages([first, detail('G_VERSION_DETAIL_PAGE_CONSISTENT_01')]);
    assert.equal((await commitSource(consistent)).conversation.detail.savedAt, 1700000005000);
});
test('diagnostic deletion or spoofed diagnostic codes cannot change merged Detail quality', () => {
    const healthy = detail('G_VERSION_DETAIL_HEALTHY_01');
    const rejected = {   ...healthy, conversation: { ...healthy.conversation, detail: {   ...healthy.conversation.detail, quality: { status: 'partial' as const, rejectedTurns: 1 } } } };
    const mismatched = detail('G_VERSION_DETAIL_MISMATCHED_01');
    for (const [input, expected] of [[healthy, 'unknown'], [rejected, 'partial'], [mismatched, 'unknown']] as const) {
        const warnings = [{ severity: 'error' as const, code: 'GEMINI_TURNS_REJECTED', message: 'diagnostic only' },
            { severity: 'error' as const, code: 'CONVERSATION_VERSION_MISMATCH', message: 'diagnostic only' }];
        const records = [[], warnings].map(diagnostics => {
            const merged = mergeConversationPages([{   ...input, diagnostics }]);
            assert.equal(merged.conversation.detail.quality.status, expected);
            return merged.conversation.detail;
        });
        assert.deepEqual(records[0], records[1]);
        assert.equal(records[0].quality.status, expected);
    }
});

/** Admit native keyless facts through L2; no historical fixture/repository compatibility path. */
async function commitSource(source: SourceConversationParseResult) {
    const key = { accountId: '10000000-0000-4000-8000-000000000001', conversationId: source.conversationId };
    await ingestDetail(key.accountId, key.conversationId, source.conversation.detail, source.conversation.index);
    const conversation = await readStoredConversation(key);
    assert.ok(conversation);
    return { conversation, sourceVersion: conversation.detail.savedAt };
}
});

__suiteDescribe("conversation_version_other_layers", () => {
// Integration ownership: L1 source-version evidence, L2 Domain trust, Application
// freshness decisions, and L4 JSON. The removed v1 export-completion helper is not a v2 dependency.












const account = fixtureAccount('gemini');
const key = fixtureKey('version_chat');
const request: ExportRequest = {
    keys: [key], format: 'markdown', delivery: 'browserDownload', includeAssets: true, skipUnchanged: true,
};
function detail(keyName: Parameters<typeof geminiDetailGen>[0]) {
    return parseGeminiRpcConversation(geminiDetailGen(keyName), {
        account, providerId: 'gemini', targetConvId: key.conversationId,
    });
}
function toDomain(source: SourceConversationParseResult) {
    return restoreDomainSnapshot({
        index: { key, title: 'Source title', titleSource: 'provider', ...(source.sourceVersion !== undefined ? { updatedAt: source.sourceVersion } : {}) },
        detail: { key, ...(source.sourceVersion !== undefined ? { savedAt: source.sourceVersion } : {}),
            quality: source.conversation.detail.quality,
            messages: source.conversation.detail.messages, assets: source.conversation.detail.assets },
    });
}

test__s1('v2 export freshness compares L1 source version to L2 Index rather than the local export clock', () => {
    const parsed = detail('G_VERSION_LAYERS_FRESHNESS_01');
    const conversation = toDomain(parsed);
    const sourceVersion = conversation.detail.savedAt ?? parsed.sourceVersion;
    assert.equal(sourceVersion, parsed.sourceVersion);
    const record: ExportRecord = { exportedAt: 1900000000000, chatTime: sourceVersion, format: 'markdown', includeAssets: true, status: 'ok' };
    assert.equal(shouldSkipExport(record, conversation.index.updatedAt, request), true);
    assert.equal(shouldSkipExport(record, conversation.index.updatedAt! + 1, request), false);
    assert.equal(shouldSkipExport({ ...record, chatTime: undefined }, conversation.index.updatedAt, request), false);
    assert.equal(shouldSkipExport({ ...record, status: 'partial' }, conversation.index.updatedAt, request), false);
});

test__s1('v2 JSON carries L2 savedAt as a Detail fact, not an obsolete top-level sourceVersion', () => {
    const parsed = detail('G_VERSION_LAYERS_JSON_01');
    const conversation = toDomain(parsed);
    const archive = JSON.parse(serializeDomainJson(conversation, account, {}));
    assert.equal(archive.version, JSON_ARCHIVE_VERSION);
    assert.equal(archive.conversation.detail.savedAt, parsed.sourceVersion);
    assert.equal('updatedAt' in archive.conversation, false);
    assert.equal('sourceVersion' in archive, false);
    const partial = toDomain(detail('G_VERSION_LAYERS_JSON_PARTIAL_01'));
    const partialArchive = JSON.parse(serializeDomainJson(partial, account, {}));
    assert.equal(partialArchive.conversation.detail.savedAt, partial.detail.savedAt);
    assert.equal(partialArchive.conversation.detail.quality.status, partial.detail.quality.status);
});

test__s1('L1 diagnostic differences cannot silently change L2 quality or Application export eligibility', () => {
    const healthy = detail('G_VERSION_LAYERS_HEALTHY_01');
    const mismatched = detail('G_VERSION_LAYERS_MISMATCHED_01');
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

for (const code of ['RESOURCE_SOURCE_EXPIRED', 'RESOURCE_LOCATOR_UNAVAILABLE']) {
    test__s1(`skip permits same-version, same-format attachment 404 warnings: ${code}`, () => {
        const base: ExportRecord = { exportedAt: 200, chatTime: 100, format: 'markdown', includeAssets: true, status: 'partial',
            attachmentIssues: [{ resourceId: 'image', name: 'image', code, httpStatus: 404 }] };
        const enabled = { ...request, format: 'markdown' as const, skipUnchanged: true };
        assert.equal(shouldSkipExport(base, 100, enabled), true);
        assert.equal(shouldSkipExport({ ...base, otherContentMissing: false }, 100, enabled), true);
        for (const record of [{ ...base, otherContentMissing: true }, { ...base, attachmentIssues: [] },
            { ...base, attachmentIssues: [...base.attachmentIssues!, { resourceId: 'other', name: 'other', code: 'RESOURCE_SOURCE_EXPIRED', httpStatus: 403 }] },
            { ...base, attachmentIssues: [{ resourceId: 'auth', name: 'session', code: 'SOURCE_HTTP_ERROR', httpStatus: 404 }] },
            { ...base, attachmentIssues: [{ resourceId: 'gone', name: 'gone', code: 'RESOURCE_SOURCE_EXPIRED', httpStatus: 410 }] },
            { ...base, attachmentIssues: [{ resourceId: 'other', name: 'other', code: 'RESOURCE_PROCESSING_FAILED', httpStatus: 404 }] }]) {
            assert.equal(shouldSkipExport(record, 100, enabled), false);
        }
        assert.equal(shouldSkipExport(base, 101, enabled), false);
        assert.equal(shouldSkipExport(base, undefined, enabled), false);
        assert.equal(shouldSkipExport(base, 100, { ...enabled, skipUnchanged: false }), false);
        assert.equal(shouldSkipExport(base, 100, { ...enabled, format: 'pdf' }), false);
    });
}
});

__suiteDescribe("l2_timestamp_export_regression", () => {
for (const entry of ['index', 'detail'] as const) {
    test(`L2 ${entry} rejects out-of-Date-range updatedAt before persistence and application Markdown export succeeds`, async t => {
        const host = v2ExportHost(t);
        __setZipConstructor(require('../lib/jszip.min.js'));
        await seedExportConversation('timestamp');
        const key = exportKey('timestamp');
        const originalIndex = await getIndex(key);
        const originalDetail = await getDetail(key);
        const ingest = (updatedAt: number) => entry === 'index'
            ? ingestIndexes(key.accountId, [{ conversationId: key.conversationId, fields: { updatedAt } }])
            : ingestDetail(key.accountId, key.conversationId, {
                quality: { status: 'complete' }, assets: [], messages: [], savedAt: 200,
            }, { updatedAt });
        for (const invalid of [8640000000000001, -8640000000000001]) {
            await assert.rejects(ingest(invalid), TypeError);
            assert.deepEqual(await getIndex(key), originalIndex);
            assert.deepEqual(await getDetail(key), originalDetail);
        }
        await seedExportConversation('timestamp', 200);
        assert.equal((await getIndex(key))?.updatedAt, 200);
        await seedExportConversation('boundary', 8640000000000000);
        assert.equal((await getIndex(exportKey('boundary')))?.updatedAt, 8640000000000000);
        const result = await runExport(exportRequest(['timestamp', 'boundary']));
        assert.equal(result.exported, 2);
        assert.deepEqual(result.failed, []);
        const files = await readDeliveredFiles(host);
        const markdown = await Promise.all(files.filter(file => file.name.endsWith('.md')).map(file => file.async('string')));
        assert.equal(markdown.length, 2);
        assert.ok(markdown.some(content => String(content).includes('+275760-09-13T00:00:00.000Z')));
        assert.ok(markdown.some(content => String(content).includes('1970-01-01T00:00:00.200Z')));
    });
}
});
