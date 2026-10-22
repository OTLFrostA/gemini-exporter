import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';
import { extractNativeDocuments } from '../src/l1/parsers/gemini/rpc/nativeDocuments.js';

function packet(kind: number, body: string, suffix = 'report.md') {
    const row: unknown[] = ['c_native_chat_' + suffix, null, 'Source document', null, body];
    row[10] = kind;
    return row;
}
function capture(rows: unknown[], more = false) {
    const candidate: unknown[] = ['rc_native', ['Answer before document']];
    candidate[30] = rows;
    const turn = [['c_native_chat', 'r_native'], null, [['Question']], [[candidate]], [1700000010, 0]];
    const raw = JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn], more ? 'next' : null, null, []])],
        ['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [['c_native_chat', 'Title', null, null, null, [1700000000, 0]]]])]]);
    return parseGeminiRpcConversation(raw, { providerId: 'gemini', targetConvId: 'native_chat' });
}
for (const [kind, body] of [[1, '# Report\n\nExact source body'], [2, '```python\nprint("ok")\n```'], [3, '# Research\n\nReferences and findings']] as const) {
    test(`native document kind ${kind}: exact body without metadata or heuristic duplication`, () => {
        const row = packet(kind, body);
        row[8] = [['Metadata that must never become document prose'.repeat(5)]];
        const parsed = capture([row]);
        assert.equal(parsed.conversation.detail.assets.length, 1);
        assert.equal(parsed.conversation.detail.assets[0].document?.contentMarkdown, body);
        assert.deepEqual(parsed.evidence?.heuristicDocumentIds, []);
        assert.equal(parsed.conversation.detail.messages.length, 2);
        const merged = mergeConversationPages([parsed], undefined, true);
        assert.equal(merged.conversation.detail.quality.status, 'complete');
        assert.equal(merged.conversation.detail.savedAt, 1700000000000);
        assert.ok(merged.diagnostics.some(d => d.code === 'CONVERSATION_VERSION_MISMATCH'));
        assert.equal(mergeConversationPages([capture([row], true)], 'token_loop', false).conversation.detail.quality.status, 'partial');
    });
}
test('native document decoding rejects unrelated identities, unknown kinds and malformed bodies', () => {
    const foreign = packet(3, 'Foreign'); foreign[0] = 'c_another_chat_report';
    const noBody = packet(3, '');
    const candidate: unknown[] = []; candidate[30] = [foreign, noBody, packet(26, 'code packet'), packet(99, 'unknown')];
    assert.deepEqual(extractNativeDocuments(candidate, 'native_chat'), []);
    assert.deepEqual(extractNativeDocuments(candidate), []);
});
test('native documents stay bound to their answer when titles match', () => {
    const a = capture([packet(3, 'First body', 'first')]);
    const b = capture([packet(3, 'Second body', 'second')]);
    assert.equal(a.conversation.detail.assets[0].document?.contentMarkdown, 'First body');
    assert.equal(b.conversation.detail.assets[0].document?.contentMarkdown, 'Second body');
    assert.notEqual(a.conversation.detail.assets[0].id, b.conversation.detail.assets[0].id);
});
