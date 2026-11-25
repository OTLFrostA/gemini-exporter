import { describe as __suiteDescribe } from 'node:test';
import { getDetail } from "../src/l3a/storageService.js";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { admitFixture } from "./helpers/admitFixture.js";
import { bindFixture } from "./helpers/domainFixture.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { parseIndexMetadata } from "../src/l1/parsers/shared/parseIndexMetadata.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { storageIdentity } from "./helpers/admitFixture.js";
import { readFixture } from "./helpers/admitFixture.js";
import { restoreDomainSnapshot as readStorageDomain } from "../src/l2/runtimeValidation.js";
import { type DomainFixture } from "./helpers/domainFixture.js";
import test__s1 from "node:test";
import { IDBObjectStore } from "fake-indexeddb";
import { putAccount } from "../src/l3a/storageService.js";
import { putExportRecord } from "../src/l3a/storageService.js";
import { listExportRecords } from "../src/l3a/storageService.js";
import { clearLocalExportRecords } from "../src/application/localCleanup.js";
import { ConversationViewState } from "../src/ui/options/state/conversationsStore.js";
import { ingestIndexes } from "../src/l2/ingestion.js";
import test__s2 from "node:test";
import { getIndex } from "../src/l3a/storageService.js";
import { listIndexes } from "../src/l3a/storageService.js";
import { mergeConversationIndex } from "../src/l2/conversationIndex.js";
import { conversationKey } from "../src/l2/conversationKey.js";
import { makeConversationIndex } from "./helpers/conversationIndexFixture.js";
import test__s3 from "node:test";
import { buildSync } from "esbuild";
import { IDBFactory } from "fake-indexeddb";
import { IDBKeyRange } from "fake-indexeddb";
import { A } from "./helpers/v2ConversationFixture.js";
import { B } from "./helpers/v2ConversationFixture.js";
import { key } from "./helpers/v2ConversationFixture.js";
import type * as Storage from "../src/l3a/storageService.js";
import test__s4 from "node:test";
import { indexStorage } from "./helpers/indexStorage.js";
import { putIndexes } from "../src/l3a/storageService.js";
import { ensureUpgraded } from "../src/migration/upgradeV1.js";
import test__s5 from "node:test";
import test__s6 from "node:test";
import { seed } from "./helpers/v2ConversationFixture.js";
import { openStorageDB } from "../src/l3a/idb.js";
import test__s7 from "node:test";
import vm from "node:vm";
import * as batch from "../src/l3a/batchStorageService.js";
import * as conversations from "../src/l3a/conversationStore.js";
import * as exports from "../src/l3a/exportRecordStore.js";
import test__s8 from "node:test";
import * as storage from "../src/l3a/storageService.js";
import test__s9 from "node:test";
import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import test__s10 from "node:test";
import { getSourceCooldown } from "../src/l3a/storageService.js";
import { extendSourceCooldown } from "../src/l3a/storageService.js";
import test__s11 from "node:test";
import { normId } from "../src/shared/utils/pathUtils.js";
import { type DomainConversationIndex } from "../src/l2/conversationIndex.js";
import { type ExportRecord } from "../src/application/export/types.js";
import test__s12 from "node:test";
import { getSettings } from "../src/application/settings/index.js";
import { updateSettings } from "../src/application/settings/index.js";
import { FEEDBACK_URL } from "../src/shared/utils/constants.js";
import { UNINSTALL_FEEDBACK_URL } from "../src/shared/utils/constants.js";
import test__s13 from "node:test";
import { v2ExportHost } from "./helpers/v2ExportHost.js";
import { exportRequest } from "./helpers/v2ExportHost.js";
import { exportKey } from "./helpers/v2ExportHost.js";
import { seedExportConversation } from "./helpers/v2ExportHost.js";
import { runExport } from "../src/application/export/runExport.js";
import { getExportRecord } from "../src/l3a/storageService.js";
import test__s14 from "node:test";
import { type GlobalSettings } from "../src/application/settings/index.js";
import { isVersionGreater } from "../src/shared/utils/pathUtils.js";

