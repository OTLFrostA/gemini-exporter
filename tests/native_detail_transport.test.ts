import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useIndexStorage } from './helpers/indexStorage.js';
import { ACCOUNT_UUID, OTHER_ACCOUNT_UUID } from './helpers/accountIds.js';
import { sourceDetail, sourceMessage } from './helpers/l1SourceFixture.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { ingestDetail } from '../src/l2/ingestion.js';
import { getDetail, getIndex } from '../src/l3a/storageService.js';
import type { SourceConversationParseResult } from '../src/l1/parsers/parsingResult.js';

useIndexStorage();

const CONVERSATION_ID = 'native_bridge';

function parseNativeReply(): SourceConversationParseResult {
    const turn = [
        ['c_' + CONVERSATION_ID, 'r_abc123'],
        [1700000000, 0],
        [['Independent question']],
        [[['rc_answer', [['Independent answer']]]]],
    ];
    const raw = JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn], null, 'Native title'])]]);
    return parseGeminiRpcConversation(raw, { providerId: 'gemini', targetConvId: CONVERSATION_ID });
}

// A source payload is not a normalized v2 Detail merely because it arrived over IPC.
function opaqueWireIsNotDomain(value: unknown): void {
    // @ts-expect-error Unvalidated native payloads cannot bypass L1 normalization.
    const detail: Parameters<typeof ingestDetail>[2] = value;
    void detail;
}
void opaqueWireIsNotDomain;

test('v2 native RPC parsing produces keyless facts, not a versioned Domain envelope', async () => {
    const candidate = parseNativeReply();
    assert.equal(candidate.conversationId, CONVERSATION_ID);
    assert.equal(candidate.conversation.index.title, 'Native title');
    assert.deepEqual(candidate.conversation.detail.messages.map(message => message.role), ['user', 'assistant']);
    assert.equal('key' in candidate.conversation.index, false);
    assert.equal('key' in candidate.conversation.detail, false);
    assert.equal('account' in candidate, false);
    assert.equal('transport' in candidate.conversation, false);
    assert.equal('domainEnvelopeVersion' in candidate, false);
    assert.equal(await getIndex({ accountId: ACCOUNT_UUID, conversationId: CONVERSATION_ID }), null,
        'pure L1 parsing must not persist a conversation');
});

test('malformed native payloads and wrong Provider context cannot be admitted as Detail', async () => {
    for (const raw of ['', 'not JSON', 'null']) {
        assert.throws(() => parseGeminiRpcConversation(raw, { providerId: 'gemini' }));
    }
    for (const raw of [null, 42, {}]) {
        assert.throws(() => parseGeminiRpcConversation(raw as never, { providerId: 'gemini' }),
            /raw response text/);
    }
    assert.throws(() => parseGeminiRpcConversation('[]', { providerId: 'chatgpt' }),
        /requires providerId gemini/);
    assert.equal(await getDetail({ accountId: ACCOUNT_UUID, conversationId: CONVERSATION_ID }), null);
});

test('L2 binds native source facts to the Account key and persists the same message graph', async () => {
    const candidate = parseNativeReply();
    const result = await ingestDetail(ACCOUNT_UUID, candidate.conversationId,
        candidate.conversation.detail, candidate.conversation.index);
    assert.deepEqual(result, { accepted: true, changed: true });

    const key = { accountId: ACCOUNT_UUID, conversationId: CONVERSATION_ID };
    const index = await getIndex(key);
    const detail = await getDetail(key);
    assert.deepEqual(index?.key, key);
    assert.deepEqual(detail?.key, key);
    assert.deepEqual(detail?.messages.map(message => message.role), ['user', 'assistant']);
    assert.deepEqual(JSON.parse(JSON.stringify(detail?.messages)),
        JSON.parse(JSON.stringify(candidate.conversation.detail.messages)));
    assert.equal('transport' in detail!, false);
    assert.equal(await getDetail({ accountId: OTHER_ACCOUNT_UUID, conversationId: CONVERSATION_ID }), null);
});

test('identical Provider conversation IDs are isolated by the L2 Account identity', async () => {
    const first = parseNativeReply();
    const second = sourceDetail({
        id: 'c_' + CONVERSATION_ID,
        title: 'Other account title',
        messages: [sourceMessage('other-answer', 'Other account body', 'model')],
    });
    assert.equal(second.conversationId, first.conversationId);
    await ingestDetail(ACCOUNT_UUID, first.conversationId,
        first.conversation.detail, first.conversation.index);
    await ingestDetail(OTHER_ACCOUNT_UUID, second.conversationId,
        second.conversation.detail, second.conversation.index);

    const primary = await getDetail({ accountId: ACCOUNT_UUID, conversationId: CONVERSATION_ID });
    const other = await getDetail({ accountId: OTHER_ACCOUNT_UUID, conversationId: CONVERSATION_ID });
    assert.equal(primary?.key.accountId, ACCOUNT_UUID);
    assert.equal(other?.key.accountId, OTHER_ACCOUNT_UUID);
    assert.deepEqual(primary?.messages.map(message => message.role), ['user', 'assistant']);
    assert.deepEqual(other?.messages.map(message => message.role), ['assistant']);
    assert.equal((await getIndex({ accountId: OTHER_ACCOUNT_UUID, conversationId: CONVERSATION_ID }))?.title,
        'Other account title');
});

test('native attachment bytes remain source-only; L2 persists asset identity and references', async () => {
    const rawBytes = new Uint8Array([1, 2, 3]);
    const candidate = sourceDetail({
        id: 'c_native_asset',
        messages: [{
            ...sourceMessage('answer', 'Attached report', 'model'),
            attachmentCount: 1,
            attachments: [{ type: 'file', name: 'report.bin', dataBuffer: rawBytes }],
        }],
    });
    assert.equal(candidate.conversation.detail.assets.length, 1);
    assert.equal(candidate.conversation.detail.messages[0].attachmentIds?.length, 1);
    assert.equal('dataBuffer' in candidate.conversation.detail.assets[0], false);

    await ingestDetail(ACCOUNT_UUID, candidate.conversationId,
        candidate.conversation.detail, candidate.conversation.index);
    const stored = await getDetail({ accountId: ACCOUNT_UUID, conversationId: candidate.conversationId });
    assert.ok(stored);
    assert.deepEqual(stored.assets.map(asset => asset.id),
        candidate.conversation.detail.assets.map(asset => asset.id));
    assert.deepEqual(stored.messages[0].attachmentIds,
        candidate.conversation.detail.messages[0].attachmentIds);
    assert.equal('dataBuffer' in stored.assets[0], false);
    assert.equal('acquisitionHints' in stored, false);
});
