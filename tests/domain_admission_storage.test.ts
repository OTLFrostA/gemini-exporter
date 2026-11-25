import { describe as __suiteDescribe } from 'node:test';
import { getCoverage } from "../src/l3a/storageService.js";
import { getIndex } from "../src/l3a/storageService.js";
import { getDetail } from "../src/l3a/storageService.js";
import { updateIndexesAtomically } from "../src/l3a/storageService.js";
import { admitFixture } from "./helpers/admitFixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexStorage } from "./helpers/indexStorage.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import { ingestIndexes } from "../src/l2/ingestion.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { storageIdentity } from "./helpers/admitFixture.js";
import { readFixture } from "./helpers/admitFixture.js";
import { listIndexes as getConversations } from "../src/l3a/storageService.js";
import { type DomainFixture } from "./helpers/domainFixture.js";
import test__s1 from "node:test";
import { ACCOUNT_UUID } from "./helpers/accountIds.js";
import { OTHER_ACCOUNT_UUID } from "./helpers/accountIds.js";
import { ingestDeletedConversation } from "../src/l2/ingestion.js";
import { listIndexes } from "../src/l3a/storageService.js";
import { putExportRecord } from "../src/l3a/storageService.js";
import { getExportRecord } from "../src/l3a/storageService.js";
import { mergeConversationIndex } from "../src/l2/conversationIndex.js";
import { indexActivityTime } from "../src/l2/conversationIndex.js";
import { makeConversationIndex } from "./helpers/conversationIndexFixture.js";
import test__s2 from "node:test";
import { type PageObservation } from "../src/l2/pageObservation.js";
import CoverageAdmission from "../src/l2/coverageAdmission.js";
import { clearLocalScanRecords } from "../src/application/localCleanup.js";
import { clearStoredAccountScanRecords } from "../src/l3a/storageService.js";
import { updateCoverageAtomically } from "../src/l3a/storageService.js";
import { putIndexes } from "../src/l3a/storageService.js";
import test__s3 from "node:test";
import { getCoverage as getCoverage__s3 } from "../src/l2/coverageAdmission.js";
import { recordPageCoverage } from "../src/l2/coverageAdmission.js";
import { hasTrustedBoundary } from "../src/l2/coverageAdmission.js";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { restoreDomainSnapshot } from "../src/l2/runtimeValidation.js";
import { createSourceResourceContext } from "../src/l1/resources/sourceResources.js";
import { type DomainConversationWithDetail } from "../src/l2/conversation.js";
import test__s5 from "node:test";
import { ACCOUNT_UUID as ACCOUNT_UUID__s5 } from "./helpers/accountRuntime.js";
import { parseGeminiIndexObservation } from "../src/l1/parsers/gemini/parseIndexObservation.js";
import { listGen as geminiListGen } from "./fixtures/providers/gemini.js";
import { parseList } from "../src/l1/parsers/gemini/rpc/parseList.js";

__suiteDescribe("domain_admission_storage", () => {
const account = fixtureAccount();
function snapshot(text: string, status: 'complete' | 'partial' | 'unknown', savedAt?: number, image = false): DomainFixture {
    const key = fixtureKey('admission-storage');
    return { account, diagnostics: [], resourceHints: {}, acquisitionHints: image ? { image: { dataBase64: 'AQID' } } : {},
        conversation: validateParserDomain({ index: { key, title: 'Source title', titleSource: 'provider' }, detail: {
            key, ...(savedAt !== undefined ? { savedAt } : {}), quality: { status },
            assets: image ? [{ id: 'image', kind: 'image' }] : [],
            messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text }] },
                ...(image ? [{ type: 'image' as const, assetId: 'image' }] : [])] }],
        } }) };
}

test('admission replaces complete body and assets together, preserves complete against partial, and keeps bytes outside Domain', async () => {
    const env = indexStorage(), identity = storageIdentity('gemini', account.id, 'admission-storage');
    try {
        const original = snapshot('A B C D', 'complete', 10, true);
        await admitFixture(account.id, original);
        assert.ok(!JSON.stringify((await readFixture(identity))!.conversation).includes('dataBase64'));
        await ingestIndexes(account.id, [{ conversationId: original.conversation.index.key.conversationId, fields: { title: 'Renamed', titleSource: 'user', updatedAt: 30 } }]);
        assert.equal((await readFixture(identity))!.conversation.detail.savedAt, 10, 'Index-only observation cannot advance the body version');
        const partial = { ...snapshot('C D E', 'partial', 30, true), acquisitionHints: { image: { dataBase64: 'BAUG' } } };
        const rejected = await admitFixture(account.id, partial);
        assert.deepEqual(rejected.conversation.detail, original.conversation.detail);
        assert.equal(rejected.conversation.index.title, 'Renamed');
        const next = snapshot('A B edited', 'complete', 20);
        await admitFixture(account.id, next);
        assert.deepEqual((await readFixture(identity))!.conversation.detail, next.conversation.detail);
        await admitFixture(account.id, snapshot('stale longer complete body', 'complete', 15));
        assert.deepEqual((await readFixture(identity))!.conversation.detail, next.conversation.detail);
    } finally { env.restore(); }
});

