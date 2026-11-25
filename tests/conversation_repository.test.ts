import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import assert from "node:assert/strict";
import { putOne } from "../src/l3a/idb.js";
import { indexStorage } from "./helpers/indexStorage.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { ingestDetailsBatch } from "../src/l2/ingestion.js";
import { ingestIndexes } from "../src/l2/ingestion.js";
import { ingestDeletedConversation } from "../src/l2/ingestion.js";
import { readStoredConversation } from "./helpers/readStoredConversation.js";
import { conversationKey } from "../src/l2/conversationKey.js";
import { getIndex } from "../src/l3a/storageService.js";
import { getDetail } from "../src/l3a/storageService.js";
import { getExportRecord } from "../src/l3a/storageService.js";
import { putExportRecord } from "../src/l3a/storageService.js";
import { updateConversationAtomically } from "../src/l3a/storageService.js";
import { type DomainConversationDetail } from "../src/l2/conversationDetail.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { deleteStoredConversation } from "../src/l3a/storageService.js";
import { shouldSkipExport } from "../src/application/export/runExport.js";
import { clearLocalExportRecords } from "../src/application/localCleanup.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { serializeDomainJson } from "../src/l4/format/json/serializeDomainJson.js";
import { type ExportRequest } from "../src/application/export/types.js";
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { historicalFixture } from "./helpers/nativeFixture.js";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { readConversation } from "../src/l2/readConversation.js";
import { restoreDomainSnapshot } from "../src/l2/runtimeValidation.js";
import * as storage from "../src/l3a/storageService.js";
import { type ExportRecord } from "../src/application/export/types.js";
import { makeConversationIndex } from "./helpers/conversationIndexFixture.js";
import { indexFixture } from "./helpers/indexFixture.js";
import { indexActivityTime } from "../src/l2/conversationIndex.js";
import { mergeConversationIndex } from "../src/l2/conversationIndex.js";
import { listIndexes } from "../src/l3a/storageService.js";
import { putAccount } from "../src/l3a/storageService.js";
import { ConversationViewState } from "../src/ui/options/state/conversationsStore.js";
import { STORAGE_KEYS } from "../src/shared/utils/constants.js";
import { restoreConversationIndex } from "../src/l2/conversationIndex.js";
import { test as test__s7 } from "node:test";
import { parseList } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { compareConversationIndexes } from "../src/l2/conversationIndex.js";
import { listGen as geminiListGen } from "./fixtures/providers/gemini.js";
import { getCoverage } from "../src/l3a/storageService.js";
import { updateCoverageAtomically } from "../src/l3a/storageService.js";
import { test as test__s9 } from "node:test";
import { parseGeminiIndexObservation } from "../src/l1/parsers/gemini/parseIndexObservation.js";
import { TITLE_AUTHORITY_RANK } from "../src/l2/titleAuthority.js";
import { titleAuthorityRank } from "../src/l2/titleAuthority.js";
import { resolveTitle } from "../src/l2/titleAuthority.js";

