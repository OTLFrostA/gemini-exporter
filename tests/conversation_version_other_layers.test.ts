// Export/serialization scenarios retained pending migration of their Application/Delivery owners.
import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { admitFixture } from './helpers/admitFixture.js';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { toJsonStandard } from '../src/core/engine/formatters/jsonFormatter.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGeminiRpcConversation } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import { mergeConversationPages } from '../src/core/parsers/gemini/rpc/mergePages.js';
import { restoreConversationIndex } from '../src/core/domain/conversationIndex.js';
import { __clearDomainMemory } from '../src/core/storage/domain/domainStore.js';
import { buildExportCompletion } from '../src/core/engine/export/exportCompletion.js';
import { resolveConversationExportState } from '../src/core/utils/titleUtils.js';
import { parseLegacyStorageConversation } from './helpers/recordFixture/parseConversation.js';

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

test('export freshness compares source versions even with a newer Index and a far-ahead local clock', () => {
    const parsed = detail([1700000000, 0], [1700000000, 0]);
    const index = restoreConversationIndex(parsed.conversation.index);
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
    assert.equal(archive.conversation.detail.savedAt, parsed.sourceVersion);
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