test('admission replaces incomplete snapshots by order and rejects mismatched ownership and failed catalog commits', async () => {
    const env = indexStorage(), identity = storageIdentity('gemini', account.id, 'admission-storage');
    try {
        await admitFixture(account.id, snapshot('long unknown body', 'unknown'));
        const next = snapshot('short', 'partial', 20);
        await admitFixture(account.id, next);
        assert.deepEqual((await readFixture(identity))!.conversation.detail, next.conversation.detail);
        await assert.rejects(admitFixture('10000000-0000-4000-8000-000000000002', next), /account\/provider mismatch/);
        assert.equal((await getConversations('10000000-0000-4000-8000-000000000002')).length, 0);
        env.fail('indexes');
        const failed = snapshot('uncommitted catalog', 'complete', 30); failed.conversation.index.updatedAt = 30;
        await assert.rejects(admitFixture(account.id, failed), /write failed/);
        env.fail();
        assert.equal((await getConversations(account.id))[0].key.accountId, account.id);
    } finally { env.restore(); }
});

test('canonical detail entry binds Registry UUID and shares Index and body admission rules', async () => {
    const env = indexStorage(), key = fixtureKey('canonical-detail');
    try {
        const incoming = snapshot('complete body', 'complete', 10);
        const { key: _, ...detail } = incoming.conversation.detail;
        await ingestDetail(account.id, key.conversationId, detail, { title: 'Explicit title', titleSource: 'user', updatedAt: 10 });
        await ingestDetail(account.id, key.conversationId, { ...detail, quality: { status: 'partial' }, savedAt: 20 },
            { title: 'Provider title', titleSource: 'provider', updatedAt: 20 });
        const stored = await readFixture(storageIdentity('gemini', account.id, key.conversationId));
        assert.deepEqual(stored!.conversation.detail, { ...detail, key });
        const index = (await getConversations(account.id)).find(row => row.key.conversationId === key.conversationId)!;
        assert.equal(index.title, 'Explicit title');
        assert.equal(index.updatedAt, 20);
        await assert.rejects(ingestDetail('10000000-0000-4000-8000-000000000099', key.conversationId, detail), /account does not exist/);
    } finally { env.restore(); }
});


test('default retains source Index facts without establishing trusted account coverage', async () => {
    const env = indexStorage(), accountId = '10000000-0000-4000-8000-000000000003';
    const key = { accountId, conversationId: 'default-fact' };
    try {
        await ingestIndexes(accountId, [{ conversationId: key.conversationId, fields: { updatedAt: 100 } }], {
            streamId: 'recent', requestCursor: null, nextCursor: null,
            requestedAt: 1, requestKnown: true, valid: true, ordered: true, keys: [{ id: key.conversationId, time: 100 }],
        });
        assert.deepEqual(await getConversations(accountId), [{ key, updatedAt: 100 }]);
        assert.equal(await getCoverage(accountId, 'recent'), null);
    } finally { env.restore(); }
});

test('ingestDetail reports admitted candidate and material change independently after commit', async () => {
    const env = indexStorage(), key = fixtureKey('changed-semantics');
    try {
        const body = { ...snapshot('first', 'complete', 10).conversation.detail };
        const { key: _unused, ...facts } = body;
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, facts), { accepted: true, changed: true, indexAdded: true });
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, { ...facts }), { accepted: true, changed: false });
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, { ...facts, savedAt: 11 }),
            { accepted: true, changed: false }, 'savedAt-only progress does not trigger Live Save');
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, { ...facts, savedAt: 9 }),
            { accepted: true, changed: false }, 'equal material facts permit candidate resource reuse');
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, { ...facts, savedAt: 12, messages: [] }),
            { accepted: true, changed: true }, 'a newer complete snapshot can remove messages');
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, { ...facts, savedAt: 11 }),
            { accepted: false, changed: false }, 'older different material facts are rejected');
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, { ...facts, savedAt: 13 }),
            { accepted: true, changed: true }, 'newer full snapshot can replace an older one');
        assert.equal((await readFixture(storageIdentity('gemini', account.id, key.conversationId)))!.conversation.detail.savedAt, 13);
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, { ...facts, quality: { status: 'partial' }, savedAt: 14 },
            { title: 'New index', titleSource: 'provider' }), { accepted: false, changed: false });
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, { ...facts, savedAt: 14,
            messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'edited' }] }] }] }), { accepted: true, changed: true });
    } finally { env.restore(); }
});

test('one failed Detail write rolls back its freshly created Index', async () => {
    const env = indexStorage(), key = fixtureKey('atomic-rollback');
    try {
        env.fail('details');
        const { key: _unused, ...facts } = snapshot('new body', 'complete', 10).conversation.detail;
        await assert.rejects(ingestDetail(account.id, key.conversationId, facts), /write failed/);
        env.fail();
        assert.equal(await getIndex(key), null);
        assert.equal(await getDetail(key), null);
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, facts), { accepted: true, changed: true, indexAdded: true });
        assert.ok(await getIndex(key));
        assert.ok(await getDetail(key));
    } finally { env.restore(); }
});

test('concurrent Index admissions preserve the highest trusted updatedAt', async () => {
    const env = indexStorage(), key = fixtureKey('atomic-index');
    try {
        await Promise.all(Array.from({ length: 20 }, (_, updatedAt) =>
            ingestIndexes(account.id, [{ conversationId: key.conversationId, fields: { updatedAt } }])));
        assert.equal((await getIndex(key))?.updatedAt, 19);
    } finally { env.restore(); }
});