__suiteDescribe("domain-storage", () => {
useIndexStorage();













function source(id = 'chat', count = 2): DomainFixture {
    return { account: fixtureAccount(), sourceVersion: 1700000000000, conversation: validateParserDomain({ index: { key: fixtureKey(String(id), 'gemini'),   titleSource: "derived",   title: 'Stored title' }, detail: { savedAt: 1700000000000, key: fixtureKey(String(id), 'gemini'), quality: { status: 'unknown' }, assets: [{ id: 'asset', kind: 'image', sourceUri: 'source.png' }], messages: Array.from({ length: count }, (_, i) => ({ id: `m${i}`, role: 'assistant', model: 'Source model', content: [{ type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', text: `content ${i}` }, { type: 'image', assetId: 'asset' }] }] }], reasoning: [{ type: 'math', source: 'x^2' }], attachmentIds: ['asset'] })) } }), resourceHints: { asset: { archivePath: 'assets/export.png' } }, acquisitionHints: { asset: { url: 'source.png', localName: 'assets/export.png', resolvedUrl: 'https://derived.test/high-res' } }, diagnostics: [{ severity: 'warning', code: 'TEST', message: 'side channel' }] };
}
test('v2 stores structured Domain intact and excludes render/parse transport state', async () => {
    const parsed = source();
    const before = structuredClone(parsed);
    const record = await admitFixture('10000000-0000-4000-8000-000000000001', parsed);
    assert.deepEqual(record.conversation, parsed.conversation);
    assert.equal('index' in (await getDetail(record.conversation.detail.key))!, false);
    assert.equal('revision' in (await getDetail(record.conversation.detail.key))!, false);
    assert.doesNotMatch(JSON.stringify(await getDetail(record.conversation.detail.key)), /archivePath|localName|resolvedUrl|diagnostics/);
    assert.deepEqual(parsed, before);
    record.conversation.detail.messages[0].model = 'mutated';
    assert.equal((await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'chat')))!.conversation.detail.messages[0].model, 'Source model');
});
test('accounts and providers isolate identical IDs; non-Gemini IDs remain opaque', async () => {
    assert.deepEqual(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'chat'), storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'chat'));
    assert.equal(storageIdentity('future', fixtureAccount('future').id, 'chat').accountId, fixtureAccount('future').id);
    await admitFixture('10000000-0000-4000-8000-000000000001', source());
    assert.equal((await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'chat')))!.account.id, '10000000-0000-4000-8000-000000000001');
    const second = bindFixture(source(), '10000000-0000-4000-8000-000000000002'); second.conversation.index.title = 'Other account';
    await admitFixture('10000000-0000-4000-8000-000000000002', second);
    const other = bindFixture(source('chat'), fixtureAccount('future'));
    await admitFixture(other.account.id, other);
    assert.equal((await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'chat')))!.conversation.index.title, 'Stored title');
    assert.equal((await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000002', 'chat')))!.conversation.index.title, 'Other account');
    assert.equal(await readFixture(storageIdentity('future', fixtureAccount('future').id, 'c_chat')), null);
    assert.ok(await readFixture(storageIdentity('future', fixtureAccount('future').id, 'chat')));
});
test('partial/older captures cannot truncate current detail', async () => {
    const full = source('chat', 4); full.conversation.detail.quality.status = 'complete';
    await admitFixture('10000000-0000-4000-8000-000000000001', full);
    const shorter = source('chat', 1); shorter.sourceVersion = 1800000000000;
    await admitFixture('10000000-0000-4000-8000-000000000001', shorter);
    const partial = source('chat', 4); partial.conversation.detail.quality.status = 'partial';
    await admitFixture('10000000-0000-4000-8000-000000000001', partial);
    assert.deepEqual((await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'chat')))!.conversation, full.conversation);
    assert.deepEqual((await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'chat')))!.conversation, full.conversation);
});

test('persisted contract rejects obsolete fields, malformed content, non-finite values and dangling resources', async () => {
    for (const mutate of [
        (v: Record<string, unknown>) => { v.diagnostics = []; },
        (v: Record<string, unknown>) => { v.timestamp = Infinity; },
        (v: Record<string, unknown>) => { v.messages = [{ role: 'assistant', content: [{ type: 'paragraph', children: [], anchor: 'old' }] }]; },
        (v: Record<string, unknown>) => { v.assets = []; },
        (v: Record<string, unknown>) => { v.messages = [{ role: 'unknown', content: 'text' }]; },
    ]) {
        const v: Record<string, unknown> = structuredClone(source().conversation) as unknown as Record<string, unknown>;
        mutate(v); assert.throws(() => readStorageDomain(v));
    }
});
test('identical captures retain the same Detail facts', async () => {
    const parsed = source();
    const first = await admitFixture('10000000-0000-4000-8000-000000000001', parsed);
    const again = await admitFixture('10000000-0000-4000-8000-000000000001', parsed);
    assert.deepEqual(again.conversation.detail, first.conversation.detail);
});


test('larger partial and unknown captures protect complete body while title arbitration remains independent', async () => {
    const full = source('chat', 2);
    full.conversation.detail.quality.status = 'complete';
    full.conversation.index.titleSource = "provider";
    await admitFixture('10000000-0000-4000-8000-000000000001', full);
    const more = source('chat', 5);
    more.conversation.detail.quality.status = 'partial';
    more.sourceVersion = 1900000000000;
    more.conversation.index.title = 'RPC authoritative title';
    more.conversation.index.titleSource = "provider";
    await admitFixture('10000000-0000-4000-8000-000000000001', more);
    const stored = (await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'chat')))!.conversation;
    assert.deepEqual(stored.detail.messages, full.conversation.detail.messages);
    assert.equal(stored.detail.quality.status, 'complete');
    assert.equal('updatedAt' in stored, false);
    assert.equal((await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'chat')))!.conversation.detail.savedAt, full.sourceVersion);
    assert.equal(stored.index.title, more.conversation.index.title);
    assert.equal(stored.index.titleSource, 'provider');
    more.conversation.detail.quality.status = 'unknown';
    more.conversation.index.title = 'Weaker incoming title';
    more.conversation.index.titleSource = "derived";
    await admitFixture('10000000-0000-4000-8000-000000000001', more);
    const again = (await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'chat')))!.conversation;
    assert.deepEqual(again, stored);
});


test('placeholder sources never displace a real stored title, even when the incoming body wins', async () => {
    for (const title of ['Gemini', 'Google Gemini', 'New chat', '新对话', 'Untitled', 'Untitled Chat', '未命名对话']) {
        const id = `title-${title}`;
        const old = source(id, 2);
        old.conversation.index.title = 'Research question from Takeout';
        old.conversation.index.titleSource = "derived";
        await admitFixture('10000000-0000-4000-8000-000000000001', old);
        const incoming = source(id, 3);
        incoming.conversation.index = { key: incoming.conversation.index.key, ...parseIndexMetadata({ account: fixtureAccount(), providerId: incoming.account.providerId, id: incoming.conversation.index.key.conversationId, title, titleSource: 'rpc' }) };
        await admitFixture('10000000-0000-4000-8000-000000000001', incoming);
        const stored = (await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', id)))!.conversation;
        assert.equal(stored.index.title, old.conversation.index.title, title);
        assert.equal(stored.index.titleSource, 'derived', title);
        assert.deepEqual(stored.detail.messages, incoming.conversation.detail.messages);
    }
});

test('real titles replace higher-ranked placeholders without rejecting short or Takeout prompt titles', async () => {
    for (const title of ['A', 'Research question from Takeout']) {
        const id = `real-${title}`;
        const old = source(id, 2);
        old.conversation.index = { key: old.conversation.index.key, ...parseIndexMetadata({ account: fixtureAccount(), providerId: old.account.providerId, id: old.conversation.index.key.conversationId, title: 'Gemini', titleSource: 'rpc' }) };
        await admitFixture('10000000-0000-4000-8000-000000000001', old);
        const incoming = source(id, 1);
        incoming.conversation.index.title = title;
        incoming.conversation.index.titleSource = "derived";
        await admitFixture('10000000-0000-4000-8000-000000000001', incoming);
        const stored = (await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', id)))!.conversation;
        assert.equal(stored.index.title, title);
        assert.equal(stored.index.titleSource, 'derived');
        assert.deepEqual(stored.detail.messages, incoming.conversation.detail.messages);
    }
});


test('stored repeated source message IDs export without losing or rewriting source messages', async () => {
    const parsed = source('duplicate-identities', 3);
    parsed.conversation.detail.messages.forEach(message => { message.id = 'same'; });
    const original = structuredClone(parsed.conversation);
    await admitFixture('10000000-0000-4000-8000-000000000001', parsed);
    const stored = await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', parsed.conversation.index.key.conversationId));
    assert.ok(stored);
    const document = composeDomainDocument(stored.conversation, fixtureAccountFor(stored.conversation));
    assert.equal(document.messages.length, 3);
    assert.ok(document.messages.every(message => !('id' in message)));
    assert.equal(document.messages.length, original.detail.messages.length);
    assert.deepEqual(stored.conversation, original);
});


test('a partial capture fills an empty metadata placeholder without replacing existing nonpartial bodies', async () => {
    const identity = storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'dom-capture');
    const placeholder = source('dom-capture', 0);
    await admitFixture('10000000-0000-4000-8000-000000000001', placeholder);
    const captured = source('dom-capture', 2);
    captured.conversation.detail.quality.status = 'partial';
    await admitFixture('10000000-0000-4000-8000-000000000001', captured);
    assert.deepEqual((await readFixture(identity))!.conversation.detail.messages, captured.conversation.detail.messages);
    const full = source('dom-capture', 3); full.conversation.detail.quality.status = 'complete';
    await admitFixture('10000000-0000-4000-8000-000000000001', full);
    const fragment = source('dom-capture', 5);
    fragment.conversation.detail.quality.status = 'partial';
    await admitFixture('10000000-0000-4000-8000-000000000001', fragment);
    assert.deepEqual((await readFixture(identity))!.conversation.detail.messages, full.conversation.detail.messages);
});
});

