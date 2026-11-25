import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { ACCOUNT_UUID } from "./helpers/accountRuntime.js";
import { OTHER_ACCOUNT_UUID } from "./helpers/accountRuntime.js";
import { activityHtml } from "./helpers/l1SourceFixture.js";
import { takeoutArchive } from "./helpers/l1SourceFixture.js";
import { importTakeout } from "../src/application/imports/importTakeout.js";
import { stripHtmlTags } from "../src/l1/parsers/gemini/takeout/decodeHtml.js";
import { parseGeminiTakeoutZipArchive } from "../src/l1/imports/takeout/readArchive.js";
import { parseGeminiTakeoutArchive } from "../src/l1/parsers/gemini/takeout/parseConversation.js";
import { createSourceResourceContext } from "../src/l1/resources/sourceResources.js";
import { listIndexes as getConversations } from "../src/l3a/storageService.js";
import { getDetail } from "../src/l3a/storageService.js";
import { ingestIndexes } from "../src/l2/ingestion.js";
import { test as test__s1 } from "node:test";
import { ACCOUNT_UUID as ACCOUNT_UUID__s1 } from "./helpers/accountIds.js";
import { OTHER_ACCOUNT_UUID as OTHER_ACCOUNT_UUID__s1 } from "./helpers/accountIds.js";
import { decodeTakeoutHtml } from "../src/l1/parsers/gemini/takeout/decodeHtml.js";
import { decodeTakeoutHtmlAsync } from "../src/l1/parsers/gemini/takeout/decodeHtml.js";
import { parseGeminiTakeoutArchiveAsync } from "../src/l1/parsers/gemini/takeout/parseConversation.js";
import { parseGeminiTakeoutConversation } from "../src/l1/parsers/gemini/takeout/parseConversation.js";
import { listIndexes } from "../src/l3a/storageService.js";
import { readTakeoutBytes } from "../src/l1/imports/takeout/readArchive.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { createTakeoutResourceResolver } from "../src/l1/parsers/gemini/takeout/archiveResources.js";
import { readConversation } from "../src/l2/readConversation.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { collectDocumentResources } from "../src/l3b/ast/resourceReferences.js";
import { prepareExportResources } from "../src/application/export/prepareExportResources.js";
import { planExportPaths } from "../src/l4/packaging/index.js";
import { buildExportFiles } from "../src/l4/packaging/index.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { type TakeoutSourceFile } from "../src/l1/parsers/gemini/takeout/archiveResources.js";
import { putAccount } from "../src/l3a/storageService.js";
import { getAccount } from "../src/l3a/storageService.js";
import { listAccounts } from "../src/l3a/storageService.js";
import { handleTakeoutImport } from "../src/ui/options/controllers/takeoutController.js";
import { updateSettings } from "../src/application/settings/index.js";
import { ConversationViewState } from "../src/ui/options/state/conversationsStore.js";
import { test as test__s6 } from "node:test";
import { fixtureKey } from "./helpers/domainFixture.js";
import { sourceDetail } from "./helpers/l1SourceFixture.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { getIndex } from "../src/l3a/storageService.js";
import { compareConversationIndexes } from "../src/l2/conversationIndex.js";
import { restoreConversationIndex } from "../src/l2/conversationIndex.js";