test('Index atomic update accepts only changed subset and zero-write no-op admissions', async () => {
    const env = indexStorage(), one = fixtureKey('subset-one'), two = fixtureKey('subset-two');
    try {
        await ingestIndexes(account.id, [
            { conversationId: one.conversationId, fields: { updatedAt: 10 } },
            { conversationId: two.conversationId, fields: { updatedAt: 20 } },
        ]);
        const beforeNoop = env.writes();
        await ingestIndexes(account.id, [
            { conversationId: one.conversationId, fields: { updatedAt: 10 } },
            { conversationId: two.conversationId, fields: { updatedAt: 20 } },
        ]);
        assert.equal(env.writes(), beforeNoop, 'L2 chooses an empty write subset');
        await updateIndexesAtomically([one, two], rows => {
            assert.equal(rows[0]?.updatedAt, 10);
            assert.equal(rows[1]?.updatedAt, 20);
            return [{ ...rows[1]!, updatedAt: 30 }];
        });
        assert.equal((await getIndex(one))?.updatedAt, 10);
        assert.equal((await getIndex(two))?.updatedAt, 30);
    } finally { env.restore(); }
});

test('Index atomic update rejects duplicate/foreign decision keys and rolls back partial writes', async () => {
    const env = indexStorage(), one = fixtureKey('subset-first'), two = fixtureKey('subset-second');
    try {
        await ingestIndexes(account.id, [
            { conversationId: one.conversationId, fields: { updatedAt: 10 } },
            { conversationId: two.conversationId, fields: { updatedAt: 20 } },
        ]);
        await assert.rejects(updateIndexesAtomically([one, one], () => []), /Duplicate Index admission key/);
        await assert.rejects(updateIndexesAtomically([one, two], old => [
            { ...old[0]!, updatedAt: 999 },
            { key: fixtureKey('foreign'), updatedAt: 300 },
        ]), /Index decision key mismatch/);
        assert.equal((await getIndex(one))?.updatedAt, 10);
        await assert.rejects(updateIndexesAtomically([one, two], old => [
            { ...old[0]!, updatedAt: 999 }, { ...old[0]!, updatedAt: 888 },
        ]), /Duplicate Index decision key/);
        assert.equal((await getIndex(one))?.updatedAt, 10);
        assert.equal((await getIndex(two))?.updatedAt, 20);
    } finally { env.restore(); }
});

test('Detail admission compares semantic JSON facts, not object property insertion order', async () => {
    const env = indexStorage(), key = fixtureKey('same-facts-key-order');
    try {
        const facts = { messages: [{ role: 'assistant' as const, content: [] }], assets: [{ id: 'a', kind: 'image' as const }],
            quality: { status: 'complete' as const }, savedAt: 10 };
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, facts), { accepted: true, changed: true, indexAdded: true });
        const writes = env.writes();
        const equivalent = { quality: { status: 'complete' as const }, assets: [{ kind: 'image' as const, id: 'a' }],
            messages: [{ content: [], role: 'assistant' as const }], savedAt: 10 };
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, equivalent),
            { accepted: true, changed: false });
        assert.equal(env.writes(), writes, 'a duplicate material snapshot must not write again');
        const versionOnly = { ...equivalent, savedAt: 11 };
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, versionOnly),
            { accepted: true, changed: false });
        assert.equal((await getDetail(key))?.savedAt, 11);
    } finally { env.restore(); }
});

test('rejected partial Detail never grafts its resources onto a retained complete snapshot', async () => {
    const env = indexStorage(), key = fixtureKey('rejected-resource-graph');
    try {
        const original = { savedAt: 10, quality: { status: 'complete' as const },
            assets: [{ id: 'old-image', kind: 'image' as const }],
            messages: [{ role: 'assistant' as const, content: [{ type: 'image' as const, assetId: 'old-image' }] }] };
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, original,
            { title: 'Original', titleSource: 'provider' }), { accepted: true, changed: true, indexAdded: true });
        const partial = { savedAt: 20, quality: { status: 'partial' as const },
            assets: [{ id: 'untrusted-image', kind: 'image' as const }],
            messages: [{ role: 'assistant' as const, content: [{ type: 'image' as const, assetId: 'untrusted-image' }] }] };
        assert.deepEqual(await ingestDetail(account.id, key.conversationId, partial,
            { title: 'Refreshed', titleSource: 'provider', updatedAt: 20 }),
            { accepted: false, changed: false });
        assert.deepEqual(await getDetail(key), { ...original, key });
        assert.deepEqual((await getDetail(key))?.assets.map(asset => asset.id), ['old-image']);
        assert.equal((await getIndex(key))?.title, 'Refreshed', 'Index still accepts new metadata');
        assert.equal((await getIndex(key))?.updatedAt, 20);
    } finally { env.restore(); }
});
});