__suiteDescribe("clear_exported_race", () => {
useIndexStorage({ seedAccounts: false });const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const record={exportedAt:200,format:'markdown' as const,status:'ok' as const,chatTime:100};
async function seed(){await putAccount({id:A,providerId:'gemini',providerAccountId:'fixture'});for(const conversationId of ['a','b'])await putExportRecord({accountId:A,conversationId},record);}
test__s1('P1-3: clearing records uses the current Application cleanup, and a refresh rereads committed records',async()=>{
    await seed();const view=new ConversationViewState();view.selectAccount(A);await view.refresh();assert.equal(Object.keys(view.records).length,2);await clearLocalExportRecords(A);await view.refresh();assert.deepEqual(view.records,{});assert.deepEqual(await listExportRecords(A),{});
});
test__s1('real IndexedDB serialization preserves a new record admitted while the old record deletion is in flight',async()=>{
    await seed();const original=IDBObjectStore.prototype.delete;let pending:Promise<void>|undefined;
    IDBObjectStore.prototype.delete=function(key){const result=original.call(this,key);if(this.name==='exportRecords'&&!pending)pending=putExportRecord({accountId:A,conversationId:'new'},record);return result;};
    try{await clearLocalExportRecords(A);assert.ok(pending,'the race must run inside the physical delete path');await pending;assert.deepEqual(Object.keys(await listExportRecords(A)),['new']);}finally{IDBObjectStore.prototype.delete=original;}
});
test__s1('clearing one UUID removes its records without touching another account',async()=>{
    await seed();await putExportRecord({accountId:B,conversationId:'a'},record);await clearLocalExportRecords(A);assert.deepEqual(await listExportRecords(A),{});assert.deepEqual(await listExportRecords(B),{a:record});
});
test__s1('record cleanup keeps explicit selection; refreshing unexported records never auto-selects conversations',async()=>{
    await seed();await ingestIndexes(A,['a','b'].map(conversationId=>({conversationId,fields:{title:conversationId,titleSource:'provider' as const}})));const view=new ConversationViewState();view.selectAccount(A);await view.refresh();assert.equal(view.selected.size,0);
    await clearLocalExportRecords(A);await view.refresh();assert.equal(view.selected.size,0);view.selectVisible();assert.equal(view.selected.size,2);await view.refresh();assert.equal(view.selected.size,2);
});
});

__suiteDescribe("concurrency_consistency", () => {
useIndexStorage();
const accountId = '10000000-0000-4000-8000-000000000001';
const key = (id: string) => conversationKey(accountId, id);

test__s2('Domain ingestIndexes patches only the target record and rejects missing identities', async () => {
    await ingestIndexes(accountId, ['first', 'second', 'third'].map(conversationId => ({ conversationId, fields: { title: conversationId, titleSource: 'provider' } })));
    await ingestIndexes(accountId, [{ conversationId: 'first', fields: { title: 'New title', titleSource: 'provider', updatedAt: 10 } }]);
    assert.equal((await getIndex(key('first')))?.title, 'New title');
    assert.equal((await getIndex(key('first')))?.updatedAt, 10);
    assert.equal((await getIndex(key('second')))?.title, 'second');
    assert.equal((await getIndex(key('third')))?.title, 'third');
    await assert.rejects(ingestIndexes(accountId, [{ conversationId: '', fields: { title: 'X', titleSource: 'provider' } }]), /Invalid conversation key/);
    assert.equal((await listIndexes(accountId)).length, 3);
});
test__s2('mergeConversationIndex keeps source updatedAt monotonic and earliest createdAt', () => {
    const previous = makeConversationIndex({ key: key('monotonic'), title: 'Before', titleSource: 'provider', updatedAt: 1700000050000, createdAt: 1700000000000 });
    const older = mergeConversationIndex(previous, makeConversationIndex({ key: previous.key, title: 'Old RPC', titleSource: 'provider', updatedAt: 1700000010000, createdAt: 1700000005000 }));
    assert.equal(older.updatedAt, previous.updatedAt); assert.equal(older.createdAt, previous.createdAt);
    const newer = mergeConversationIndex(previous, makeConversationIndex({ key: previous.key, title: undefined, titleSource: undefined, updatedAt: 1700000090000, createdAt: 1699999990000 }));
    assert.equal(newer.updatedAt, 1700000090000); assert.equal(newer.createdAt, 1699999990000);
});
test__s2('overlapping ingestIndexes transactions preserve both independent changes', async () => {
    await ingestIndexes(accountId, [{ conversationId: 'first', fields: { title: 'Before', titleSource: 'provider' } }, { conversationId: 'second', fields: { title: 'Independent', titleSource: 'provider' } }]);
    // Both calls reach native IDB before either is awaited; no mock read/modify/write queue.
    await Promise.all([
        ingestIndexes(accountId, [{ conversationId: 'first', fields: { title: 'After', titleSource: 'provider' } }]),
        ingestIndexes(accountId, [{ conversationId: 'second', fields: { updatedAt: 7 } }]),
    ]);
    assert.equal((await getIndex(key('first')))?.title, 'After');
    assert.equal((await getIndex(key('second')))?.updatedAt, 7);
    assert.equal((await getIndex(key('second')))?.title, 'Independent');
    assert.equal((await listIndexes(accountId)).length, 2);
});
});