__suiteDescribe("conversation_repository", () => {
/** L2 persistence/read boundaries; retired repository and export orchestration are not L2 ports. */









const accountId = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const key = { accountId, conversationId: 'chat' };
const fields = { title: 'Old title', titleSource: 'provider' as const, updatedAt: 100 };
const body = (): Omit<DomainConversationDetail, 'key'> => ({ savedAt: 100, quality: { status: 'complete' }, assets: [],
    messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Question' }] }] },
        { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Answer' }] }] }] });
async function seed() { await ingestDetail(accountId, key.conversationId, body(), fields); }
async function rename(title = 'Renamed', updatedAt = 200) {
    await ingestIndexes(accountId, [{ conversationId: key.conversationId, fields: { title, titleSource: 'provider', updatedAt, createdAt: 50 } }]);
}

test('Index owns metadata; Detail does not acquire metadata during reads', async () => {
    const env = indexStorage();
    try {
        await seed(); await rename();
        const snapshot = await readStoredConversation(key); assert.ok(snapshot);
        assert.equal(snapshot.index.title, 'Renamed'); assert.equal(snapshot.index.createdAt, 50);
        assert.equal(snapshot.index.updatedAt, 200); assert.equal(snapshot.detail.savedAt, 100);
        assert.deepEqual(Object.keys(snapshot.detail).sort(), ['assets', 'key', 'messages', 'quality', 'savedAt']);
    } finally { env.restore(); }
});

test('missing, index-only, explicitly empty and partial Detail stay distinct without read repair', async () => {
    const env = indexStorage();
    try {
        assert.equal(await readStoredConversation(key), null);
        await ingestIndexes(accountId, [{ conversationId: 'chat', fields }]);
        const writes = env.writes();
        assert.equal(await readStoredConversation(key), null); assert.ok(await getIndex(key));
        assert.equal(await getDetail(key), null); assert.equal(env.writes(), writes);
        await ingestDetail(accountId, 'chat', { quality: { status: 'unknown' }, messages: [], assets: [] });
        assert.deepEqual((await readStoredConversation(key))?.detail.messages, []);
        await ingestDetail(accountId, 'chat', { ...body(), quality: { status: 'partial' } });
        assert.equal((await readStoredConversation(key))?.detail.quality.status, 'partial');
    } finally { env.restore(); }
});

test('read snapshots cannot mutate persisted Index or Detail and perform no writes', async () => {
    const env = indexStorage();
    try {
        await seed(); const writes = env.writes(); const snapshot = await readStoredConversation(key); assert.ok(snapshot);
        snapshot.index.title = 'Caller mutation'; snapshot.detail.messages.length = 0;
        const again = await readStoredConversation(key); assert.equal(again?.index.title, 'Old title');
        assert.equal(again?.detail.messages.length, 2); assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});

test('explicit keys isolate accounts and reads ignore orphan Detail without repairing it', async () => {
    const env = indexStorage();
    try {
        await seed(); const other = { ...key, accountId: otherId };
        await ingestDetail(otherId, 'chat', body(), { title: 'Other account', titleSource: 'provider' });
        assert.equal((await readStoredConversation(other))?.index.title, 'Other account');
        assert.equal((await readStoredConversation(key))?.index.title, 'Old title');
        await assert.rejects(ingestDetail('10000000-0000-4000-8000-000000000099', 'chat', body()), /account does not exist/);
        assert.throws(() => conversationKey('typo', 'chat'), /Invalid/);
        assert.throws(() => conversationKey(accountId, ''), /Invalid/);
        const orphanKey = { accountId, conversationId: 'orphan' };
        // Deliberately corrupt physical persistence: this is not a public admission API.
        await putOne('details', { ...body(), key: orphanKey });
        const writes = env.writes();
        assert.equal(await readStoredConversation(orphanKey), null); assert.ok(await getDetail(orphanKey));
        assert.equal(await getIndex(orphanKey), null); assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});

test('Index reads do not validate or read an independently corrupt body', async () => {
    const env = indexStorage();
    try {
        await seed();
        await updateConversationAtomically(key, () => ({ detail: { ...body(), key, messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'missing' }] }] }, result: undefined }));
        assert.equal((await getIndex(key))?.title, 'Old title');
        const writes = env.writes(); await assert.rejects(readStoredConversation(key), /asset|resource/i);
        assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});

test('failed Detail admission rolls back metadata and subsequent admissions recover', async () => {
    const env = indexStorage();
    try {
        await seed(); env.fail('details');
        await assert.rejects(ingestDetail(accountId, 'chat', { ...body(), savedAt: 200 }, { title: 'Uncommitted', titleSource: 'provider', updatedAt: 200 }), /write failed/);
        assert.equal((await getIndex(key))?.title, 'Old title'); assert.equal((await getDetail(key))?.savedAt, 100);
        env.fail(); await rename(); assert.equal((await readStoredConversation(key))?.index.title, 'Renamed');
    } finally { env.restore(); }
});

test('export history writes cannot roll back metadata renamed after a read', async () => {
    const env = indexStorage();
    try {
        await seed(); const snapshot = await readStoredConversation(key); assert.ok(snapshot); await rename();
        await putExportRecord(key, { format: 'markdown', status: 'ok', chatTime: snapshot.detail.savedAt, exportedAt: 900 });
        assert.equal((await getIndex(key))?.title, 'Renamed'); assert.equal((await getExportRecord(key))?.chatTime, 100);
        assert.equal((await readStoredConversation(key))?.detail.savedAt, 100);
    } finally { env.restore(); }
});

test('fresh Detail admission commits metadata independently of export completion', async () => {
    const env = indexStorage();
    try {
        await seed(); assert.equal((await getIndex(key))?.titleSource, 'provider');
        assert.equal((await readStoredConversation(key))?.detail.messages.length, 2);
        assert.equal(await getExportRecord(key), null);
    } finally { env.restore(); }
});

test('partial admission advances Index but retains the complete body version', async () => {
    const env = indexStorage();
    try {
        await seed();
        assert.deepEqual(await ingestDetail(accountId, 'chat', { ...body(), savedAt: 200, quality: { status: 'partial' }, messages: body().messages.slice(0, 1) }, { title: 'New title', titleSource: 'provider', updatedAt: 200 }), { accepted: false, changed: false });
        const stored = await readStoredConversation(key); assert.equal(stored?.index.updatedAt, 200);
        assert.equal(stored?.detail.messages.length, 2); assert.equal(stored?.detail.savedAt, 100);
    } finally { env.restore(); }
});

test('initial partial Detail keeps its known source version without claiming completeness', async () => {
    const env = indexStorage();
    try {
        await ingestDetail(accountId, 'chat', { ...body(), quality: { status: 'partial' } }, fields);
        const stored = await readStoredConversation(key); assert.equal(stored?.detail.savedAt, 100);
        assert.equal(stored?.detail.quality.status, 'partial'); assert.equal(stored?.index.updatedAt, 100);
    } finally { env.restore(); }
});

test('stale reads cannot republish metadata or resurrect confirmed deletion', async () => {
    const env = indexStorage();
    try {
        await seed(); const cached = await readStoredConversation(key); await rename();
        assert.equal(cached?.index.title, 'Old title'); assert.equal((await readStoredConversation(key))?.index.title, 'Renamed');
        await ingestDeletedConversation(accountId, 'chat'); const writes = env.writes();
        assert.equal(await readStoredConversation(key), null); assert.equal(await getIndex(key), null);
        assert.equal(env.writes(), writes); assert.equal(cached?.detail.messages.length, 2);
    } finally { env.restore(); }
});

test('ingestDetailsBatch commits a multi-conversation slice atomically and preserves sequential same-key selection', async () => {
    const env = indexStorage();
    try {
        const outcomes = await ingestDetailsBatch(accountId, [
            { conversationId: 'batch-a', detail: { ...body(), savedAt: 100, quality: { status: 'complete' } }, indexFields: { title: 'Initial A', titleSource: 'derived', updatedAt: 100 } },
            { conversationId: 'batch-a', detail: { ...body(), savedAt: 200, quality: { status: 'partial' }, messages: body().messages.slice(0, 1) }, indexFields: { title: 'Authoritative A', titleSource: 'provider', updatedAt: 200 } },
            { conversationId: 'batch-b', detail: { ...body(), savedAt: 150, quality: { status: 'complete' } }, indexFields: { title: 'Chat B', titleSource: 'provider', updatedAt: 150 } },
        ]);
        assert.deepEqual(outcomes, [
            { accepted: true, changed: true, indexAdded: true },
            { accepted: false, changed: false },
            { accepted: true, changed: true, indexAdded: true },
        ]);
        const storedA = await readStoredConversation({ accountId, conversationId: 'batch-a' });
        assert.equal(storedA?.index.title, 'Authoritative A');
        assert.equal(storedA?.detail.messages.length, 2, 'inferior partial detail in same batch must not overwrite complete body');
        assert.equal((await readStoredConversation({ accountId, conversationId: 'batch-b' }))?.index.title, 'Chat B');
    } finally { env.restore(); }
});
});

__suiteDescribe("conversation_repository_other_layers", () => {
// Cross-module v2 scenarios for L2 metadata admission, real L3a persistence,
// Application export records, and L3b/L4 output. No legacy Repository/batch-worker API.














const account = fixtureAccount('gemini');
const key = fixtureKey('chat');
const request: ExportRequest = {
    keys: [key], format: 'markdown', delivery: 'browserDownload',
    includeAssets: false, skipUnchanged: true,
};
const body = (answer: string, savedAt: number) => ({
    savedAt, quality: { status: 'complete' as const }, assets: [],
    messages: [
        { role: 'user' as const, content: [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text: 'Question' }] }] },
        { role: 'assistant' as const, content: [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text: answer }] }] },
    ],
});

