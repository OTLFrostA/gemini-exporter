import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { toJsonStandard } from '../src/core/engine/formatters/jsonFormatter.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGeminiRpcConversation } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import { mergeConversationPages } from '../src/core/parsers/gemini/rpc/mergePages.js';
import { indexFromParsed } from '../src/core/storage/conversationIndexFromParsed.js';
import { __clearDomainMemory, saveDomainConversation } from '../src/core/storage/domain/domainStore.js';
import { buildExportCompletion } from '../src/core/engine/export/exportCompletion.js';
import { resolveConversationExportState } from '../src/core/utils/titleUtils.js';
import { parseLegacyStorageConversation } from '../src/core/parsers/legacyStorage/parseConversation.js';

beforeEach(() => __clearDomainMemory());
const wire = (rows: Array<[string, unknown]>) => JSON.stringify(rows.map(([rpc, payload]) => ['wrb.fr', rpc, JSON.stringify(payload)]));
function detail(messageTime: number[], version?: number[], more = false, id = 'version_chat') {
    const turn = [[`c_${id}`, 'r_request'], null, [['Question']], [[['rc_answer', [['Answer']]]]], messageTime];
    const calls: Array<[string, unknown]> = [['hNvQHb', [[turn], more ? 'tCnext' : null, null, []]]];
    if (version) calls.push(['MaZiqc', [null, null, [[`c_${id}`, 'Source title', null, null, null, version]]]]);
    const result = parseGeminiRpcConversation(wire(calls), { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: id });
    if (!more && result.conversation.detail.quality.status !== 'partial') result.conversation.detail.quality.status = 'complete';
    return result;
}

test('six anonymized live pairs preserve identical List/Detail versions and latest turn times', () => {
    const pairs: Array<{ listUpdatedAt: number; detailUpdatedAt: number; maxMessageAt: number; listWire: number[]; detailTurnWire: number[]; metadataWire: number[] }> =
        JSON.parse(readFileSync('tests/fixtures/gemini_timestamp_pairs.json', 'utf8'));
    for (const pair of pairs) {
        assert.equal(pair.listUpdatedAt, pair.maxMessageAt);
        assert.equal(pair.detailUpdatedAt, pair.listUpdatedAt);
        const parsed = detail(pair.detailTurnWire, pair.metadataWire);
        const index = parseList(wire([['MaZiqc', [null, null, [['c_version_chat', 'Source title', null, null, null, pair.listWire]]]]])).conversations[0];
        assert.equal(parsed.sourceVersion, index.updatedAt);
        assert.equal(parsed.sourceVersion, pair.listUpdatedAt);
        assert.equal(indexFromParsed(parsed).updatedAt, pair.listUpdatedAt);
    }
});
test('matching metadata owns the update version, while message dates remain message facts', () => {
    const parsed = detail([1700000000, 0], [1700000005, 123000000]);
    assert.equal(parsed.sourceVersion, 1700000005123);
    assert.equal(parsed.conversation.detail.messages[0].timestamp, 1700000000000);
    assert.equal(detail([1700000000, 0]).sourceVersion, undefined);
    const unrelated = wire([['hNvQHb', [[[['c_actual_chat', 'r_req'], [1700000000, 0], [['Q']], [[['rc_a', [['A']]]]]]]]],
        ['MaZiqc', [null, null, [['c_other_chat', 'Unrelated', null, null, null, [1700000005, 0]]]]]]);
    assert.equal(parseGeminiRpcConversation(unrelated, { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'actual_chat' }).sourceVersion, undefined);
    const list = parseList(wire([['MaZiqc', [null, null, [['c_version_chat', 'Source title', [1700000005, 0], [1700000000, 0], null, null]]]]])).conversations[0];
    assert.equal(list.updatedAt, undefined, 'creation/unknown wire slots cannot substitute for the update slot');
});
test('savedAt is the committed source version and cannot advance for rejected or partial captures', async () => {
    const first = await saveDomainConversation('10000000-0000-4000-8000-000000000001', detail([1700000000, 0], [1700000000, 0]));
    assert.equal(first.savedAt, 1700000000000);
    assert.equal('updatedAt' in first.conversation, false);
    assert.equal('sourceVersion' in first, false);
    const repeated = await saveDomainConversation('10000000-0000-4000-8000-000000000001', detail([1700000000, 0], [1700000000, 0]));
    assert.equal(repeated.savedAt, first.savedAt);
    assert.equal(repeated.revision, first.revision);
    const newer = await saveDomainConversation('10000000-0000-4000-8000-000000000001', detail([1700000005, 0], [1700000005, 0]));
    assert.equal(newer.savedAt, 1700000005000);
    const rejected = await saveDomainConversation('10000000-0000-4000-8000-000000000001', detail([1700000010, 0], [1700000010, 0], true));
    assert.equal(rejected.savedAt, newer.savedAt);
    assert.deepEqual(rejected.conversation.detail, newer.conversation.detail);
    assert.equal(rejected.conversation.index.updatedAt, 1700000010000);
    const older = await saveDomainConversation('10000000-0000-4000-8000-000000000001', detail([1700000000, 0], [1700000000, 0]));
    assert.equal(older.savedAt, newer.savedAt);
});
test('partial, unknown, metadata-only, conflicting and migrated bodies carry no saved source version', async () => {
    const partial = await saveDomainConversation('10000000-0000-4000-8000-000000000001', detail([1700000000, 0], [1700000000, 0], true, 'partial_chat'));
    assert.equal(partial.savedAt, 1700000000000);
    const unknown = await saveDomainConversation('10000000-0000-4000-8000-000000000001', detail([1700000000, 0], undefined, false, 'unknown_chat'));
    assert.equal(unknown.savedAt, undefined);
    const conflicting = await saveDomainConversation('10000000-0000-4000-8000-000000000001', detail([1700000005, 0], [1700000000, 0], false, 'conflicting_chat'));
    assert.equal(conflicting.conversation.detail.quality.status, 'partial');
    assert.equal(conflicting.savedAt, 1700000000000);
    const metadata = parseGeminiRpcConversation(wire([['MaZiqc', [null, null, [['c_metadata_chat', 'Metadata only', null, null, null, [1700000000, 0]]]]]]), { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'metadata_chat' });
    assert.equal((await saveDomainConversation('10000000-0000-4000-8000-000000000001', metadata)).savedAt, 1700000000000);
    const legacy = parseLegacyStorageConversation({ metadata: { id: 'legacy_chat', title: 'Legacy', updatedAt: 1700000005000,
        messages: [{ role: 'user', content: 'Cached older body', timestamp: 1700000000000 }] } }, { account: fixtureAccount('gemini'), providerId: 'gemini' });
    assert.equal(legacy.sourceVersion, undefined);
    assert.equal((await saveDomainConversation('10000000-0000-4000-8000-000000000001', legacy, [], true))?.savedAt, undefined);
});
test('a version change during pagination invalidates the saved version until a consistent refetch', async () => {
    const first = detail([1700000005, 0], [1700000005, 0], true);
    const changed = detail([1700000000, 0], [1700000010, 0]);
    const mixed = mergeConversationPages([first, changed]);
    assert.equal(mixed.conversation.detail.quality.status, 'partial');
    assert.ok(mixed.diagnostics.some(d => d.code === 'CONVERSATION_VERSION_CHANGED'));
    assert.equal((await saveDomainConversation('10000000-0000-4000-8000-000000000001', mixed)).savedAt, undefined);
    const consistent = mergeConversationPages([first, detail([1700000000, 0], [1700000005, 0])]);
    assert.equal((await saveDomainConversation('10000000-0000-4000-8000-000000000001', consistent)).savedAt, 1700000005000);
});
test('export freshness compares source versions even with a newer Index and a far-ahead local clock', () => {
    const parsed = detail([1700000000, 0], [1700000000, 0]);
    const index = indexFromParsed(parsed);
    const record = buildExportCompletion({ conversation: parsed.conversation, chatTime: parsed.sourceVersion, exportedAt: 1900000000000 }).exportRecord;
    assert.equal(record.chatTime, parsed.sourceVersion);
    assert.equal(resolveConversationExportState(index, record).needsIncrementalExport, false);
    assert.equal(resolveConversationExportState({ ...index, updatedAt: index.updatedAt! + 1 }, record).needsIncrementalExport, true);
    assert.equal(resolveConversationExportState(index, { ...record, chatTime: undefined }).needsIncrementalExport, true);
    const unknown = buildExportCompletion({ conversation: { id: 'unversioned_chat', messages: [{ timestamp: 1700000000000 }], createdAt: 1700000000000 }, exportedAt: 1900000000000 });
    assert.equal(unknown.exportRecord.chatTime, undefined);
});