__suiteDescribe("crosstab_write_queue", () => {
const code = buildSync({ entryPoints: ['src/l3a/storageService.ts'], bundle: true, write: false, format: 'iife', globalName: 'storage' }).outputFiles[0].text;
function contexts() {
    const database = new IDBFactory();
    const create = () => new Function('indexedDB', 'IDBKeyRange', code + ';return storage;')(database, IDBKeyRange) as typeof Storage;
    return [create(), create()] as const;
}
test__s3('T1: independent Storage contexts cannot lose concurrent Index transactions', async () => {
    const [a, b] = contexts();
    await a.putIndexes([{ key: key('a'), updatedAt: 1 }, { key: key('b'), updatedAt: 2 }]);
    await Promise.all([
        a.updateIndexesAtomically([key('a')], rows => [{ ...rows[0]!, title: 'A edit', titleSource: 'provider' }]),
        b.updateIndexesAtomically([key('b')], rows => [{ ...rows[0]!, updatedAt: 20 }]),
    ]);
    assert.equal((await b.getIndex(key('a')))?.title, 'A edit'); assert.equal((await a.getIndex(key('b')))?.updatedAt, 20);
});
test__s3('T2: independent Storage contexts preserve concurrent ExportRecords', async () => {
    const [a, b] = contexts();
    const record = { format: 'markdown' as const, status: 'ok' as const, exportedAt: 1 };
    await Promise.all([a.putExportRecord(key('a'), record), b.putExportRecord(key('b'), record)]);
    assert.deepEqual(Object.keys(await a.listExportRecords(A)).sort(), ['a', 'b']);
});
test__s3('T4: native transactions serialize same-key edits without a Web Locks API', async () => {
    const [a, b] = contexts(); await a.putIndexes([{ key: key(), updatedAt: 0 }]);
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).updateIndexesAtomically([key()], rows => [{ ...rows[0]!, updatedAt: rows[0]!.updatedAt! + 1 }])));
    assert.equal((await a.getIndex(key()))?.updatedAt, 20);
});
test__s3('T5: an empty Index admission decision leaves stored facts unchanged', async () => {
    const [a] = contexts(); const row = { key: key(), title: 'Keep', titleSource: 'provider' as const };
    await a.putIndexes([row]); await a.updateIndexesAtomically([key()], () => []);
    assert.deepEqual(await a.getIndex(key()), row);
});
test__s3('T6: verified deletion atomically drops Index, Detail and ExportRecord only for its ConversationKey', async () => {
    const [a, b] = contexts();
    const record = { format: 'markdown' as const, status: 'ok' as const, exportedAt: 1 };
    for (const accountId of [A, B]) {
        const target = key('same', accountId); await a.putIndexes([{ key: target }]);
        await a.updateConversationAtomically(target, () => ({
            detail: { key: target, quality: { status: 'complete' }, messages: [], assets: [] }, result: undefined
        }));
        await a.putExportRecord(target, record);
    }
    await a.deleteStoredConversation(key('same'));
    assert.equal(await b.getIndex(key('same')), null); assert.equal(await b.getDetail(key('same')), null); assert.equal(await b.getExportRecord(key('same')), null);
    assert.ok(await b.getIndex(key('same', B))); assert.ok(await b.getDetail(key('same', B))); assert.deepEqual(await b.getExportRecord(key('same', B)), record);
});
});

