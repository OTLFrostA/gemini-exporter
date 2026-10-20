import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { ingestDetail } from '../src/l2/ingestion.js';
import { readStoredConversation } from './helpers/readStoredConversation.js';
import type { SourceConversationParseResult } from '../src/l1/parsers/parsingResult.js';
import { fixtureAccount } from './helpers/domainFixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { parseList } from '../src/l1/parsers/gemini/rpc/parseList.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';

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
        assert.equal(parsed.conversation.index.updatedAt, pair.listUpdatedAt);
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
test('savedAt is the committed source version and retains the complete body version when a newer partial capture loses selection', async () => {
    const first = await commitSource(detail([1700000000, 0], [1700000000, 0]));
    assert.equal(first.conversation.detail.savedAt, 1700000000000);
    assert.equal('updatedAt' in first.conversation, false);
    assert.equal(first.sourceVersion, first.conversation.detail.savedAt);
    const repeated = await commitSource(detail([1700000000, 0], [1700000000, 0]));
    assert.equal(repeated.conversation.detail.savedAt, first.conversation.detail.savedAt);
    assert.deepEqual(repeated.conversation.detail, first.conversation.detail);
    const newer = await commitSource(detail([1700000005, 0], [1700000005, 0]));
    assert.equal(newer.conversation.detail.savedAt, 1700000005000);
    const rejected = await commitSource(detail([1700000010, 0], [1700000010, 0], true));
    assert.equal(rejected.conversation.detail.savedAt, newer.conversation.detail.savedAt);
    assert.deepEqual(rejected.conversation.detail, newer.conversation.detail);
    assert.equal(rejected.conversation.index.updatedAt, 1700000010000);
    const older = await commitSource(detail([1700000000, 0], [1700000000, 0]));
    assert.equal(older.conversation.detail.savedAt, newer.conversation.detail.savedAt);
});
test('Detail savedAt follows known source evidence even for partial or metadata-only captures', async () => {
    const partial = await commitSource(detail([1700000000, 0], [1700000000, 0], true, 'partial_chat'));
    assert.equal(partial.conversation.detail.savedAt, 1700000000000);
    const unknown = await commitSource(detail([1700000000, 0], undefined, false, 'unknown_chat'));
    assert.equal(unknown.conversation.detail.savedAt, undefined);
    const conflicting = await commitSource(detail([1700000005, 0], [1700000000, 0], false, 'conflicting_chat'));
    assert.equal(conflicting.conversation.detail.quality.status, 'partial');
    assert.equal(conflicting.conversation.detail.savedAt, 1700000000000);
    const metadata = parseGeminiRpcConversation(wire([['MaZiqc', [null, null, [['c_metadata_chat', 'Metadata only', null, null, null, [1700000000, 0]]]]]]), { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'metadata_chat' });
    assert.equal((await commitSource(metadata)).conversation.detail.savedAt, 1700000000000);
});
test('a version change during pagination invalidates the saved version until a consistent refetch', async () => {
    const first = detail([1700000005, 0], [1700000005, 0], true);
    const changed = detail([1700000000, 0], [1700000010, 0]);
    const mixed = mergeConversationPages([first, changed]);
    assert.equal(mixed.conversation.detail.quality.status, 'partial');
    assert.ok(mixed.diagnostics.some(d => d.code === 'CONVERSATION_VERSION_CHANGED'));
    assert.equal((await commitSource(mixed)).conversation.detail.savedAt, undefined);
    const consistent = mergeConversationPages([first, detail([1700000000, 0], [1700000005, 0])]);
    assert.equal((await commitSource(consistent)).conversation.detail.savedAt, 1700000005000);
});
test('diagnostic deletion or spoofed diagnostic codes cannot change merged Detail quality', () => {
    const healthy = detail([1700000000, 0], [1700000005, 0]);
    const rejected = {   ...healthy, conversation: { ...healthy.conversation, detail: {   ...healthy.conversation.detail, quality: { status: 'partial' as const, rejectedTurns: 1 } } } };
    const mismatched = detail([1700000010, 0], [1700000005, 0]);
    for (const [input, expected] of [[healthy, 'unknown'], [rejected, 'partial'], [mismatched, 'partial']] as const) {
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