test('current v2 Index authority wins over a stale selection without rewriting the stored Detail', async () => {
    const env = indexStorage();
    try {
        const incoming = body('Original answer', 100);
        await ingestDetail(key.accountId, key.conversationId, incoming, {
            title: 'Old title', titleSource: 'derived', createdAt: 70, updatedAt: 100,
        });
        await ingestIndexes(key.accountId, [{ conversationId: key.conversationId, fields: {
            title: 'Renamed title', titleSource: 'provider', createdAt: 50, updatedAt: 200,
        } }]);
        await ingestIndexes(key.accountId, [{ conversationId: key.conversationId, fields: {
            title: 'Stale selection title', titleSource: 'derived', updatedAt: 150,
        } }]);
        const restored = await readStoredConversation(key);
        assert.ok(restored);
        assert.equal(restored.index.title, 'Renamed title');
        assert.equal(restored.index.createdAt, 50);
        assert.equal(restored.index.updatedAt, 200);
        assert.equal(restored.detail.savedAt, 100);
        assert.ok(renderDocumentMarkdown(composeDomainDocument(restored, account), {}).includes('Original answer'));
        assert.equal(incoming.messages[1].content[0].children[0].text, 'Original answer', 'caller input remains intact');
    } finally {
        env.restore();
    }
});