__suiteDescribe("exportedids_readpath_normalization", () => {
const accountId='10000000-0000-4000-8000-000000000001';
const rec=(exportedAt:number)=>({exportedAt,status:'ok' as const,format:'markdown' as const});
const account={id:accountId,providerId:'gemini',providerAccountId:'10000000001'};
async function seedLegacyAccount(){
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('gemini_exporter_domain',1);request.onupgradeneeded=()=>request.result.createObjectStore('accounts',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(account);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}

test__s4('legacy record aliases normalize once through migration; current reads remain canonical',async()=>{
    const env=indexStorage({[`exported_${accountId}`]:{xyz789:rec(200),c_xyz789:rec(100)}});try{await seedLegacyAccount();await ensureUpgraded();const writes=env.writes();assert.deepEqual(await listExportRecords(accountId),{xyz789:rec(200)});assert.deepEqual(await listExportRecords(accountId),{xyz789:rec(200)});assert.equal(env.writes(),writes);}finally{env.restore();}
});
test__s4('alias-only historical records have no implicit fallback before upgrade and become readable after the one-time owner runs',async()=>{
    const env=indexStorage({[`exported_${accountId}`]:{c_abc123:rec(300)}});try{await seedLegacyAccount();assert.deepEqual(await listExportRecords(accountId),{});await ensureUpgraded();assert.deepEqual(await listExportRecords(accountId),{abc123:rec(300)});}finally{env.restore();}
});
test__s4('ConversationViewState reads only canonical records without another in-memory alias-normalization policy',async()=>{
    const env=indexStorage({[`exported_${accountId}`]:{c_abc123:rec(300)}});try{await seedLegacyAccount();await ensureUpgraded();await putIndexes([{key:{accountId,conversationId:'abc123'},title:'Canonical',titleSource:'provider'}]);const view=new ConversationViewState();view.selectAccount(accountId);await view.refresh();assert.deepEqual(Object.keys(view.records),['abc123']);assert.equal(view.records.c_abc123,undefined);view.filter='has_record';assert.deepEqual(view.visible().map(x=>x.key.conversationId),['abc123']);}finally{env.restore();}
});
});

__suiteDescribe("storage_alias_migration_race", () => {
useIndexStorage();
test__s5('concurrent export writes preserve both records', async () => {
    const first = { status: 'ok' as const, format: 'markdown' as const, exportedAt: 1 };
    const second = { status: 'partial' as const, format: 'html' as const, exportedAt: 2 };
    await Promise.all([putExportRecord(key('first'), first), putExportRecord(key('second'), second)]);
    assert.deepEqual(await listExportRecords(A), { first, second });
});
});

__suiteDescribe("storage_read_canonical", () => {
test__s6('current-schema reads use only account-scoped v2 stores, ignoring legacy global fallback keys', async () => {
    const env = indexStorage({ conversations: [{ id: 'leak' }], exported: { leak: {} }, ['conversations_' + A]: [{ id: 'old' }] });
    try {
        await seed('a'); await seed('b', { accountId: B });
        assert.deepEqual((await listIndexes(A)).map(row => row.key.conversationId), ['a']);
        assert.deepEqual((await listIndexes(B)).map(row => row.key.conversationId), ['b']);
        assert.deepEqual(await listExportRecords(A), {});
    } finally { env.restore(); }
});
test__s6('current-schema read paths are non-mutating, including empty-account reads', async () => {
    const env = indexStorage({ sentinel: { keep: true } }); try {
        await seed();
        const record = { format: 'html' as const, status: 'ok' as const, exportedAt: 10 };
        await putExportRecord(key(), record);
        const snapshot = async () => {
            const db = await openStorageDB();
            try {
                const stores = Array.from(db.objectStoreNames);
                const rows: Record<string, { keys: IDBValidKey[]; values: unknown[] }> = {};
                await new Promise<void>((resolve, reject) => {
                    const tx = db.transaction(stores, 'readonly');
                    tx.oncomplete = () => resolve();
                    tx.onabort = () => reject(tx.error);
                    for (const name of stores) {
                        const store = tx.objectStore(name);
                        const row: { keys: IDBValidKey[]; values: unknown[] } = rows[name] = { keys: [], values: [] };
                        const keys = store.getAllKeys(), values = store.getAll();
                        keys.onsuccess = () => { row.keys = keys.result; };
                        values.onsuccess = () => { row.values = values.result; };
                    }
                });
                return { rows, local: await chrome.storage.local.get(null) };
            } finally { db.close(); }
        };
        const before = await snapshot(), writes = env.writes();
        assert.equal(before.rows.indexes.values.length, 1);
        for (let repeat = 0; repeat < 2; repeat++) {
            const indexes = await listIndexes(A), emptyIndexes = await listIndexes(B);
            const records = await listExportRecords(A), emptyRecords = await listExportRecords(B);
            assert.deepEqual(await snapshot(), before, 'reads must preserve all persisted data');
            assert.deepEqual(indexes, before.rows.indexes.values);
            assert.deepEqual(emptyIndexes, []);
            assert.deepEqual(records, { chat: record });
            assert.deepEqual(emptyRecords, {});
        }
        assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});
test__s6('listExportRecords enforces account isolation without fallback leakage', async () => {
    const env = indexStorage(); try {
        const a = { format: 'html' as const, status: 'ok' as const, exportedAt: 10 };
        const b = { format: 'json' as const, status: 'partial' as const, exportedAt: 20 };
        await putExportRecord(key('same'), a); await putExportRecord(key('same', B), b);
        assert.deepEqual(await listExportRecords(A), { same: a }); assert.deepEqual(await listExportRecords(B), { same: b });
    } finally { env.restore(); }
});
});

__suiteDescribe("storage_public_entrypoints", () => {
function exportKeys(entryPoint: string): string[] {
    const code = buildSync({ entryPoints: [entryPoint], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
    const context = { module: { exports: {} } };
    vm.runInNewContext(code, context);
    return Object.keys(context.module.exports).sort();
}

test__s7('batch Storage exposes exactly the three agreed passive IO functions', () => {
    assert.deepEqual(exportKeys('src/l3a/batchStorageService.ts'), [
        'getConversationSnapshot', 'updateConversationsAtomically', 'putExportRecords',
    ].sort());
    assert.equal(batch.getConversationSnapshot, conversations.getConversationSnapshot);
    assert.equal(batch.updateConversationsAtomically, conversations.updateConversationsAtomically);
    assert.equal(batch.putExportRecords, exports.putExportRecords);
});

test__s7('vault Storage exposes exactly the agreed passive IO functions', () => {
    assert.deepEqual(exportKeys('src/l3a/vaultStorageService.ts'), [
        'clearCloudSyncSession', 'clearSyncedCloudRecordsForOwner', 'countCloudOutbox',
        'countOversizedCloudRecords', 'enqueueCloudOutboxKeys', 'getCloudSyncSession',
        'getStoredLocalVaultHandle', 'getSyncedCloudRecord', 'getSyncedCloudRecordByBlindId',
        'listDueCloudOutbox', 'putCloudSyncSession', 'putLocalVaultConnection',
        'putSyncedCloudRecord', 'recordCloudOutboxFailure', 'removeCloudOutboxEntry',
        'setStoredLocalVaultHandle', 'activateVaultKeyring', 'getInitializedVaultKeyMetadata', 'getInitializedVaultKeyring',
    ].sort());
});
});

__suiteDescribe("storage_readiness_boundary", () => {
function readiness(): typeof import('../src/runtime/background/readiness.js') {
    const file = require.resolve('../src/runtime/background/readiness.js');
    delete require.cache[file]; return require(file);
}
test__s8('Background readiness shares in-flight upgrade and caches success', async () => {
    const env = indexStorage();
    try {
        const { ensureV2Ready } = readiness();
        const first = ensureV2Ready(); assert.equal(first, ensureV2Ready()); await first;
        assert.equal(env.local.gemini_exporter_v2_initialized, true);
        const writes = env.writes(); assert.equal(first, ensureV2Ready()); await ensureV2Ready();
        assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});
test__s8('Background retries failed upgrade and never admits a failed marker commit', async () => {
    const env = indexStorage();
    try {
        const { ensureV2Ready } = readiness(); env.fail('gemini_exporter_v2_initialized');
        let admitted = false;
        await assert.rejects(ensureV2Ready().then(() => { admitted = true; }), /write failed/);
        assert.equal(admitted, false); assert.equal(env.local.gemini_exporter_v2_initialized, undefined);
        env.fail(); await ensureV2Ready(); assert.equal(env.local.gemini_exporter_v2_initialized, true);
    } finally { env.restore(); }
});
test__s8('passive Storage neither invokes Migration nor stores an initialization marker', async () => {
    const env = indexStorage({ gemini_exporter_schema_version: 999 });
    try {
        await storage.putIndexes([{ key: fixtureKey('passive') }]);
        assert.ok(await storage.getIndex(fixtureKey('passive')));
        assert.deepEqual(env.local, { gemini_exporter_schema_version: 999 });
    } finally { env.restore(); }
});
});

__suiteDescribe("schema_migration", () => {
test__s9('global schema manager and normal Storage legacy readers are retired', () => {
    for (const file of ['schemaMigration.ts', 'schemaState.ts', 'migrationMarker.ts']) assert.equal(existsSync('src/l3a/' + file), false);
    for (const file of readdirSync('src/l3a').filter(file => file.endsWith('.ts'))) {
        const source = readFileSync('src/l3a/' + file, 'utf8');
        assert.doesNotMatch(source, /gemini_exporter_v2_initialized|conversations_|exported_|schemaVersion|ensureUpgraded/);
    }
});
for (const version of [1, 2, 999, '3']) test__s9(`legacy schema indicator ${version} does not invent a new migration category`, async () => {
    const seed = { gemini_exporter_schema_version: version, evidence: ['unchanged'] };
    const env = indexStorage(seed);
    try {
        await ensureUpgraded();
        assert.deepEqual(env.local, { ...seed, gemini_exporter_v2_initialized: true, gemini_exporter_source_versions_v1: true });
        assert.deepEqual(await indexedDB.databases(), []);
    } finally { env.restore(); }
});
});

__suiteDescribe("source_cooldown_store", () => {
useIndexStorage();

test__s10('transport deadlines are account scoped and concurrent writes cannot shorten a cooldown', async () => {
    await Promise.all([extendSourceCooldown('one', 7200000), extendSourceCooldown('one', 3600000)]);
    assert.equal(await getSourceCooldown('one'), 7200000);
    assert.equal(await getSourceCooldown('two'), 0);
    await extendSourceCooldown('two', 1800000);
    assert.equal(await getSourceCooldown('one'), 7200000);
    assert.equal(await getSourceCooldown('two'), 1800000);
});

test__s10('malformed persisted deadlines do not become trusted transport state', async () => {
    for (const value of ['3600000', {}, -1, 0.5]) {
        await chrome.storage.local.set({ source_cooldown_one: value });
        assert.equal(await getSourceCooldown('one'), 0);
    }
});
});

__suiteDescribe("conversations_store", () => {
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const accounts = [A, B].map(id => ({ id, providerId: 'gemini', providerAccountId: id }));
const row = (id: string, accountId = A, updatedAt = 10): DomainConversationIndex => makeConversationIndex({ key: conversationKey(accountId, id), title: id, updatedAt });
function view(rows = [row('one')], records: Record<string, ExportRecord> = {}) {
    return new ConversationViewState({ listAccounts: async () => accounts,
        listIndexes: async id => rows.filter(row => row.key.accountId === id), listExportRecords: async () => records });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

test__s11('conversationsStore - canonical keys retain source identity; UI does not normalize provider IDs', () => {
    assert.equal(normId('c_12345678'), '12345678'); assert.equal(normId('12345678'), '12345678');
    assert.equal(normId(''), ''); assert.equal(normId(null), '');
    const state = view(); state.indexes = [row('c_12345678'), row('12345678')];
    state.selectVisible();
    assert.deepEqual(state.keys(), [conversationKey(A, 'c_12345678'), conversationKey(A, '12345678')]);
    assert.throws(() => conversationKey(A, ' '), /Invalid conversation key/);
});
test__s11('conversationsStore - in-memory view state is per instance and account changes clear selection', async () => {
    const first = view(), second = view(); await first.refresh();
    first.selectVisible(); assert.equal(first.selected.size, 1); assert.equal(second.selected.size, 0);
    first.selectAccount(B); assert.equal(first.accountId, B); assert.deepEqual(first.indexes, []);
    assert.deepEqual(first.records, {}); assert.equal(first.selected.size, 0);
});
test__s11('conversationsStore - export records use exact current Conversation IDs', async () => {
    const record: ExportRecord = { format: 'markdown', exportedAt: 5000, status: 'ok' };
    const state = view([row('123'), row('c_123')], { '123': record }); await state.refresh();
    state.filter = 'has_record'; assert.deepEqual(state.visible().map(r => r.key.conversationId), ['123']);
    state.filter = 'no_record'; assert.deepEqual(state.visible().map(r => r.key.conversationId), ['c_123']);
});
test__s11('conversationsStore - refresh publishes changed titles and identities without a signature cache', async () => {
    let rows = [row('a')]; const state = new ConversationViewState({ listAccounts: async () => accounts,
        listIndexes: async () => rows, listExportRecords: async () => ({}) });
    await state.refresh(); assert.deepEqual(state.indexes, rows);
    rows = [{ ...row('b'), title: 'Real title' }]; await state.refresh();
    assert.deepEqual(state.indexes, rows); assert.equal(state.visible()[0].title, 'Real title');
});
test__s11('conversationsStore retains canonical Index facts without introducing legacy flags', async () => {
    const rows = [{ ...row('imported'), title: 'Renamed online', titleSource: 'provider' as const }];
    const state = view(rows); await state.refresh();
    assert.deepEqual(state.indexes, rows); assert.equal(Object.hasOwn(state.indexes[0], 'hasTakeoutImport'), false);
});
test__s11('conversationsStore consumes canonical indexes without rewriting them', async () => {
    const rows = [row('abc123')], state = view(rows); const snapshot = structuredClone(rows);
    await state.refresh(); state.search = 'abc'; state.visible();
    assert.deepEqual(rows, snapshot); assert.strictEqual(state.indexes[0], rows[0]);
});
test__s11('conversationsStore refresh observes activity changes without a title or identity change', async () => {
    let rows = [row('first', A, 10), row('second', A, 20)];
    const state = new ConversationViewState({ listAccounts: async () => accounts, listIndexes: async () => rows, listExportRecords: async () => ({}) });
    await state.refresh(); assert.equal(state.visible()[0].key.conversationId, 'second');
    rows = [{ ...rows[0], updatedAt: 30 }, rows[1]]; await state.refresh();
    assert.equal(state.visible()[0].key.conversationId, 'first');
});
for (const switchAccount of [false, true]) test__s11(`a delayed account load cannot replace a newer ${switchAccount ? 'account selection' : 'snapshot'}`, async () => {
    const held = deferred<DomainConversationIndex[]>(), started = deferred<void>(); let reads = 0;
    const state = new ConversationViewState({ listAccounts: async () => accounts, listExportRecords: async () => ({}),
        listIndexes: async id => { if (reads++ === 0) { started.resolve(); return held.promise; } return [row('newer', id)]; } });
    state.selectAccount(A); const old = state.refresh(); await started.promise;
    const next = switchAccount ? B : A; state.selectAccount(next); await state.refresh();
    held.resolve([row('older')]); await old;
    assert.equal(state.accountId, next); assert.deepEqual(state.indexes.map(r => r.key), [conversationKey(next, 'newer')]);
});
test__s11('completion of an old account refresh cannot remove the same conversation from visible account B', async () => {
    const held = deferred<DomainConversationIndex[]>(), started = deferred<void>();
    const state = new ConversationViewState({ listAccounts: async () => accounts, listExportRecords: async () => ({}),
        listIndexes: async id => { if (id === A) { started.resolve(); return held.promise; } return [row('shared', B)]; } });
    state.selectAccount(A); const pending = state.refresh(); await started.promise;
    state.selectAccount(B); await state.refresh(); state.selected.add('shared'); held.resolve([]); await pending;
    assert.deepEqual(state.keys(), [conversationKey(B, 'shared')]);
});

test__s11('refresh suppresses unchanged and stale paints while detecting title, activity and export changes', async () => {
    let rows = [row('one')];
    let records: Record<string, ExportRecord> = {};
    const state = new ConversationViewState({listAccounts: async () => accounts,
        listIndexes: async () => structuredClone(rows), listExportRecords: async () => structuredClone(records)});
    assert.equal(await state.refresh(), true);
    state.selected.add('one');
    assert.equal(await state.refresh(), false);
    rows = [{...rows[0], title:'New title'}];
    assert.equal(await state.refresh(), true);
    rows = [{...rows[0], updatedAt:20}];
    assert.equal(await state.refresh(), true);
    records = {one:{status:'ok',format:'markdown',exportedAt:30,chatTime:20}};
    assert.equal(await state.refresh(), true);
    assert.equal(await state.refresh(), false);
    assert.deepEqual([...state.selected], ['one']);
});

test__s11('other-account invalidation refreshes account choices without reading current conversation stores', async () => {
    let registry = accounts;
    let rowReads = 0;
    const state = new ConversationViewState({listAccounts: async () => structuredClone(registry),
        listIndexes: async () => { rowReads++; return [row('one')]; }, listExportRecords: async () => ({})});
    await state.refresh();
    assert.equal(await state.refresh(B), false);
    assert.equal(rowReads, 1);
    registry = accounts.map(account => account.id === B ? {...account,displayName:'Renamed account'} : account);
    assert.equal(await state.refresh(B), true);
    assert.equal(rowReads, 1);
    assert.equal(state.accounts[1].displayName, 'Renamed account');
    registry = [accounts[1]];
    assert.equal(await state.refresh(B), true);
    assert.equal(rowReads, 2);
    assert.equal(state.accountId, B);
});

test__s11('first-account invalidation loads its rows and stale reads report no repaint', async () => {
    let registry: typeof accounts = [];
    const held = deferred<DomainConversationIndex[]>(), started = deferred<void>();
    let delayed = false;
    const state = new ConversationViewState({listAccounts: async () => registry,
        listExportRecords: async () => ({}), listIndexes: async () => {
            if (delayed) { started.resolve(); return held.promise; }
            return [row('new')];
        }});
    assert.equal(await state.refresh(), false);
    registry = accounts;
    assert.equal(await state.refresh(A), true);
    delayed = true;
    const old = state.refresh(); await started.promise;
    delayed = false;
    assert.equal(await state.refresh(), false);
    held.resolve([row('stale')]);
    assert.equal(await old, false);
    assert.equal(state.indexes[0].title, 'new');
});

test__s11('an unrelated invalidation cannot discard current-account facts from an overlapping refresh', async () => {
    const held = deferred<DomainConversationIndex[]>(), started = deferred<void>();
    let reads = 0;
    const state = new ConversationViewState({listAccounts: async () => accounts,
        listExportRecords: async () => ({}), listIndexes: async () => {
            if (++reads === 2) { started.resolve(); return held.promise; }
            return [row(reads === 1 ? 'initial' : 'latest')];
        }});
    await state.refresh();
    const pending = state.refresh(A); await started.promise;
    assert.equal(await state.refresh(B), true);
    held.resolve([row('stale')]);
    assert.equal(await pending, false);
    assert.equal(state.indexes[0].title, 'latest');
});

test__s11('an invalidation starting during a read still replaces it when the stale read finishes first', async () => {
    const heldRows = deferred<DomainConversationIndex[]>(), rowsStarted = deferred<void>();
    const heldAccounts = deferred<typeof accounts>(), accountsStarted = deferred<void>();
    let accountReads = 0, rowReads = 0;
    const state = new ConversationViewState({listAccounts: async () => {
        if (++accountReads === 3) { accountsStarted.resolve(); return heldAccounts.promise; }
        return accounts;
    }, listExportRecords: async () => ({}), listIndexes: async () => {
        if (++rowReads === 2) { rowsStarted.resolve(); return heldRows.promise; }
        return [row(rowReads === 1 ? 'initial' : 'latest')];
    }});
    await state.refresh();
    const old = state.refresh(A); await rowsStarted.promise;
    const next = state.refresh(B); await accountsStarted.promise;
    heldRows.resolve([row('stale')]);
    assert.equal(await old, false);
    heldAccounts.resolve(accounts);
    assert.equal(await next, true);
    assert.equal(state.indexes[0].title, 'latest');
});
});

__suiteDescribe("format_store", () => {
const SUPPORTED_FORMATS: readonly string[] = ['markdown', 'html', 'json', 'pdf', 'docx'];
const html = () => readFileSync('src/ui/options/options.html', 'utf8');

test__s12('current Settings default to the supported Markdown export format', async () => {
    const env = indexStorage();
    try {
        const format = (await getSettings()).defaultFormat;
        assert.equal(format, 'markdown');
        assert.ok(SUPPORTED_FORMATS.includes(format));
    } finally { env.restore(); }
});
test__s12('current Options format control accepts exactly the five current formats', () => {
    const select = html().match(/<select id="format"[^>]*>(.*?)<\/select>/s)?.[1]; assert.ok(select);
    const values = [...select.matchAll(/value="([^"]+)"/g)].map(match => match[1]);
    for (const format of ['markdown', 'html', 'pdf', 'docx', 'json']) assert.ok(values.includes(format));
    for (const invalid of ['json_openai', 'json_raw', 'xml', '']) assert.equal(values.includes(invalid), false);
});
test__s12('removed saved formats normalize only through the one-time migration owner', async () => {
    for (const value of ['markdown', 'html', 'json', 'pdf', 'json_openai', 'json_raw', 'invalid']) {
        const env = indexStorage({ gemini_export_format: value }); try {
            await ensureUpgraded(); assert.equal((await getSettings()).defaultFormat, SUPPORTED_FORMATS.includes(value) ? value : 'markdown');
        } finally { env.restore(); }
    }
});
test__s12('format control choices match the ExportRequest formats rather than removed legacy variants', () => {
    const select = html().match(/<select id="format"[^>]*>(.*?)<\/select>/s)?.[1] ?? '';
    assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map(match => match[1]).sort(), [...SUPPORTED_FORMATS].sort());
});
test__s12('feedback links attribute extension and uninstall sources separately', () => {
    assert.equal(FEEDBACK_URL, 'https://tally.so/r/Y56ZBB?source=extension');
    assert.equal(UNINSTALL_FEEDBACK_URL, 'https://tally.so/r/Y56ZBB?source=uninstall');
});
for (const stored of ['json_openai', 'json_raw']) for (const developerMode of [false, true]) test__s12(`migration repairs saved ${stored} in developer mode ${developerMode}`, async () => {
    const env = indexStorage({ gemini_export_format: stored, gemini_dev_mode: developerMode }); try {
        await ensureUpgraded(); const settings = await getSettings();
        assert.equal(settings.defaultFormat, 'markdown'); assert.equal(settings.developerMode, developerMode);
        await updateSettings({ defaultFormat: 'html' }); assert.equal((await getSettings()).defaultFormat, 'html');
        assert.equal(env.local.gemini_export_format, stored, 'normal v2 Settings writes do not maintain a legacy preference mirror');
    } finally { env.restore(); }
});
});

__suiteDescribe("session_store", () => {
// v2 deliberately has no persistent SessionStore. Restart behavior belongs to
// runExport + minimal ExportRecords; requests supply their own selection again.
const sessionKey = 'gemini_last_export_session';
async function assertNoSession() {
    const local = await chrome.storage.local.get(null);
    assert.equal(Object.hasOwn(local, sessionKey), false);
}

test__s13('restart state is empty before any delivery, without creating a session', async t => {
    v2ExportHost(t);
    assert.deepEqual(await listExportRecords(exportKey('empty').accountId), {});
    assert.deepEqual(await runExport(exportRequest([])), { exported: 0, skipped: 0, partial: 0, failed: [], aborted: false });
    await assertNoSession();
});

test__s13('a new execution rebuilds its pending selection from committed source versions', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('first');
    await seedExportConversation('second');
    assert.equal((await runExport(exportRequest(['first']))).exported, 1);
    // New request supplies selection; neither original run ID nor queue is resumed.
    const result = await runExport(exportRequest(['first', 'second'], { skipUnchanged: true }));
    assert.equal(result.skipped, 1);
    assert.equal(result.exported, 1);
    assert.equal(host.clicks(), 2);
    assert.deepEqual(Object.keys(await listExportRecords(exportKey('first').accountId)).sort(), ['first', 'second']);
    await assertNoSession();
});

test__s13('cancellation before delivery stores no checkpoint or success record', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('cancelled');
    const controller = new AbortController();
    const result = await runExport(exportRequest(['cancelled']), {
        signal: controller.signal, onProgress: () => controller.abort(),
    });
    assert.equal(result.aborted, true);
    assert.equal(result.exported, 0);
    assert.equal(host.clicks(), 0);
    assert.equal(await getExportRecord(exportKey('cancelled')), null);
    await assertNoSession();
});

test__s13('cancelling a later run preserves prior delivery facts', async t => {
    v2ExportHost(t);
    await seedExportConversation('prior');
    await runExport(exportRequest(['prior']));
    const record = await getExportRecord(exportKey('prior'));
    const controller = new AbortController(); controller.abort();
    const result = await runExport(exportRequest(['prior']), { signal: controller.signal });
    assert.equal(result.aborted, true);
    assert.deepEqual(await getExportRecord(exportKey('prior')), record);
    await assertNoSession();
});

test__s13('subsequent delivery replaces the latest record without persistent queue metadata', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('replace', 100);
    await runExport(exportRequest(['replace']));
    await seedExportConversation('replace', 200);
    await runExport(exportRequest(['replace'], { format: 'json' }));
    const record = await getExportRecord(exportKey('replace'));
    assert.equal(record?.format, 'json');
    assert.equal(record?.chatTime, 200);
    assert.deepEqual(Object.keys(record!).sort(), ['chatTime', 'exportedAt', 'format', 'includeAssets', 'status']);
    assert.equal(host.clicks(), 2);
    await assertNoSession();
});
});

__suiteDescribe("user_preferences", () => {
test__s14('userPreferences - developer mode uses the single Application Settings owner', async () => {
    const env = indexStorage(); try {
        assert.equal((await getSettings()).developerMode, false);
        await updateSettings({ developerMode: true }); assert.equal((await getSettings()).developerMode, true);
        await updateSettings({ developerMode: false }); assert.equal((await getSettings()).developerMode, false);
    } finally { env.restore(); }
});
test__s14('Tour completion is not a durable preference and legacy completion flags do not enter Settings', async () => {
    const env = indexStorage({ has_completed_tour: true }); try {
        const settings = await getSettings(); assert.equal(Object.hasOwn(settings, 'tourCompleted'), false);
        assert.equal(Object.hasOwn(settings, 'has_completed_tour'), false); assert.equal(env.writes(), 0);
    } finally { env.restore(); }
});
test__s14('userPreferences - feature version persists through Settings; version comparison retains numeric semantics', async () => {
    const env = indexStorage(); try {
        assert.equal((await getSettings()).lastSeenFeatureVersion, undefined);
        await updateSettings({ lastSeenFeatureVersion: '1.10.0' }); assert.equal((await getSettings()).lastSeenFeatureVersion, '1.10.0');
        assert.equal(isVersionGreater('1.10.0', '1.9.0'), true); assert.equal(isVersionGreater('1.0.0', '1.0.0'), false);
    } finally { env.restore(); }
});
test__s14('informational prompts are durable one-time preferences and honor older acknowledgements', async () => {
    const env = indexStorage({ gemini_suppress_direct_write_prompt: true }); try {
        const initial = await getSettings();
        assert.equal(initial.directWritePromptCompleted, true, 'do not replay the v1 bulk tip');
        assert.equal(initial.takeoutPromptCompleted, undefined);
        await updateSettings({ takeoutPromptCompleted: true });
        const settings = await getSettings();
        assert.equal(settings.takeoutPromptCompleted, true);
        assert.equal(settings.directWritePromptCompleted, true);
    } finally { env.restore(); }
});
test__s14('large batch tip completion persists without old suppression key', async () => {
    const env = indexStorage(); try {
        assert.equal((await getSettings()).directWritePromptCompleted, undefined);
        await updateSettings({ directWritePromptCompleted: true });
        assert.equal((await getSettings()).directWritePromptCompleted, true);
    } finally { env.restore(); }
});
test__s14('userPreferences - position and language roundtrip; ZIP and diagnostics remain outside Settings', async () => {
    const env = indexStorage({ gemini_export_zip: true, diagnostics_enabled: true, gemini_exporter_lang: 'zh' }); try {
        const initial = await getSettings(); assert.equal(initial.language, undefined);
        assert.equal(Object.hasOwn(initial, 'zip'), false); assert.equal(Object.hasOwn(initial, 'diagnostics'), false);
        const patch: Partial<GlobalSettings> = { language: 'zh', badgePosition: { left: 100, top: 200 }, defaultFormat: 'pdf' };
        await updateSettings(patch); const read = await getSettings();
        assert.equal(read.language, 'zh'); assert.deepEqual(read.badgePosition, patch.badgePosition); assert.equal(read.defaultFormat, 'pdf');
        assert.equal(read.enabledDisk, false); assert.equal(read.includeAssets, false);
    } finally { env.restore(); }
});
});