__suiteDescribe("conversation_index_storage", () => {
const key = (id = 'chat', accountId = ACCOUNT_UUID) => ({ accountId, conversationId: id });
const fields = () => ({ title: 'Research', titleSource: 'provider' as const, updatedAt: 50 });
const detail = () => ({ quality: { status: 'complete' as const }, assets: [],
    messages: [{ role: 'user' as const, content: [] }] });
async function index(id = 'chat', accountId = ACCOUNT_UUID) {
    await ingestIndexes(accountId, [{ conversationId: id, fields: fields() }]);
}

test__s1('physical Index roundtrip is exact, detached and account isolated', async () => {
    const env = indexStorage();
    try {
        await index();
        const read = await listIndexes(ACCOUNT_UUID); assert.deepEqual(read, [{ key: key(), ...fields() }]);
        read[0].title = 'External mutation';
        assert.equal((await listIndexes(ACCOUNT_UUID))[0].title, 'Research');
        assert.deepEqual(await listIndexes(OTHER_ACCOUNT_UUID), []);
    } finally { env.restore(); }
});

test__s1('L2 rejects unknown fields and malformed Index facts before writing; duplicate rows use the unique merge', async () => {
    const env = indexStorage();
    try {
        for (const bad of [{ messages: [] }, { timestamp: 5 }, { messageCount: -1 }, { title: 'Missing source' },
            { updatedAt: NaN }, { updatedAt: '5' }, { createdAt: null }, { createdAt: Infinity }, { titleSource: 'rpc' }]) {
            await assert.rejects(ingestIndexes(ACCOUNT_UUID, [{ conversationId: 'bad', fields: bad as never }]));
            assert.deepEqual(await listIndexes(ACCOUNT_UUID), []);
        }
        await ingestIndexes(ACCOUNT_UUID, [{ conversationId: 'chat', fields: fields() },
            { conversationId: 'chat', fields: { updatedAt: 60 } }]);
        assert.deepEqual(await listIndexes(ACCOUNT_UUID), [{ key: key(), ...fields(), updatedAt: 60 }]);
    } finally { env.restore(); }
});

test__s1('atomic Index patches preserve title authority and source-authored times', async () => {
    const env = indexStorage();
    try {
        await ingestIndexes(ACCOUNT_UUID, [{ conversationId: 'chat', fields: { title: 'User title', titleSource: 'user', createdAt: 10, updatedAt: 100 } }]);
        await Promise.all([
            ingestIndexes(ACCOUNT_UUID, [{ conversationId: 'chat', fields: { title: 'Provider title', titleSource: 'provider', updatedAt: 300 } }]),
            ingestIndexes(ACCOUNT_UUID, [{ conversationId: 'chat', fields: { createdAt: 5, updatedAt: 200 } }]),
        ]);
        assert.deepEqual(await getIndex(key()), { key: key(), title: 'User title', titleSource: 'user', createdAt: 5, updatedAt: 300 });
    } finally { env.restore(); }
});

test__s1('Detail persists separately and Index-only observations cannot replace the body', async () => {
    const env = indexStorage();
    try {
        await ingestDetail(ACCOUNT_UUID, 'chat', detail(), fields());
        const before = await getDetail(key());
        await ingestIndexes(ACCOUNT_UUID, [{ conversationId: 'chat', fields: { title: 'Renamed', titleSource: 'provider' } }]);
        assert.deepEqual(await getDetail(key()), before);
        assert.equal((await getIndex(key()))?.title, 'Renamed');
        assert.equal(Object.hasOwn((await getIndex(key()))!, 'messages'), false);
        await ingestDeletedConversation(ACCOUNT_UUID, 'chat');
        assert.equal(await getDetail(key()), null); assert.equal(await getIndex(key()), null);
    } finally { env.restore(); }
});

test__s1('export delivery records do not manufacture Index or Detail facts', async () => {
    const env = indexStorage();
    try {
        const record = { exportedAt: 10, format: 'markdown' as const, status: 'ok' as const };
        await putExportRecord(key(), record);
        assert.deepEqual(await getExportRecord(key()), record);
        assert.equal(await getIndex(key()), null); assert.equal(await getDetail(key()), null);
    } finally { env.restore(); }
});

test__s1('concurrent Detail imports retain unrelated indexes, title authority and other accounts', async () => {
    const env = indexStorage();
    try {
        await index(); await index('other'); await index('other', OTHER_ACCOUNT_UUID);
        await Promise.all([
            ingestDetail(ACCOUNT_UUID, 'chat', detail(), { title: 'Weaker detail', titleSource: 'derived', updatedAt: 70 }),
            ingestDetail(ACCOUNT_UUID, 'added', detail()),
        ]);
        assert.deepEqual((await listIndexes(ACCOUNT_UUID)).map(i => i.key.conversationId).sort(), ['added', 'chat', 'other']);
        assert.equal((await getIndex(key()))?.title, 'Research');
        assert.equal((await getIndex(key()))?.updatedAt, 70);
        assert.equal((await getIndex(key('other', OTHER_ACCOUNT_UUID)))?.title, 'Research');
        const writes = env.writes(); await ingestIndexes(ACCOUNT_UUID, []); assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});

test__s1('Index activity belongs to source metadata and never introduces cloud availability fields', () => {
    const old = makeConversationIndex({ key: key(), ...fields(), createdAt: 10 });
    const incoming = makeConversationIndex({ key: key(), title: undefined, titleSource: undefined, updatedAt: 300 });
    const merged = mergeConversationIndex(old, incoming);
    assert.equal(indexActivityTime(merged), 300); assert.equal(merged.createdAt, 10);
    assert.equal(Object.hasOwn(merged, 'cloudAvailability'), false);
});

test__s1('export chatTime is an export baseline and cannot poison Index.updatedAt', async () => {
    const env = indexStorage();
    try {
        await index(); await putExportRecord(key(), { format: 'markdown', status: 'ok', exportedAt: 20, chatTime: 999999 });
        assert.equal((await getIndex(key()))?.updatedAt, 50);
        assert.equal((await getExportRecord(key()))?.chatTime, 999999);
    } finally { env.restore(); }
});

test__s1('confirmed deletion removes facts; only newly observed facts can recreate a minimal Index', async () => {
    const env = indexStorage();
    try {
        await ingestDetail(ACCOUNT_UUID, 'chat', detail(), fields());
        await index('chat', OTHER_ACCOUNT_UUID);
        await ingestDeletedConversation(ACCOUNT_UUID, 'chat');
        assert.equal(await getDetail(key()), null); assert.equal(await getIndex(key()), null);
        env.fail('indexes'); await assert.rejects(index(), /write failed/); env.fail();
        assert.equal(await getIndex(key()), null);
        await index();
        assert.equal((await getIndex(key()))?.title, 'Research'); assert.equal(await getDetail(key()), null);
        assert.ok(await getIndex(key('chat', OTHER_ACCOUNT_UUID)));
        assert.equal(Object.hasOwn((await getIndex(key()))!, 'cloudAvailability'), false);
    } finally { env.restore(); }
});

test__s1('confirmed L2 deletion clears only the named conversation Index, Detail and ExportRecord', async () => {
    const env = indexStorage(), target = key('delete-confirmed'), other = key('delete-confirmed', OTHER_ACCOUNT_UUID);
    try {
        const record = { format: 'markdown' as const, status: 'ok' as const, exportedAt: 100 };
        await ingestDetail(ACCOUNT_UUID, target.conversationId, detail());
        await ingestDetail(OTHER_ACCOUNT_UUID, other.conversationId, detail());
        await putExportRecord(target, record);
        await putExportRecord(other, record);
        await ingestDeletedConversation(ACCOUNT_UUID, target.conversationId);
        assert.equal(await getIndex(target), null);
        assert.equal(await getDetail(target), null);
        assert.equal(await getExportRecord(target), null);
        assert.ok(await getIndex(other)); assert.ok(await getDetail(other));
        assert.deepEqual(await getExportRecord(other), record);
        await ingestDeletedConversation(ACCOUNT_UUID, target.conversationId);
        assert.equal(await getIndex(target), null, 'repeated verified deletion remains idempotent');
    } finally { env.restore(); }
});
});

__suiteDescribe("coverage_atomic_admission", () => {
const accountId = fixtureAccount().id;
const otherId = fixtureAccount('chatgpt').id;
const baseline = { range: { head: { id: 'old100', time: 100 }, tail: { id: 'old70', time: 70 } } };
function seedCoverage(accountId: string, stream: string, value: typeof baseline): Promise<void> {
    return updateCoverageAtomically(accountId, stream, () => ({ next: value, result: undefined }));
}
function page(times: number[], requestCursor: string | null, nextCursor: string | null): PageObservation {
    return { providerId: 'gemini', accountId, streamId: 'recent',
        requestCursor, nextCursor, requestedAt: 1, requestKnown: true, valid: true, ordered: true,
        keys: times.map(time => ({ id: 'id' + time, time })) };
}

test__s2('Coverage atomic callback reads the latest row and writes only an explicit next value', async () => {
    const env = indexStorage();
    try {
        assert.equal(await updateCoverageAtomically(accountId, 'recent', current => {
            assert.equal(current, null);
            return { next: baseline, result: 'first' };
        }), 'first');
        assert.deepEqual(await getCoverage(accountId, 'recent'), baseline);
        const beforeNoop = env.writes();
        assert.equal(await updateCoverageAtomically(accountId, 'recent', current => {
            assert.deepEqual(current, baseline);
            return { result: 'no-op' };
        }), 'no-op');
        assert.equal(env.writes(), beforeNoop);
        await assert.rejects(updateCoverageAtomically(accountId, 'recent', () => {
            throw new Error('invalid source evidence');
        }), /invalid source evidence/);
        assert.deepEqual(await getCoverage(accountId, 'recent'), baseline);
    } finally { env.restore(); }
});

test__s2('Scan cleanup deletes current Account Index, streams and ExportRecords while preserving other accounts', async () => {
    const env = indexStorage();
    try {
        const key = { accountId, conversationId: 'unchanged' };
        const otherKey = { accountId: otherId, conversationId: key.conversationId };
        const otherIndex = { key: otherKey, updatedAt: 20 };
        await putIndexes([{ key, updatedAt: 10 }, otherIndex]);
        await ingestDetail(otherId, otherKey.conversationId, { quality: { status: 'complete' }, assets: [],
            messages: [{ role: 'user', content: [] }] });
        const otherDetail = await getDetail(otherKey);
        assert.ok(otherDetail);
        await putExportRecord(key, { status: 'ok', format: 'markdown', exportedAt: 10, chatTime: 10 });
        await seedCoverage(accountId, 'recent', baseline);
        await seedCoverage(accountId, 'pinned', baseline);
        await seedCoverage(otherId, 'recent', baseline);
        await clearStoredAccountScanRecords(accountId);
        assert.equal(await getCoverage(accountId, 'recent'), null);
        assert.equal(await getCoverage(accountId, 'pinned'), null);
        assert.deepEqual(await getCoverage(otherId, 'recent'), baseline);
        assert.deepEqual(await getIndex(otherKey), otherIndex);
        assert.deepEqual(await getDetail(otherKey), otherDetail);
        assert.equal(await getIndex(key), null);
        assert.equal(await getExportRecord(key), null);
    } finally { env.restore(); }
});

test__s2('Clearing Coverage invalidates previous in-memory page chain; a late terminal cannot revive it', async () => {
    const env = indexStorage();
    try {
        await CoverageAdmission.recordPageCoverage(accountId, page([120, 110], null, 'tail'));
        assert.equal((await getCoverage(accountId, 'recent'))?.range, null);
        await clearStoredAccountScanRecords(accountId);
        assert.equal(await getCoverage(accountId, 'recent'), null);
        assert.equal(await CoverageAdmission.recordPageCoverage(accountId, page([90], 'tail', null)), undefined);
        assert.equal((await getCoverage(accountId, 'recent'))?.range, null,
            'the stale head was invalidated; a fresh head is required');
    } finally { env.restore(); }
});

test__s2('clearLocalScanRecords purges in-memory CoverageSession even if another realm re-seeds Coverage before next page', async () => {
    const env = indexStorage();
    try {
        await CoverageAdmission.recordPageCoverage(accountId, page([120, 110], null, 'tail'));
        await clearLocalScanRecords(accountId);
        // Simulate Background Worker writing a non-null Coverage row before this realm runs again
        await seedCoverage(accountId, 'recent', baseline);
        await CoverageAdmission.recordPageCoverage(accountId, page([90], 'tail', null));
        assert.deepEqual(await getCoverage(accountId, 'recent'), baseline,
            'pre-clear tail cursor cannot join pre-clear head across a concurrent realm re-seed');
    } finally { env.restore(); }
});

test__s2('Cleared frozen Coverage cannot authorize early stop or resurrect a deleted range', async () => {
    const env = indexStorage();
    try {
        await seedCoverage(accountId, 'recent', baseline);
        const head = page([130, 110], null, 'tail');
        await CoverageAdmission.recordPageCoverage(accountId, head);
        await CoverageAdmission.recordPageCoverage(accountId, page([95], 'tail', 'more'));
        const { providerId: _provider, accountId: _account, ...scanHead } = head;
        assert.equal(await CoverageAdmission.hasTrustedBoundary(accountId, baseline, scanHead), true);
        await clearStoredAccountScanRecords(accountId);
        assert.equal(await CoverageAdmission.hasTrustedBoundary(accountId, baseline, scanHead), false);
        assert.equal(await getCoverage(accountId, 'recent'), null);
    } finally { env.restore(); }
});

test__s2('Failed Coverage commit does not publish a partial in-memory cursor chain', async () => {
    const env = indexStorage();
    try {
        env.fail('coverage');
        await assert.rejects(CoverageAdmission.recordPageCoverage(accountId, page([120], null, 'tail')), /write failed/);
        env.fail();
        assert.equal(await getCoverage(accountId, 'recent'), null);
        await CoverageAdmission.recordPageCoverage(accountId, page([100], 'tail', null));
        assert.equal((await getCoverage(accountId, 'recent'))?.range, null);
    } finally { env.restore(); }
});

test__s2('a disjoint committed replacement cannot authorize an early stop from an obsolete baseline', async () => {
    const env = indexStorage();
    try {
        await seedCoverage(accountId, 'recent', baseline);
        const head = page([130, 110], null, 'tail');
        await CoverageAdmission.recordPageCoverage(accountId, head);
        await CoverageAdmission.recordPageCoverage(accountId, page([95], 'tail', 'more'));
        const replacement = { range: { head: { id: 'new500', time: 500 }, tail: { id: 'new400', time: 400 } } };
        await seedCoverage(accountId, 'recent', replacement);
        const { providerId: _provider, accountId: _account, ...scanHead } = head;
        assert.equal(await CoverageAdmission.hasTrustedBoundary(accountId, baseline, scanHead), false);
        assert.deepEqual(await getCoverage(accountId, 'recent'), replacement);
    } finally { env.restore(); }
});

test__s2('L2 accepts an empty provider-limit terminal after a committed Index page', async () => {
    const env = indexStorage();
    try {
        const identity = 'source-verified';
        const streamId = 'recent-limit';
        await ingestIndexes(accountId, [{ conversationId: identity, fields: { updatedAt: 100 } }], {
            streamId, requestCursor: null, nextCursor: 'limit', requestedAt: 1,
            requestKnown: true, valid: true, ordered: true, keys: [{ id: identity, time: 100 }],
        });
        assert.deepEqual((await getCoverage(accountId, streamId))?.range, null);
        await ingestIndexes(accountId, [], {
            streamId, requestCursor: 'limit', nextCursor: null, requestedAt: 2,
            requestKnown: true, valid: true, ordered: true, keys: [], terminal: 'provider_limit',
        });
        assert.deepEqual((await getCoverage(accountId, streamId))?.range, {
            head: { id: identity, time: 100 }, tail: { id: identity, time: 100 },
        });
        assert.ok(await getIndex({ accountId, conversationId: identity }));
    } finally { env.restore(); }
});

test__s2('a genuinely empty trusted list establishes no fictitious range or Index', async () => {
    const env = indexStorage();
    try {
        await ingestIndexes(accountId, [], {
            streamId: 'recent-empty', requestCursor: null, nextCursor: null, requestedAt: 1,
            requestKnown: true, valid: true, ordered: true, keys: [],
        });
        assert.deepEqual((await getCoverage(accountId, 'recent-empty'))?.range, null);
    } finally { env.restore(); }
});
});

__suiteDescribe("watermark_checkpoint", () => {
const accountId = fixtureAccount().id;
let time = 0;
function page(cursor: string | null = null, next: string | null = null, values = [100, 70]): PageObservation {
    return { accountId, providerId: 'gemini', streamId: 'recent', requestCursor: cursor, nextCursor: next,
        requestedAt: ++time, requestKnown: true, valid: true, ordered: true, keys: values.map(t => ({ id: 'id' + t, time: t })) };
}
test__s3('Coverage exposes only committed range and callers receive detached baselines', async () => {
    const env = indexStorage();
    try {
        assert.equal(await getCoverage__s3(accountId,'recent'),null);
        await recordPageCoverage(accountId,page());
        const frozen = (await getCoverage__s3(accountId,'recent'))!;
        assert.deepEqual(Object.keys(frozen),['range']);
        frozen.range!.head.time = 999;
        assert.equal((await getCoverage__s3(accountId,'recent'))!.range!.head.time,100);
        assert.deepEqual(env.local,{},'cursor/run/checkpoint state never enters Chrome Settings');
    } finally { env.restore(); }
});
test__s3('a fresh partial chain cannot establish range, terminal proof can, and retries preserve prior range', async () => {
    const env = indexStorage();
    try {
        await recordPageCoverage(accountId, page(null, 'limit'));
        assert.deepEqual(await getCoverage__s3(accountId, 'recent'), { range: null });
        await recordPageCoverage(accountId, { ...page('limit', null, []), terminal: 'provider_limit' });
        const frozen = (await getCoverage__s3(accountId, 'recent'))!;
        assert.equal(frozen.range?.head.time, 100);
        const head = page(null, 'bridge', [120, 110]);
        await recordPageCoverage(accountId, head);
        assert.deepEqual(await getCoverage__s3(accountId, 'recent'), frozen);
        assert.equal(await hasTrustedBoundary(accountId, frozen, head), false);
        await recordPageCoverage(accountId, page('bridge', 'unread', [105, 85]));
        assert.equal(await hasTrustedBoundary(accountId, frozen, head), true);
        assert.equal((await getCoverage__s3(accountId, 'recent'))?.range?.head.time, 120);
        assert.equal(frozen.range?.head.time, 100, 'frozen baseline is detached');
        assert.equal(JSON.stringify(env.local).includes('unread'), false);
    } finally { env.restore(); }
});
test__s3('coverage storage is isolated by account and stream and propagates commit failures', async () => {
    const env = indexStorage();
    try {
        await recordPageCoverage(accountId, { ...page(), streamId: 'pinned' });
        assert.equal(await getCoverage__s3(accountId, 'recent'), null);
        assert.equal(await getCoverage__s3('10000000-0000-4000-8000-000000000002', 'pinned'), null);
        env.fail('coverage');
        await assert.rejects(recordPageCoverage(accountId, page()), /write failed/);
        assert.equal(await getCoverage__s3(accountId, 'recent'), null);
        await assert.rejects(recordPageCoverage(accountId, { ...page(), accountId: null }), /Registry UUID/);
        await assert.rejects(recordPageCoverage(accountId, page(), () => false), /cancelled/);
    } finally { env.restore(); }
});

test__s3('failed terminal commit cannot become reusable proof in a later partial observation', async () => {
    const env = indexStorage();
    try {
        await recordPageCoverage(accountId, page(null, 'end'));
        env.fail('coverage');
        await assert.rejects(recordPageCoverage(accountId, page('end', null, [60, 50])), /write failed/);
        env.fail();
        await recordPageCoverage(accountId, page('unrelated', 'unseen', [40, 30]));
        assert.deepEqual(await getCoverage__s3(accountId, 'recent'), { range: null });
        await recordPageCoverage(accountId, page('end', null, [60, 50]));
        assert.equal((await getCoverage__s3(accountId, 'recent'))!.range!.tail.time, 50);
    } finally { env.restore(); }
});
});

__suiteDescribe("domain_trust_counts", () => {
useIndexStorage();








test('large provider-neutral graphs preserve complete/partial/unknown coverage and real resource bytes', async () => {
    for (const status of ['complete', 'partial', 'unknown'] as const) {
        const builder: DomainConversationWithDetail = { index: { key: fixtureKey(String(`large-${status}`), 'future-provider'),   titleSource: "derived",   title: 'Independent large graph' }, detail: { key: fixtureKey(String(`large-${status}`), 'future-provider'), quality: { status }, assets: [{ id: 'bytes', kind: 'file', sourceUri: 'opaque:original' }], messages: Array.from({ length: 1000 }, (_, index) => ({ id: `message-${index}`, role: 'unknown',
                content: [{ type: 'unknown', sourceType: 'future-block', text: `Preserved ${index}` }], attachmentIds: ['bytes'] })) } };
        const trusted = validateParserDomain(builder);
        assert.equal(restoreDomainSnapshot(trusted).detail.messages.length, 1000);

        const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
        const resources = createSourceResourceContext();
        const retained = bytes.slice();
        resources.retain(builder.index.key, 'bytes', async () => ({ bytes: retained.slice() }));
        await admitFixture(fixtureAccount('future-provider').id, { account: fixtureAccount('future-provider'), conversation: trusted, resourceHints: {}, acquisitionHints: {}, diagnostics: [] });
        bytes[0] = 99;
        const read = await readFixture(storageIdentity('future-provider', fixtureAccount('future-provider').id, builder.index.key.conversationId));
        assert.ok(read); const recoveredBytes = (await resources.acquire(read.conversation.index.key, read.conversation.detail.assets[0])).bytes;
        assert.ok(recoveredBytes); assert.deepEqual([...recoveredBytes], [0, 1, 2, 253, 254, 255]);
        assert.equal(read.conversation.detail.quality.status, status);
        assert.equal(read.conversation.detail.messages[999].content[0].type, 'unknown');
        assert.equal(Object.getOwnPropertySymbols(read.conversation).length, 0);
        resources.release();
        await assert.rejects(resources.acquire(read.conversation.index.key, read.conversation.detail.assets[0]), /released/);
        assert.ok(!JSON.stringify(read.conversation).includes('dataBase64'));
    }
});
});

__suiteDescribe("unified_ingest_integrity", () => {
useIndexStorage();
const observation = (id: string, updatedAt: number, title: string) => ({ id, updatedAt, title, titleSource: 'rpc' });

test__s5('active and passive source observations produce identical Index facts without timestampSource', async () => {
    for (const source of ['rpc-list', 'detail'] as const) {
        const candidate = parseGeminiIndexObservation(observation('chat_identity', 1000, 'Same title'), source);
        await ingestIndexes(ACCOUNT_UUID__s5, [candidate]);
        assert.deepEqual(await listIndexes(ACCOUNT_UUID__s5), [{ key: { accountId: ACCOUNT_UUID__s5, conversationId: 'chat_identity' },
            title: 'Same title', titleSource: 'provider', updatedAt: 1000 }]);
    }
});
test__s5('equal-version and newer observations merge through the same L2 owner without persisting source metadata', async () => {
    const admit = async (updatedAt: number, title: string, source: 'rpc-list' | 'detail', messageCount: number) => {
        await ingestIndexes(ACCOUNT_UUID__s5, [parseGeminiIndexObservation({ ...observation('chat_merge', updatedAt, title), messageCount }, source)]);
    };
    await admit(1000, 'Old Title', 'rpc-list', 2);
    const original = await listIndexes(ACCOUNT_UUID__s5);
    await admit(1000, 'Old Title', 'detail', 5);
    assert.deepEqual(await listIndexes(ACCOUNT_UUID__s5), original);
    await admit(2000, 'New Title', 'rpc-list', 5);
    const [index] = await listIndexes(ACCOUNT_UUID__s5);
    assert.equal(index.updatedAt, 2000); assert.equal(index.title, 'New Title');
    assert.equal(Object.hasOwn(index, 'messageCount'), false);
    assert.equal(Object.hasOwn(index, 'timestampSource'), false);
});
test__s5('malformed source identities cannot overwrite existing Index facts; invalid canonical batches reject atomically', async () => {
    await ingestIndexes(ACCOUNT_UUID__s5, [parseGeminiIndexObservation(observation('safe_123', 1000, 'Safe Chat'), 'rpc-list')]);
    const before = await listIndexes(ACCOUNT_UUID__s5);
    for (const raw of [{ id: 'c_unknown' }, { id: '' }, {}, { id: 'c_' }]) {
        assert.throws(() => parseGeminiIndexObservation(raw, 'rpc-list'), TypeError);
    }
    await assert.rejects(ingestIndexes(ACCOUNT_UUID__s5, [
        { conversationId: 'valid_123', fields: { title: 'Must not partially write', titleSource: 'provider' } },
        { conversationId: '', fields: {} },
    ]), TypeError);
    assert.deepEqual(await listIndexes(ACCOUNT_UUID__s5), before);
});
test__s5('a mixed RPC page admits only recognized rows and cannot certify coverage from invalid rows', async () => {
    const parsed = parseList(geminiListGen('G_UNIFIED_INGEST_INTEGRITY_01'));
    assert.equal(parsed.pageEvidence.valid, false);
    await ingestIndexes(ACCOUNT_UUID__s5, parsed.conversations.map(row => parseGeminiIndexObservation(row, 'rpc-list')));
    const indexes = await listIndexes(ACCOUNT_UUID__s5);
    assert.equal(indexes.length, 1); assert.equal(indexes[0].key.conversationId, 'valid_123');
});
});