test('a rename during export survives a v2 ExportRecord write; old chatTime cannot suppress newer content', async () => {
    const env = indexStorage();
    try {
        await ingestDetail(key.accountId, key.conversationId, body('Existing body', 100), {
            title: 'Original title', titleSource: 'derived', updatedAt: 100,
        });
        const prepared = await readStoredConversation(key);
        assert.ok(prepared);
        await ingestIndexes(key.accountId, [{ conversationId: key.conversationId, fields: {
            title: 'Rename during export', titleSource: 'user', updatedAt: 200,
        } }]);
        await putExportRecord(key, { exportedAt: 300, chatTime: 100, status: 'ok', format: 'markdown' });
        const current = await readStoredConversation(key);
        assert.equal(current?.index.title, 'Rename during export');
        assert.equal(current?.index.updatedAt, 200);
        assert.equal(prepared.index.title, 'Original title');
        assert.equal((await getExportRecord(key))?.chatTime, 100);
        assert.equal(shouldSkipExport(await getExportRecord(key), current?.index.updatedAt, request), false);
        await clearLocalExportRecords(key.accountId);
        assert.equal(await getExportRecord(key), null);
        assert.equal((await readStoredConversation(key))?.index.title, 'Rename during export');
    } finally {
        env.restore();
    }
});

test('fresh v2 admission commits Index and Detail before L3b/L4 can render them', async () => {
    const env = indexStorage();
    try {
        await ingestDetail(key.accountId, key.conversationId, body('Just acquired', 120), {
            title: 'Fresh title', titleSource: 'provider', createdAt: 20, updatedAt: 120,
        });
        assert.equal((await getIndex(key))?.createdAt, 20);
        assert.equal((await getDetail(key))?.savedAt, 120);
        assert.equal(await getExportRecord(key), null);
        const restored = await readStoredConversation(key);
        assert.ok(restored);
        const markdown = renderDocumentMarkdown(composeDomainDocument(restored, account), {});
        const json = JSON.parse(serializeDomainJson(restored, account, {}));
        assert.ok(markdown.includes('Just acquired'));
        assert.equal(json.conversation.index.title, 'Fresh title');
        assert.equal(json.conversation.detail.messages[1].content[0].children[0].text, 'Just acquired');
        assert.equal(json.conversation.detail.savedAt, 120);
    } finally {
        env.restore();
    }
});

test('a cached v2 view cannot republish old metadata or resurrect a deleted Index', async () => {
    const env = indexStorage();
    try {
        await ingestDetail(key.accountId, key.conversationId, body('Old body', 100), {
            title: 'Old title', titleSource: 'derived', updatedAt: 100,
        });
        const cached = await readStoredConversation(key);
        assert.ok(cached);
        await ingestDetail(key.accountId, key.conversationId, body('New body', 200), {
            title: 'New title', titleSource: 'provider', updatedAt: 200,
        });
        const writes = env.writes();
        const current = await readStoredConversation(key);
        assert.equal(current?.index.title, 'New title');
        assert.equal(current?.detail.savedAt, 200);
        assert.match(JSON.stringify(current?.detail.messages), /New body/);
        assert.match(JSON.stringify(cached.detail.messages), /Old body/);
        assert.equal(env.writes(), writes, 'read-only projections never write stale snapshots');
        await deleteStoredConversation(key);
        assert.equal(await readStoredConversation(key), null);
        assert.equal(await getIndex(key), null);
        assert.equal(await getDetail(key), null);
    } finally {
        env.restore();
    }
});
});

__suiteDescribe("conversation-representation", () => {
const captured = () => historicalFixture({ id: 'upgraded', title: 'Snapshot title', messages: [{ role: 'assistant', content: 'Saved body' }] });

test('AST: Index owns exported metadata while the body version remains capture evidence', () => {
    const parsed = {   ...captured(), sourceVersion: 100 };
    parsed.conversation.index.title = 'Current rename';
    parsed.conversation.index.updatedAt = 200;
    const document = composeDomainDocument(parsed.conversation, fixtureAccountFor(parsed.conversation));
    assert.equal(document.title, 'Current rename');
    assert.equal(document.metadata?.updatedAt, 200);
});
});

__suiteDescribe("conversation-representation-other-layers", () => {
/**
 * V2 representation and authority regression on actual L2, L3a, L3b and L4.
 * Metadata belongs to Index; Detail.savedAt is source capture evidence.
 * There is no flat v1 chat export DTO or ChatFormatter JSON wrapper.
 */












useIndexStorage();
const account = fixtureAccount('gemini');
const key = (conversationId: string) => ({ accountId: account.id, conversationId });
const paragraph = (text: string) => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text }] });