test('JSON archives retain one saved body version outside Detail and partial captures omit it', () => {
    const parsed = detail([1700000000, 0], [1700000000, 0]);
    const archive = JSON.parse(toJsonStandard(parsed));
    assert.equal(archive.savedAt, parsed.sourceVersion);
    assert.equal('updatedAt' in archive.conversation, false);
    assert.equal('sourceVersion' in archive, false);
    const partial = JSON.parse(toJsonStandard(detail([1700000000, 0], [1700000000, 0], true)));
    assert.equal('savedAt' in partial, true);
});


test('diagnostic deletion or spoofed diagnostic codes cannot change merged completeness or export status', () => {
    const healthy = detail([1700000000, 0], [1700000005, 0]);
    const rejected = {   ...healthy, conversation: { ...healthy.conversation, detail: {   ...healthy.conversation.detail, quality: { status: 'partial' as const, rejectedTurns: 1 } } } };
    const mismatched = detail([1700000010, 0], [1700000005, 0]);
    for (const [input, expected] of [[healthy, 'unknown'], [rejected, 'partial'], [mismatched, 'partial']] as const) {
        const warnings = [{ severity: 'error' as const, code: 'GEMINI_TURNS_REJECTED', message: 'diagnostic only' },
            { severity: 'error' as const, code: 'CONVERSATION_VERSION_MISMATCH', message: 'diagnostic only' }];
        const records = [[], warnings].map(diagnostics => {
            const merged = mergeConversationPages([{   ...input, diagnostics }]);
            assert.equal(merged.conversation.detail.quality.status, expected);
            return buildExportCompletion({ conversation: merged.conversation, exportedAt: 1900000000000 }).exportRecord;
        });
        assert.deepEqual(records[0], records[1]);
        assert.equal(records[0].status, expected === 'partial' ? 'partial' : 'ok');
    }
});