__suiteDescribe("takeout_engine", () => {
useIndexStorage();

test('Takeout counts overlapping conversations once and repeated imports add no conversations', async () => {
    const existing = activityHtml('<p>Existing answer</p>', 'existing_chat_123');
    assert.equal((await importTakeout(takeoutArchive(existing), ACCOUNT_UUID)).added, 1);
    await ingestIndexes(ACCOUNT_UUID, [{ conversationId: 'online_only_123', fields: { title: 'Online only', titleSource: 'provider' } }]);
    const html = existing + activityHtml('<p>New answer</p>', 'new_chat_123')
        + activityHtml('<p>Another turn</p>', 'new_chat_123', '2026-09-02T12:01:00Z');
    const first = await importTakeout(takeoutArchive(html), ACCOUNT_UUID);
    assert.equal(first.imported, 2);
    assert.equal(first.added, 1);
    assert.equal((await getConversations(ACCOUNT_UUID)).length, 3);
    const second = await importTakeout(takeoutArchive(html), ACCOUNT_UUID);
    assert.equal(second.imported, 2);
    assert.equal(second.added, 0);
    assert.equal((await getConversations(ACCOUNT_UUID)).length, 3);
});

test('concurrent imports attribute a new conversation to only its creating transaction', async () => {
    const html = activityHtml('<p>Answer</p>', 'concurrent_chat_123');
    const results = await Promise.all([importTakeout(takeoutArchive(html), ACCOUNT_UUID),
        importTakeout(takeoutArchive(html), ACCOUNT_UUID)]);
    assert.equal(results[0].added + results[1].added, 1);
    assert.equal((await getConversations(ACCOUNT_UUID)).length, 1);
});

test('Takeout import exposes only count/status after committing multi-turn facts with case-preserved source identity', async () => {
    const html = activityHtml('<p>First answer</p>', 'CasePreserved_123') + activityHtml('<p>Second answer</p>', 'CasePreserved_123', '2026-09-02T12:01:00Z');
    const progress: number[] = [];
    const result = await importTakeout(takeoutArchive(html), ACCOUNT_UUID, n => progress.push(n));
    assert.deepEqual(Object.keys(result).sort(), ['added', 'imported', 'status']); assert.equal(result.imported, 1);
    const stored = await getDetail({ accountId: ACCOUNT_UUID, conversationId: 'CasePreserved_123' });
    assert.ok(stored); assert.equal(stored.messages.length, 4);
    assert.equal((await getConversations(ACCOUNT_UUID))[0].titleSource, 'derived');
    assert.equal(progress.at(-1), 100); assert.ok(progress.every(n => typeof n === 'number'));
});
test('Takeout unreferenced C2PA files do not become conversation resources by timestamp proximity', async () => {
    let reads = 0;
    const resources = createSourceResourceContext();
    try {
        await importTakeout(takeoutArchive(activityHtml(), { 'watermarked.png': { _data: { uncompressedSize: 50 }, async: async () => { reads++; return new TextEncoder().encode('c2pa date="20260902120000Z"'); } } }), ACCOUNT_UUID, undefined, resources);
        const stored = await getDetail({ accountId: ACCOUNT_UUID, conversationId: 'source_chat_123' });
        assert.ok(stored); assert.deepEqual(stored.assets, []); assert.equal(reads, 0);
        await assert.rejects(resources.acquire({ accountId: ACCOUNT_UUID, conversationId: 'source_chat_123' }, { id: 'watermarked.png', kind: 'image' }), /locator/);
    } finally { resources.release(); }
});
test('authentic cleaned Takeout fixture has six keyless conversations and retains unresolved media diagnostics', async () => {
    const JSZip = require('../lib/jszip.min.js');
    const bytes = readFileSync(__dirname + '/fixtures/gemini_takeout_clean.zip');
    const parsed = await parseGeminiTakeoutZipArchive(bytes, { providerId: 'gemini', readArchive: raw => JSZip.loadAsync(raw) });
    assert.equal(parsed.length, 6);
    assert.ok(parsed.some(p => p.conversationId === '1cea7e48cc166b57'));
    const cat = parsed.find(p => p.conversationId === '1bd028d5c5b0c0e2'); assert.ok(cat);
    assert.equal('account' in cat, false); assert.equal('key' in cat.conversation.detail, false);
    assert.ok(cat.diagnostics.some(d => d.code === 'TAKEOUT_GENERATED_MEDIA_UNRESOLVED'));
    const bell = parsed.find(p => p.conversationId === '7b29852ecae8344a');
    const prompts = bell?.conversation.detail.messages.filter(message => message.role === 'user');
    assert.match(JSON.stringify(prompts ?? []), /Bell's inequality/);
});
test('Takeout ZIP decodes prompt entities once after stripping HTML tags', async () => {
    const JSZip = require('../lib/jszip.min.js');
    const zip = new JSZip();
    zip.file('Takeout/Gemini/MyActivity.html', activityHtml().replace('Prompted Question',
        'Prompted <b>A</b>&nbsp;&amp; B &lt; C; literal &amp;lt; &amp;nbsp; &lt;b&gt;; &#x1F642; &#39; &quot; &apos;'));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const [parsed] = await parseGeminiTakeoutZipArchive(bytes, { providerId: 'gemini', readArchive: raw => JSZip.loadAsync(raw) });
    assert.deepEqual(parsed.conversation.detail.messages.find(message => message.role === 'user')?.content, [{
        type: 'paragraph', children: [{ type: 'text', text: `A & B < C; literal &lt; &nbsp; <b>; 🙂 ' " '` }],
    }]);
});
test('Takeout account UUID binds ingestion; independent imports never mix accounts', async () => {
    await importTakeout(takeoutArchive(activityHtml('<p>One</p>', 'first_chat_123')), ACCOUNT_UUID);
    await importTakeout(takeoutArchive(activityHtml('<p>Two</p>', 'second_chat_123')), OTHER_ACCOUNT_UUID);
    assert.deepEqual((await getConversations(ACCOUNT_UUID)).map(i => i.key.conversationId), ['first_chat_123']);
    assert.deepEqual((await getConversations(OTHER_ACCOUNT_UUID)).map(i => i.key.conversationId), ['second_chat_123']);
});
test('Takeout rejects missing, slot-shaped and foreign-provider targets before opening ZIP bytes', async () => {
    for (const accountId of ['', 'u0', '10000000-0000-4000-8000-000000000004']) await assert.rejects(importTakeout({} as File, accountId), /account|Account|Gemini/);
});
test('Takeout rejects unsupported and over-budget archives without producing facts', async () => {
    await assert.rejects(importTakeout(takeoutArchive('<p>Unsupported activity</p>'), ACCOUNT_UUID));
    const archive = takeoutArchive();
    Reflect.get(archive, 'files')['Takeout/Gemini/MyActivity.html']._data.uncompressedSize = 300 * 1024 * 1024;
    await assert.rejects(importTakeout(archive, ACCOUNT_UUID), /size|limit|ZIP|MB|MiB|large|超|大小/i);
    assert.equal((await getConversations(ACCOUNT_UUID)).length, 0);
});
test('Takeout native parsing and HTML cleanup are pure and do not require an archive or Registry', () => {
    const raw = { htmlText: activityHtml() };
    const before = structuredClone(raw);
    const [source] = parseGeminiTakeoutArchive(raw, { providerId: 'gemini' });
    assert.equal(source.conversationId, 'source_chat_123'); assert.deepEqual(raw, before);
    assert.equal(stripHtmlTags('<p>Hello <strong>world</strong></p>'), 'Hello world');
});
});

__suiteDescribe("l1-takeout-conversation-ownership", () => {
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

test__s1('LP-02: content-cell links are never conversation identities in sync or async Takeout decoding', async () => {
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

test__s1('LP-02: an activity with only authored conversation links does not invent an owner', async () => {
    const html = `<div class="outer-cell"><div class="content-cell">Prompted <a href="${url(B)}">a related chat</a><br>`
        + `<p>See ${url(B)}</p></div></div>`;
    assert.deepEqual(decodeTakeoutHtml(html)[0].conversationIds, []);
    assert.throws(() => parseGeminiTakeoutArchive({ htmlText: html }, context), /no recognized conversation identities/);
    await assert.rejects(parseGeminiTakeoutArchiveAsync({ htmlText: html }, context), /no recognized conversation identities/);
});

test__s1('LP-02: bare metadata URLs after the content-cell remain supported', () => {
    const html = `<div class="outer-cell"><div class="content-cell">Prompted Question<br><p>Answer about ${url(B)}</p></div>`
        + `${url(A)}</div>`;
    assert.deepEqual(decodeTakeoutHtml(html)[0].conversationIds, [A]);
    assert.equal(parseGeminiTakeoutArchive({ htmlText: html }, context)[0].conversationId, A);
});

test__s1('LP-02: conflicting metadata identities are skipped, not duplicated into both conversations', async () => {
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

test__s1('LP-02: selected-account import never writes the linked conversation B', async () => {
    const result = await importTakeout(takeoutArchive(linkedActivity()), ACCOUNT_UUID__s1);
    assert.equal(result.imported, 1);
    assert.ok(await getDetail({ accountId: ACCOUNT_UUID__s1, conversationId: A }));
    assert.equal(await getDetail({ accountId: ACCOUNT_UUID__s1, conversationId: B }), null);
    assert.deepEqual((await listIndexes(ACCOUNT_UUID__s1)).map(row => row.key.conversationId), [A]);
    assert.deepEqual(await listIndexes(OTHER_ACCOUNT_UUID__s1), [], 'existing account selection is unchanged');
});

test__s1('LP-02: actual Takeout caption metadata remains the owner while linked chat B stays authored content', async () => {
    const html = '<div class="outer-cell">'
        + '<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">'
        + 'Prompted compare <a href="' + url(B) + '">linked chat</a><br>2026-09-02T12:00:00Z<br>'
        + '<p>Response refers to <a href="' + url(B) + '">the other chat</a>.</p></div>'
        + '<div class="content-cell mdl-cell--6-col mdl-typography--text-right"><a href="' + url(B) + '">preview</a></div>'
        + '<div class="content-cell mdl-cell--12-col mdl-typography--caption"><b>Details</b><br>'
        + '&emsp;Source: ' + url(A) + '<br><a href="' + url(A) + '">Open conversation</a><br>'
        + 'This activity was saved to your Google Account.</div></div>';
    assert.deepEqual(decodeTakeoutHtml(html)[0].conversationIds, [A], 'the canonical caption URL wins over authored links');
    assert.deepEqual((await decodeTakeoutHtmlAsync(html))[0].conversationIds, [A]);
    assert.deepEqual(parseGeminiTakeoutArchive({ htmlText: html }, context).map(source => source.conversationId), [A]);
    assert.deepEqual((await parseGeminiTakeoutArchiveAsync({ htmlText: html }, context)).map(source => source.conversationId), [A]);
});

test__s1('LP-02: conflicting caption metadata URLs are rejected even with no body links', () => {
    const html = '<div class="outer-cell"><div class="content-cell">Prompted Question<br><p>Answer</p></div>'
        + '<div class="content-cell mdl-typography--caption"><a href="' + url(A) + '">A</a><a href="' + url(B) + '">B</a></div></div>';
    assert.deepEqual(decodeTakeoutHtml(html)[0].conversationIds, [], 'ambiguous metadata cannot duplicate one activity');
    assert.throws(() => parseGeminiTakeoutArchive({ htmlText: html }, context), /no recognized conversation identities/);
});
});

__suiteDescribe("media_index_safety", () => {
test('source resource - readTakeoutBytes boundaries and validation', async () => {
    const validBytes = new Uint8Array([1, 2, 3]);
    const fileValid = { async: async () => validBytes };
    assert.deepStrictEqual(await readTakeoutBytes(fileValid), validBytes);

    const fileEmpty = { async: async () => new Uint8Array(0) };
    assert.strictEqual(await readTakeoutBytes(fileEmpty), null);

    const fileString = { async: async () => 'not bytes' };
    assert.strictEqual(await readTakeoutBytes(fileString), null);

    const fileNull = { async: async () => null };
    assert.strictEqual(await readTakeoutBytes(fileNull), null);

    const fileObj = { async: async () => ({ length: 10 }) };
    assert.strictEqual(await readTakeoutBytes(fileObj), null);

    assert.strictEqual(await readTakeoutBytes({}), null);



    // 5. Rejection preserves error propagation to caller
    const fileError = {
        async: async () => { throw new Error('ZIP read failure'); }
    };
    await assert.rejects(async () => {
        await readTakeoutBytes(fileError);
    }, /ZIP read failure/);
});
});

__suiteDescribe("p1_h1_takeout", () => {
const test = require('node:test');
const assert = require('node:assert');

const zipBombGuard = require('../src/l1/parsers/shared/archive/zipBombGuard.js');


// The full media-index suite covers general matching/slot isolation. This is a
// distinct substring-direction regression: the requested name contains a stored one.
test('p1_h1 - source resolver must not match a filename by substring', () => {
    const { createTakeoutResourceResolver } = require('../src/l1/parsers/gemini/takeout/archiveResources.js');
    const resolve = createTakeoutResourceResolver({ 'cat-photo.png': {} });
    assert.equal(resolve('prefix-cat-photo.png').status, 'missing');
    assert.equal(resolve('cat-photo.png').status, 'resolved');
});

test('p1_h1 - P1-114: zip guards fail closed on unknown size', () => {
    assert.throws(() => zipBombGuard.validateZipFile(undefined), /无法确认|Cannot determine/);
    assert.throws(() => zipBombGuard.validateZipFile({} as any), /无法确认|Cannot determine/);
    assert.throws(() => zipBombGuard.validateZipFile({ size: 600 * 1024 * 1024 }), /过大|too large/i);
    assert.doesNotThrow(() => zipBombGuard.validateZipFile(Buffer.alloc(10) as any), 'Buffer uses .length');
    assert.throws(
        () => zipBombGuard.validateZipEntries({ files: { 'a.txt': { dir: false } } } as any),
        /无法确认未压缩大小|unverified sizes/i
    );
    assert.doesNotThrow(
        () => zipBombGuard.validateZipEntries({ files: { 'a.txt': { dir: false, _data: { uncompressedSize: 10 } } } } as any)
    );
    assert.throws(
        () => zipBombGuard.validateZipEntries({ files: { 'huge.bin': { dir: false, _data: {
            uncompressedSize: 1024 * 1024 * 1024 + 1 // Test the documented 1 GiB limit, not an internal export
        } } } } as any),
        /过大|超过|too large|OOM/i, 'declared uncompressed size must enforce the ZIP bomb cap without allocating bytes'
    );
});

// C2PA marker/date coverage lives in media_index_safety.test.ts and takeout_engine.test.ts.

test('p1_h1 - explicit numeric UTC offsets in English and Chinese Takeout dates', () => {
    const { parseTakeoutTimestamp } = require('../src/l1/parsers/gemini/takeout/decodeHtml.js');
    // Avoid asserting a CST interpretation from prompt language: CST is ambiguous
    // without locale metadata, and a Chinese prompt is not timezone evidence.

    const blockUtc = '<div class="content-cell">Prompted Hello<br>Jul 15, 2024, 2:30:00 PM UTC+8</div>';
    const tsUtc = parseTakeoutTimestamp(blockUtc);
    assert.ok(tsUtc !== null);
    assert.strictEqual(new Date(tsUtc).toISOString(), '2024-07-15T06:30:00.000Z');

    const blockZh = '<div class="content-cell">提示 你好<br>2024年3月15日 下午2:30:00 UTC+8</div>';
    const tsZh = parseTakeoutTimestamp(blockZh);
    assert.ok(tsZh !== null);
    assert.strictEqual(new Date(tsZh).toISOString(), '2024-03-15T06:30:00.000Z');
});
});

__suiteDescribe("takeout-resource-lookup", () => {
/**
 * V2 Takeout media lookup is an L1 source-resolver/task-reader contract.
 * Archive bytes belong to SourceResourceContext, while L2/L3a retain only
 * identity and source locators. L4 owns output paths, not the Takeout parser.
 * No durable media cache or deleted v1 AssetPipeline is involved.
 */

















useIndexStorage();
const account = fixtureAccount('gemini');
const activityPath = 'Takeout/Gemini/MyActivity.html';
const key = (conversationId: string) => ({ accountId: account.id, conversationId });
const path = (name: string) => 'Takeout/Gemini/' + name;
function entry(bytes: Uint8Array): TakeoutSourceFile {
    return { _data: { uncompressedSize: bytes.byteLength },
        async: async (type: string) => type === 'uint8array' ? bytes.slice() : new TextDecoder().decode(bytes) };
}
function imageActivity(id: string, uri: string, generated = false): string {
    const body = '<p>Takeout answer <img src="' + uri + '"></p>';
    return activityHtml(body, id) + (generated ? '1 generated image' : '');
}
function files(entries: Record<string, Uint8Array>) {
    return Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [name, entry(bytes)]));
}

test('Takeout source resolver prefers the exact archive URI over duplicate basenames', () => {
    const selected = entry(Uint8Array.of(1, 2));
    const other = entry(Uint8Array.of(3, 4));
    const resolve = createTakeoutResourceResolver({
        [path('archive-0.png')]: selected,
        [path('older/archive-0.png')]: other,
    }, activityPath);
    const result = resolve(path('archive-0.png'));
    assert.equal(result.status, 'resolved');
    if (result.status !== 'resolved') return;
    assert.equal(result.method, 'archive-path');
    assert.equal(result.resource.path, path('archive-0.png'));
    assert.strictEqual(result.resource.entry, selected);
});

test('Takeout reference relative to activity HTML takes priority over an unrelated duplicate filename', () => {
    const selected = entry(Uint8Array.of(10)), other = entry(Uint8Array.of(20));
    const resolve = createTakeoutResourceResolver({
        [path('assets/diagram.png')]: selected,
        [path('backup/assets/diagram.png')]: other,
    }, activityPath);
    const result = resolve('assets/diagram.png');
    assert.equal(result.status, 'resolved');
    if (result.status !== 'resolved') return;
    assert.equal(result.method, 'relative-path');
    assert.strictEqual(result.resource.entry, selected);
});

test('unique basename or normalized Takeout wrapper may resolve, but duplicate candidates never pick arbitrary bytes', () => {
    const one = entry(Uint8Array.of(1)), two = entry(Uint8Array.of(2));
    const single = createTakeoutResourceResolver({ [path('images/graph.png')]: one }, activityPath);
    const unique = single('graph.png');
    assert.equal(unique.status, 'resolved');
    if (unique.status === 'resolved') assert.strictEqual(unique.resource.entry, one);
    const wrapped = createTakeoutResourceResolver({ [path('images/graph.png.synced')]: one }, activityPath);
    const normalized = wrapped('graph.png');
    assert.equal(normalized.status, 'resolved');
    if (normalized.status === 'resolved') assert.strictEqual(normalized.resource.entry, one);
    const duplicate = createTakeoutResourceResolver({
        [path('images/graph.png')]: one, [path('other/graph.png')]: two,
    }, activityPath);
    assert.equal(duplicate('graph.png').status, 'ambiguous');
    assert.equal(duplicate('unobserved.png').status, 'missing');
});

test('percent-encoded Takeout reference selects the literal archive filename without renaming its source identity', () => {
    const original = entry(Uint8Array.of(77));
    const resolve = createTakeoutResourceResolver({ [path('image name.png')]: original }, activityPath);
    const match = resolve('image%20name.png');
    assert.equal(match.status, 'resolved');
    if (match.status === 'resolved') {
        assert.strictEqual(match.resource.entry, original);
        assert.equal(match.resource.path, path('image name.png'));
    }
});

test('L1 Takeout -> L2/L3a -> Application resource preparation -> L3b/L4 preserves exact archive bytes', async t => {
    const id = 'takeout-byte-01', raw = Uint8Array.of(137, 80, 78, 71, 10, 21, 32);
    const archivePath = path('archive-0.png');
    const archive = takeoutArchive(imageActivity(id, 'archive-0.png', true), {
        [archivePath]: entry(raw) as { async: (type: string) => Promise<unknown>; _data: { uncompressedSize: number } },
    });
    const resources = createSourceResourceContext();
    t.after(() => resources.release());
    const result = await importTakeout(archive, account.id, undefined, resources);
    assert.equal(result.imported, 1);
    assert.equal(result.status, 'partial', 'Takeout cannot certify complete conversation history');
    const conversation = await readConversation(key(id));
    assert.ok(conversation);
    assert.equal(conversation.detail.quality.status, 'partial');
    const media = conversation.detail.assets.find(item => item.kind === 'image');
    assert.ok(media);
    const retained = await resources.acquire(key(id), media);
    assert.deepEqual(retained.bytes, raw, 'Task resource reader must return original ZIP bytes');

    const document = composeDomainDocument(conversation, account);
    const required = collectDocumentResources(document);
    assert.ok(required.referencedIds.has(media.id));
    const prepared = await prepareExportResources(conversation.detail.assets, required.referencedIds,
        (asset, signal) => resources.acquire(key(id), asset, signal));
    const selected = prepared.get(media.id);
    assert.ok(selected?.ok);
    assert.deepEqual(selected.value.bytes, raw);
    const [plan] = planExportPaths([{ conversation, prepared, fileIds: required.fileIds }], 'markdown');
    const markdown = renderDocumentMarkdown(document, plan.resources);
    const packaged = buildExportFiles('markdown', plan, markdown, prepared);
    const binary = packaged.find(file => file.fileName === plan.resources[media.id]);
    assert.ok(binary);
    assert.deepEqual(binary.content, raw);
    assert.match(binary.fileName, /^assets\//);
    assert.ok(markdown.includes(binary.fileName));
    assert.notEqual(binary.fileName, media.sourceUri, 'L4 destination is not a source identity');
    assert.ok(!JSON.stringify(conversation.detail).includes('dataBase64'));
    assert.ok(!JSON.stringify(conversation.detail).includes('_data'));
    assert.ok(!JSON.stringify(conversation.detail).includes('archiveResources'));
    resources.release();
    await assert.rejects(resources.acquire(key(id), media), /Resource context released/);
});

test('rejected or empty Takeout ZIP bytes remain partial and never produce a fabricated image sidecar', async t => {
    const id = 'takeout-empty-02', uri = 'missing-data.png';
    const archive = takeoutArchive(imageActivity(id, uri), { [path(uri)]: entry(new Uint8Array()) as {
        async: (type: string) => Promise<unknown>; _data: { uncompressedSize: number };
    } });
    const resources = createSourceResourceContext();
    t.after(() => resources.release());
    assert.equal((await importTakeout(archive, account.id, undefined, resources)).imported, 1);
    const conversation = await readConversation(key(id));
    assert.ok(conversation);
    const document = composeDomainDocument(conversation, account);
    const refs = collectDocumentResources(document);
    assert.ok(refs.referencedIds.size > 0);
    const prepared = await prepareExportResources(conversation.detail.assets, refs.referencedIds,
        (asset, signal) => resources.acquire(key(id), asset, signal));
    assert.ok([...prepared.values()].some(value => !value.ok));
    const [plan] = planExportPaths([{ conversation, prepared, fileIds: refs.fileIds }], 'markdown');
    const markdown = renderDocumentMarkdown(document, plan.resources);
    const artifacts = buildExportFiles('markdown', plan, markdown, prepared);
    assert.equal(artifacts.length, 1, 'no unverified ZIP bytes can become a sidecar');
    assert.match(markdown, /Takeout answer/);
    assert.doesNotMatch(markdown, /\]\(assets\/[^)]*missing-data\.png\)/);
});

test('Takeout parser binds explicitly referenced generated media, not a guessed generation sibling', () => {
    const id = 'takeout-generated-03', first = path('first.png'), sibling = path('second.png');
    const html = imageActivity(id, 'first.png', true);
    const parsed = parseGeminiTakeoutConversation({
        htmlText: html, activityPath,
        archiveFiles: files({ [first]: Uint8Array.of(1), [sibling]: Uint8Array.of(2) }),
    }, { providerId: 'gemini', account });
    const selected = parsed.conversation.detail.assets.filter(asset => asset.kind === 'image');
    assert.equal(selected.length, 1);
    assert.equal(Object.keys(parsed.archiveResources).length, 1);
    assert.equal(Object.values(parsed.archiveResources)[0].path, first);
    assert.equal(selected[0].generation?.imageCount, 1);
    assert.equal(selected[0].generation?.imageOrdinal, 0);
});
});

__suiteDescribe("takeout_transact", () => {
useIndexStorage({ seedAccounts: false });
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
async function accounts(){for(const id of [A,B])await putAccount({id,providerId:'gemini',providerAccountId:id});}
const never=async()=>{throw Error('Unexpected account creation');};
test('Takeout imports through ingestion once; UI rereads canonical metadata including concurrent commits and provider title authority',async()=>{
    await accounts();await ingestIndexes(A,[{conversationId:'online',fields:{title:'Provider title',titleSource:'provider'}}]);const view=new ConversationViewState();let imports=0;
    const result=await handleTakeoutImport(new File(['fixture'],'Takeout.zip'),A,{onTarget:async id=>{view.selectAccount(id);}},{getAccount,listAccounts,getOrCreateAccount:never,updateSettings,importTakeout:async(_file,id)=>{
        imports++;await Promise.all(['online','imported','concurrent'].map(conversationId=>ingestIndexes(id,[{conversationId,fields:{title:`Imported ${conversationId}`,titleSource:'derived'}}])));return{imported:1, added: 0,status:'ok' as const};
    }});await view.refresh();assert.equal(imports,1);assert.equal(result.imported,1);assert.deepEqual(view.indexes.map(x=>x.key.conversationId).sort(),['concurrent','imported','online']);assert.equal(view.indexes.find(x=>x.key.conversationId==='online')?.title,'Provider title');assert.deepEqual(view.indexes,await listIndexes(A));
});
test('an import remains scoped to its captured target even when the view switches accounts',async()=>{
    await accounts();const view=new ConversationViewState();view.selectAccount(A);
    await handleTakeoutImport(new File(['fixture'],'Takeout.zip'),A,{onTarget:async id=>{assert.equal(id,A);}},{getAccount,listAccounts,getOrCreateAccount:never,updateSettings,importTakeout:async(_f,id)=>{
        view.selectAccount(B);await view.refresh();assert.equal(id,A);await ingestIndexes(id,[{conversationId:'imported',fields:{title:'Imported',titleSource:'derived'}}]);return{imported:1, added: 0,status:'ok' as const};
    }});assert.equal(view.accountId,B);assert.deepEqual(view.indexes,[]);assert.equal((await listIndexes(A)).length,1);assert.deepEqual(await listIndexes(B),[]);
});
for(const initial of [null,B])test(`without any accounts Takeout selects Gemini default from ${initial??'empty selection'}`,async()=>{
    const fallback={id:'10000000-0000-4000-8000-000000000003',providerId:'gemini',providerAccountId:'default'};let selected=initial,importedInto='';
    await handleTakeoutImport(new File(['fixture'],'Takeout.zip'),initial,{onTarget:async id=>{selected=id;}},{listAccounts:async()=>[],getAccount:never,getOrCreateAccount:async(providerId,identity)=>{assert.equal(providerId,'gemini');assert.equal(identity,'default');return fallback;},updateSettings,importTakeout:async(_f,id)=>{importedInto=id;return{imported:0, added: 0,status:'ok' as const};}});
    assert.equal(selected,fallback.id);assert.equal(importedInto,fallback.id);
});
});

__suiteDescribe("takeout_versions", () => {
useIndexStorage();
const id = 'source_chat_123';
const key = fixtureKey(id);
const archive = () => parseGeminiTakeoutArchive({ htmlText: activityHtml('<p>Archive answer</p>', id, '2026-09-02T12:00:00Z') }, { providerId: 'gemini' })[0];

test__s6('Takeout first, online later accepts a lower source version and retains the independent display date', async () => {
    const takeout = archive();
    await ingestDetail(key.accountId, id, takeout.conversation.detail, takeout.conversation.index);
    assert.equal((await getIndex(key))?.updatedAt, undefined);
    assert.equal((await getDetail(key))?.savedAt, undefined);
    const online = sourceDetail();
    online.conversation.detail.quality.status = 'partial';
    const admission = await ingestDetail(key.accountId, id, online.conversation.detail, online.conversation.index);
    assert.equal(admission.accepted, true);
    assert.equal((await getIndex(key))?.updatedAt, 1700000000000);
    assert.equal((await getIndex(key))?.activityAt, Date.parse('2026-09-02T12:00:00Z'));
    assert.deepEqual((await getDetail(key))?.messages, online.conversation.detail.messages);
});

test__s6('reimporting Takeout cannot erase a known online version or replace its partial body', async () => {
    const online = sourceDetail();
    online.conversation.detail.quality.status = 'partial';
    await ingestDetail(key.accountId, id, online.conversation.detail, online.conversation.index);
    const takeout = archive();
    const admission = await ingestDetail(key.accountId, id, takeout.conversation.detail, takeout.conversation.index);
    assert.equal(admission.accepted, false);
    assert.equal((await getIndex(key))?.updatedAt, online.sourceVersion);
    assert.equal((await getDetail(key))?.savedAt, online.sourceVersion);
    assert.deepEqual((await getDetail(key))?.messages, online.conversation.detail.messages);
});

test__s6('activity dates survive index validation and affect sorting without becoming versions', () => {
    const takeout = restoreConversationIndex({ key, activityAt: 2000 });
    const online = restoreConversationIndex({ key: fixtureKey('other'), updatedAt: 1000 });
    assert.ok(compareConversationIndexes(takeout, online) < 0);
    assert.equal(takeout.updatedAt, undefined);
    assert.throws(() => restoreConversationIndex({ key, activityAt: NaN }), /schema/);
});
});