test('Index rename updates authority while Detail.savedAt and body remain actual immutable source evidence', async () => {
    const id = 'upgraded-conversation';
    await ingestDetail(account.id, id, {
        savedAt: 100, quality: { status: 'complete' }, assets: [],
        messages: [{ role: 'assistant', content: [paragraph('Saved body, never reinterpreted')] }],
    }, { title: 'Snapshot title', titleSource: 'provider', updatedAt: 100 });
    const detailBefore = await getDetail(key(id));
    assert.ok(detailBefore);
    await ingestIndexes(account.id, [{ conversationId: id,
        fields: { title: 'Current rename', titleSource: 'user', updatedAt: 200 } }]);

    const conversation = await readConversation(key(id));
    assert.ok(conversation);
    assert.equal(conversation.index.title, 'Current rename');
    assert.equal(conversation.index.titleSource, 'user');
    assert.equal(conversation.index.updatedAt, 200);
    assert.equal(conversation.detail.savedAt, 100);
    assert.deepEqual(await getDetail(key(id)), detailBefore, 'Index-only updates never modify Detail');
    assert.equal('title' in conversation.detail, false);
    assert.equal('updatedAt' in conversation.detail, false);

    const archive = JSON.parse(serializeDomainJson(conversation, account, {}));
    assert.equal(archive.format, 'gemini-exporter-domain');
    assert.equal(archive.version, 1);
    assert.equal(archive.conversation.index.title, 'Current rename');
    assert.equal(archive.conversation.index.updatedAt, 200);
    assert.equal(archive.conversation.detail.savedAt, 100);
    assert.equal('savedAt' in archive, false, 'a flat v1 source version must not be fabricated');
    assert.deepEqual(archive.conversation.detail, conversation.detail);
    const document = composeDomainDocument(conversation, account);
    assert.equal(document.title, 'Current rename');
    assert.equal(document.metadata.updatedAt, 200);
    assert.match(renderDocumentMarkdown(document, {}), /Saved body, never reinterpreted/);
});

test('cross-layer schema never admits a second title authority into the persisted Detail body', async () => {
    const id = 'closed-schema';
    await ingestDetail(account.id, id, {
        savedAt: 500, quality: { status: 'complete' }, assets: [],
        messages: [{ role: 'assistant', content: [paragraph('Canonical Detail')] }],
    }, { title: 'Canonical Index', titleSource: 'provider', updatedAt: 500 });
    const stored = await readConversation(key(id));
    assert.ok(stored);
    assert.throws(() => restoreDomainSnapshot({
        ...stored, detail: { ...stored.detail, title: 'Second authority' },
    }), /Domain contract/);
    assert.equal((await getIndex(key(id)))?.title, 'Canonical Index');
    assert.equal((await getDetail(key(id)))?.savedAt, 500);
    assert.match(renderDocumentMarkdown(composeDomainDocument(stored, account), {}), /Canonical Detail/);
});
});

__suiteDescribe("storage_export_surface_other_layers", () => {
// Cross-module Application/L2/L3a checks: no removed v1 session adapter or StorageService class.










const record: ExportRecord = { exportedAt: 300, chatTime: 100, format: 'markdown', includeAssets: true, status: 'ok' };
const request = (key: ReturnType<typeof fixtureKey>): ExportRequest => ({
    keys: [key], format: 'markdown', delivery: 'browserDownload',
    includeAssets: true, skipUnchanged: true,
});

test('v2 export record write failure does not fabricate an acknowledged delivery', async () => {
    const env = indexStorage();
    try {
        const key = fixtureKey('write_failure');
        env.fail('exportRecords');
        await assert.rejects(storage.putExportRecord(key, record), /write failed/);
        env.fail();
        assert.equal(await storage.getExportRecord(key), null);
        await storage.putExportRecord(key, record);
        assert.deepEqual(await storage.getExportRecord(key), record);
    } finally {
        env.restore();
    }
});

test('v2 export record persistence and cleanup never replace or delete L2 conversation facts', async () => {
    const env = indexStorage();
    try {
        const key = fixtureKey('stable-record');
        await ingestDetail(key.accountId, key.conversationId, {
            savedAt: 100, quality: { status: 'complete' }, assets: [],
            messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Keep this body' }] }] }],
        }, { title: 'Retained conversation', titleSource: 'provider', updatedAt: 100 });
        const originalIndex = await storage.getIndex(key);
        const originalDetail = await storage.getDetail(key);
        await storage.putExportRecord(key, record);
        assert.equal(shouldSkipExport(await storage.getExportRecord(key), originalIndex?.updatedAt, request(key)), true);
        await clearLocalExportRecords(key.accountId);
        assert.equal(await storage.getExportRecord(key), null);
        assert.deepEqual(await storage.getIndex(key), originalIndex);
        assert.deepEqual(await storage.getDetail(key), originalDetail);
    } finally {
        env.restore();
    }
});
});

