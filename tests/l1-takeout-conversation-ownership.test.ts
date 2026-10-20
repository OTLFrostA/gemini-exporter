import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useIndexStorage } from './helpers/indexStorage.js';
import { ACCOUNT_UUID, OTHER_ACCOUNT_UUID } from './helpers/accountIds.js';
import { activityHtml, takeoutArchive } from './helpers/l1SourceFixture.js';
import { decodeTakeoutHtml, decodeTakeoutHtmlAsync } from '../src/l1/parsers/gemini/takeout/decodeHtml.js';
import { parseGeminiTakeoutArchive, parseGeminiTakeoutArchiveAsync, parseGeminiTakeoutConversation } from '../src/l1/parsers/gemini/takeout/parseConversation.js';
import { importTakeout } from '../src/l1/imports/takeout/importTakeout.js';
import { getDetail, listIndexes } from '../src/l3a/storageService.js';

useIndexStorage();

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const url = (id: string) => `https://gemini.google.com/app/${id}`;
const context = { providerId: 'gemini' };

function linkedActivity(): string {
    return `<div class="outer-cell"><a href="${url(A)}">Original conversation</a>`
        + `<div class="content-cell mdl-cell mdl-typography--body-1">Prompted please review <a href="${url(B)}">this linked chat</a><br>`
        + `2026-09-02T12:00:00Z<br><div><p>See <a href="${url(B)}">another conversation</a>.</p></div>`
        + `</div><div class="content-cell mdl-typography--text-right"><a href="${url(B)}">preview link</a></div></div>`;
}

test('LP-02: content-cell links are never conversation identities in sync or async Takeout decoding', async () => {
    const html = linkedActivity();
    const sync = decodeTakeoutHtml(html);
    assert.deepEqual(sync.map(event => event.conversationIds), [[A]]);
    assert.deepEqual(await decodeTakeoutHtmlAsync(html), sync);
    const sources = parseGeminiTakeoutArchive({ htmlText: html }, context);
    assert.deepEqual(sources.map(source => source.conversationId), [A]);
    assert.deepEqual((await parseGeminiTakeoutArchiveAsync({ htmlText: html }, context)).map(source => source.conversationId), [A]);
    assert.deepEqual(sources[0].conversation.detail.messages.map(m => m.role), ['user', 'assistant']);
    assert.throws(() => parseGeminiTakeoutConversation({ htmlText: html }, { ...context, targetConvId: B }), /targetConvId/);
});

test('LP-02: an activity with only authored conversation links does not invent an owner', async () => {
    const html = `<div class="outer-cell"><div class="content-cell">Prompted <a href="${url(B)}">a related chat</a><br>`
        + `<p>See ${url(B)}</p></div></div>`;
    assert.deepEqual(decodeTakeoutHtml(html)[0].conversationIds, []);
    assert.throws(() => parseGeminiTakeoutArchive({ htmlText: html }, context), /no recognized conversation identities/);
    await assert.rejects(parseGeminiTakeoutArchiveAsync({ htmlText: html }, context), /no recognized conversation identities/);
});

test('LP-02: bare metadata URLs after the content-cell remain supported', () => {
    const html = `<div class="outer-cell"><div class="content-cell">Prompted Question<br><p>Answer about ${url(B)}</p></div>`
        + `${url(A)}</div>`;
    assert.deepEqual(decodeTakeoutHtml(html)[0].conversationIds, [A]);
    assert.equal(parseGeminiTakeoutArchive({ htmlText: html }, context)[0].conversationId, A);
});

test('LP-02: conflicting metadata identities are skipped, not duplicated into both conversations', async () => {
    const conflict = `<div class="outer-cell"><a href="${url(A)}">First</a><a href="${url(B)}">Second</a>`
        + `<div class="content-cell">Prompted Ambiguous<br><p>Ambiguous answer</p></div></div>`;
    assert.deepEqual(decodeTakeoutHtml(conflict)[0].conversationIds, []);
    const html = activityHtml('<p>Correct answer</p>', A) + conflict;
    const sync = parseGeminiTakeoutArchive({ htmlText: html }, context);
    const asyncResults = await parseGeminiTakeoutArchiveAsync({ htmlText: html }, context);
    assert.deepEqual(sync.map(source => source.conversationId), [A]);
    assert.deepEqual(asyncResults.map(source => source.conversationId), [A]);
    assert.equal(sync[0].conversation.detail.messages.length, 2, 'ambiguous event is not copied even into its first candidate');
    assert.equal(asyncResults[0].conversation.detail.messages.length, 2);
});

test('LP-02: selected-account import never writes the linked conversation B', async () => {
    const result = await importTakeout(takeoutArchive(linkedActivity()), ACCOUNT_UUID);
    assert.equal(result.imported, 1);
    assert.ok(await getDetail({ accountId: ACCOUNT_UUID, conversationId: A }));
    assert.equal(await getDetail({ accountId: ACCOUNT_UUID, conversationId: B }), null);
    assert.deepEqual((await listIndexes(ACCOUNT_UUID)).map(row => row.key.conversationId), [A]);
    assert.deepEqual(await listIndexes(OTHER_ACCOUNT_UUID), [], 'existing account selection is unchanged');
});