__suiteDescribe("conversation_index_authority", () => {
useIndexStorage({ seedAccounts: false });

const accountId = '10000000-0000-4000-8000-000000000001';

async function ensureSeedAccount(): Promise<void> {
    await putAccount({ id: accountId, providerId: 'gemini', providerAccountId: 'fixture' });
}

test('index activity time is monotonic without a source-specific merge option or input mutation', () => {
    const old = makeConversationIndex({
        key: { conversationId: 'source-independent' },
        title: 'Stored',
        titleSource: 'provider',
        updatedAt: 2000,
    });
    for (const [time, expected] of [[1000, 2000], [3000, 3000]] as const) {
        const incoming = makeConversationIndex({
            key: { conversationId: old.key.conversationId },
            title: 'Stored',
            titleSource: 'provider',
            updatedAt: time,
        });
        const merged = mergeConversationIndex(old, incoming);
        assert.equal(merged.updatedAt, expected);
        assert.equal(old.updatedAt, 2000, 'merging must not mutate the stored observation');
    }
});

test('indexActivityTime ignores client-observed lastSeen and never authorizes skipping unversioned exports', () => {
    const legacy = indexActivityTime as (input: unknown) => number | undefined;
    assert.strictEqual(legacy({ id: 'c_lastseen_only', lastSeen: '2026-09-03T12:00:00.000Z' }), undefined);
    assert.strictEqual(legacy({ id: 'c2', lastSeen: 1788100000000 }), undefined);
    const serverUpdatedAt = 1788000000000;
    assert.strictEqual(legacy({ id: 'c3', updatedAt: serverUpdatedAt, lastSeen: 1788100000000 }), serverUpdatedAt);

    const record = { exportedAt: 1788000000000, chatTime: 1788000000000, format: 'markdown' as const, status: 'ok' as const };
    const request = { keys: [], delivery: 'browserDownload' as const, includeAssets: false, skipUnchanged: true, format: 'markdown' as const };
    assert.equal(shouldSkipExport(record, undefined, request), false);
    assert.equal(shouldSkipExport(record, 1788000000000, request), true);
    assert.equal(shouldSkipExport(record, 1788100000000, request), false);
});

test('legacy timestamp normalization drops invalid strings, coerces numeric strings and keeps the newest value', () => {
    const conv = (over: Record<string, unknown> = {}) => ({ id: 'c_hygiene_4242', title: 'hygiene probe', titles: {}, ...over });

    assert.strictEqual(STORAGE_KEYS.LANG, 'gemini_exporter_lang');
    assert.strictEqual(STORAGE_KEYS.PENDING_TAKEOUT_PROMPT, 'gemini_pending_takeout_prompt');

    assert.strictEqual(
        mergeConversationIndex(
            indexFixture(conv({ timestamp: 'not-a-date', updatedAt: null })),
            indexFixture(conv({ timestamp: null, updatedAt: null })),
        ).updatedAt,
        undefined,
    );

    const coerced = mergeConversationIndex(
        indexFixture(conv({ timestamp: '1726358400000', updatedAt: null })),
        indexFixture(conv({ timestamp: null, updatedAt: null })),
    );
    assert.strictEqual(coerced.updatedAt, 1726358400000);
    assert.strictEqual(typeof coerced.updatedAt, 'number');

    assert.strictEqual(
        mergeConversationIndex(
            indexFixture(conv({ timestamp: 1000, updatedAt: null })),
            indexFixture(conv({ timestamp: 9000, updatedAt: null })),
        ).updatedAt,
        9000,
    );
});

test('persisted Index admission rejects client lastSeen fields and keeps undated observations undated', async () => {
    await ensureSeedAccount();
    for (const [id, previous] of [['new', undefined], ['existing', 1000]] as const) {
        const key = { accountId, conversationId: id };
        if (previous) await ingestIndexes(accountId, [{ conversationId: id, fields: { updatedAt: previous } }]);
        await ingestIndexes(accountId, [{ conversationId: id, fields: { updatedAt: 900 } }]);
        const index = await getIndex(key);
        assert.equal(index?.updatedAt, previous ?? 900);
        assert.equal(Object.hasOwn(index ?? {}, 'lastSeen'), false);
        assert.equal(Object.hasOwn(index ?? {}, 'timestamp'), false);
        await assert.rejects(
            ingestIndexes(accountId, [{ conversationId: id, fields: { lastSeen: '2099-01-01' } as never }]),
            /Invalid conversation index schema/,
        );
        assert.equal((await getIndex(key))?.updatedAt, previous ?? 900);
    }

    await ingestIndexes(accountId, [{ conversationId: 'undated', fields: {} }]);
    const undated = await getIndex({ accountId, conversationId: 'undated' });
    assert.equal(undated?.updatedAt, undefined);
    assert.equal(undated?.createdAt, undefined);
});

test('Index persistence retains imported conversations across partial provider pages without transient import flags', async () => {
    await ensureSeedAccount();
    for (const conversationId of ['mixed', 'takeout', 'active', 'stale']) {
        await ingestIndexes(accountId, [{
            conversationId,
            fields: { title: conversationId, titleSource: conversationId === 'active' ? 'provider' : 'derived' },
        }]);
    }
    await ingestIndexes(accountId, [{ conversationId: 'mixed', fields: { title: 'Authoritative title', titleSource: 'provider' } }]);

    const view = new ConversationViewState();
    view.selectAccount(accountId);
    await view.refresh();
    await ingestIndexes(accountId, [{ conversationId: 'active', fields: { title: 'Online active', titleSource: 'provider' } }]);
    await view.refresh();

    assert.deepEqual(new Set(view.indexes.map(x => x.key.conversationId)), new Set(['mixed', 'takeout', 'active', 'stale']));
    assert.equal(view.indexes.find(x => x.key.conversationId === 'mixed')?.title, 'Authoritative title');
    assert.equal(view.indexes.find(x => x.key.conversationId === 'takeout')?.titleSource, 'derived');

    const stored = await listIndexes(accountId);
    assert.deepEqual(new Set(stored.map(x => x.key.conversationId)), new Set(['mixed', 'takeout', 'active', 'stale']));
    for (const row of stored) {
        assert.equal('hasTakeoutImport' in row, false);
        assert.equal('isTakeoutOnly' in row, false);
    }
});
});

__suiteDescribe("conversation_index_fixture", () => {
test('canonical factory produces legal independent indexes and never shares override keys', () => {
    const key = { conversationId: 'independent' };
    const first = makeConversationIndex({ key, title: 'A', updatedAt: 100 });
    const second = makeConversationIndex({ key, title: 'B' });
    assert.deepEqual(restoreConversationIndex(first), first);
    first.key.conversationId = 'mutated';
    first.title = 'Changed';
    assert.equal(second.key.conversationId, 'independent');
    assert.equal(second.title, 'B');
    assert.equal(key.conversationId, 'independent');
    assert.equal(second.updatedAt, undefined);
    const defaultIndex = makeConversationIndex();
    defaultIndex.key.accountId = 'mutated';
    assert.notEqual(makeConversationIndex().key.accountId, 'mutated');
});
});

__suiteDescribe("conversation_order", () => {
test__s7('index ordering prioritizes authored activity over creation and leaves unknown times after known times', () => {
    const records = [makeConversationIndex({ key: { conversationId: 'recent' }, title: 'Recent', createdAt: 5000 }), indexFixture({ id: 'unknown-time', title: 'Unknown', lastSeen: 99999 }),
        makeConversationIndex({ key: { conversationId: 'revived' }, title: 'Revived', createdAt: 1000, updatedAt: 6000 })];
    assert.deepEqual(records.sort(compareConversationIndexes).map(item => item.key.conversationId), ['revived', 'recent', 'unknown-time']);
    assert.equal(indexActivityTime(records[2]), undefined);
});
test__s7('index ordering preserves established array order on ties including missing activity', () => {
    const records = ['third', 'first', 'second'].map(id => makeConversationIndex({ key: { conversationId: id }, title: id }));
    assert.deepEqual(records.sort(compareConversationIndexes).map(item => item.key.conversationId), ['third', 'first', 'second']);
    assert.equal(compareConversationIndexes({ ...records[0], updatedAt: 0 }, records[1]), -1);
});
test__s7('reviving an old conversation monotonically advances activity without changing creation', () => {
    const old = makeConversationIndex({ key: { conversationId: 'revived' }, title: 'Revived', createdAt: 1000, updatedAt: 2000 });
    const newer = mergeConversationIndex(old, makeConversationIndex({ ...old, updatedAt: 5000 }));
    assert.equal(newer.createdAt, 1000);
    assert.equal(newer.updatedAt, 5000);
    assert.equal(mergeConversationIndex(newer, old).updatedAt, 5000);
});
test__s7('list parsing provides strict indexes and independent source times, with no invented counts or aliases', () => {
    const wire = geminiListGen('G_CONVERSATION_ORDER_01');
    const index = parseList(wire).conversations[0];
    assert.equal(index.updatedAt, 1700000000000);
    assert.equal(index.createdAt, undefined);
    assert.equal(index.messageCount, undefined, 'RPC turn count is not a message count');
    assert.equal(Reflect.get(index ?? {}, 'cloudAvailability'), undefined);
    for (const key of ['timestamp', 'chatTime', 'titles', 'messages', 'lastSeen']) assert.equal(Object.hasOwn(index, key), false);
});


test__s7('only the canonical source update version drives activity', () => {
    const list = makeConversationIndex({ key: { conversationId: 'chat' }, updatedAt: 100 });
    assert.equal(indexActivityTime(list), 100);
    assert.equal(indexActivityTime({ ...list, updatedAt: 300 }), 300);
    assert.equal(indexActivityTime({ ...list, updatedAt: undefined }), undefined);
    assert.equal(mergeConversationIndex(list, { ...list, updatedAt: 50 }).updatedAt, 100);
});
});

__suiteDescribe("touch_timestamp_authority", () => {
const accountId = '10000000-0000-4000-8000-000000000001';
const key = { accountId, conversationId: 'chat' };
useIndexStorage();

test('a local observation preserves server timestamp on an existing index', async () => {
    await ingestIndexes(accountId, [{ conversationId: 'chat', fields: { updatedAt: 1700000000000 } }]);
    await ingestIndexes(accountId, [{ conversationId: 'chat', fields: {} }]);
    const index = await getIndex(key); assert.equal(index?.updatedAt, 1700000000000);
    assert.equal(Object.hasOwn(index!, 'sidebarIndex'), false); assert.equal(Object.hasOwn(index!, 'lastSeen'), false);
});
test('an unknown observed conversation creates an index without client timestamp', async () => {
    await ingestIndexes(accountId, [{ conversationId: 'chat', fields: {} }]);
    assert.deepEqual(await getIndex(key), { key });
});
test('an observation without reliable page evidence never moves Recent Coverage', async () => {
    const coverage = { range: { head: { id: 'head', time: 20 }, tail: { id: 'tail', time: 10 } } };
    await updateCoverageAtomically(accountId, 'recent', () => ({ next: coverage, result: undefined }));
    await ingestIndexes(accountId, [{ conversationId: 'chat', fields: { updatedAt: 30 } }]);
    assert.deepEqual(await getCoverage(accountId, 'recent'), coverage);
});
});

__suiteDescribe("title_merge_characterization", () => {
test__s9('index title authority survives weaker observations and adopts same-tier renames', () => {
    for (const [strong, weak] of [['user', 'provider'], ['provider', 'derived']] as const) {
        const a = makeConversationIndex({ key: { conversationId: 'title-order' }, title: 'Authority', titleSource: strong });
        const b = makeConversationIndex({ key: a.key, title: 'Fallback', titleSource: weak });
        for (const [old, incoming] of [[a, b], [b, a]]) {
            const result = mergeConversationIndex(old, incoming);
            assert.equal(result.title, 'Authority');
            assert.equal(result.titleSource, strong, 'the surviving title and authority source must stay consistent');
        }
        const renamed = mergeConversationIndex(a, { ...a, title: 'Renamed authority' });
        assert.equal(renamed.title, 'Renamed authority');
        assert.equal(renamed.titleSource, strong);
    }
});

test__s9('placeholder and malformed provenance are handled before index merging', () => {
    const old = makeConversationIndex({ key: { conversationId: 'empty-title' }, title: 'Stored RPC title', titleSource: 'provider' });
    for (const title of ['', '   ', '\t\n', 'Google Gemini']) {
        const incoming = parseGeminiIndexObservation({ id: old.key.conversationId, title, titleSource: 'rpc' }, 'detail');
        assert.equal(incoming.fields.title, undefined);
        assert.equal(incoming.fields.titleSource, undefined);
        assert.equal(mergeConversationIndex(old, { key: old.key, ...incoming.fields }).title, old.title);
    }
});

test__s9('index merging preserves independent times, sampled counts, and import history without extension fields', () => {
    const old = indexFixture({ id: 'merge-fields', title: 'RPC title', titleSource: 'rpc', updatedAt: 5000, createdAt: 2000, messageCount: 8 });
    const incoming = restoreConversationIndex(historicalFixture({ id: old.key.conversationId, title: 'Offline title', titleSource: 'takeout',
        messages: [{ role: 'user', content: 'Question' }, { role: 'model', content: 'Answer' }] }).conversation.index);
    const result = mergeConversationIndex(old, incoming);
    assert.equal(result.updatedAt, 5000);
    assert.equal(result.createdAt, 2000, 'Takeout message times cannot replace metadata creation');
    assert.equal(Reflect.get(result ?? {}, 'messageCount'), undefined);
    assert.equal(Reflect.get(result ?? {}, 'hasTakeoutImport'), undefined);
    assert.deepEqual(result, old, 'weaker imported metadata does not change the canonical index');
    for (const field of ['messages', 'turns', 'lastSeen', 'extensionData', 'timestamp', 'titles']) assert.equal(Object.hasOwn(result, field), false);
});
});

__suiteDescribe("title_source_completeness", () => {
test('canonical title authority gives every declared source a numeric rank', () => {
    for (const [source, rank] of Object.entries(TITLE_AUTHORITY_RANK)) {
        assert.equal(typeof rank, 'number', source);
        assert.equal(titleAuthorityRank(source), rank);
    }
    assert.equal(titleAuthorityRank('unknown'), 0);
});

test('canonical title authority ranks are distinct and ordered by source', () => {
    assert.deepEqual(TITLE_AUTHORITY_RANK, { user: 3, provider: 2, derived: 1 });
});

test('detail title outranks passive sniff in canonical authority', () => {
    assert.ok(TITLE_AUTHORITY_RANK.provider > TITLE_AUTHORITY_RANK.derived);
    assert.deepEqual(resolveTitle([
        { source: "derived", value: 'Passive title' },
        { source: "provider", value: 'Detailed title' },
    ])?.value, 'Detailed title');
});
});
