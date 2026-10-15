import { parseIndexMetadata } from '../src/core/parsers/shared/parseIndexMetadata.js';
import { indexFixture } from './helpers/indexFixture.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { __clearDomainMemory, saveDomainConversation, cacheDomainResource, getStoredDomain, storageIdentity, getDomainResource, removeStoredDomain, storedParseResult } from '../src/core/storage/domain/domainStore.js';
import { readStorageDomain } from '../src/core/storage/domain/validate.js';
import { parseLegacyStorageConversation } from '../src/core/parsers/legacyStorage/parseConversation.js';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
import { DOMAIN_MIGRATION_REPORT_KEY, migrateLegacyDomains } from '../src/core/storage/domain/migrateLegacy.js';
import { saveConversationDetail, __clearMemoryStore } from '../src/core/storage/conversationDetailStore.js';
import type { ResourceConversationParseResult } from '../src/core/parsers/parsingResult.js';
import { __setSchemaFrozenForTest } from '../src/core/storage/schemaState.js';

beforeEach(() => { __clearDomainMemory(); __clearMemoryStore(); });
function source(id = 'chat', count = 2): ResourceConversationParseResult {
    return { sourceVersion: 1700000000000, conversation: validateParserDomain({ index: { cloudAvailability: 'unknown', hasTakeoutImport: false, titleSource: 'legacy', providerId: 'gemini', id, title: 'Stored title' }, detail: { completeness: 'unknown', assets: [{ id: 'asset', kind: 'image', sourceUri: 'source.png' }], messages: Array.from({ length: count }, (_, i) => ({ id: `m${i}`, role: 'assistant', model: 'Source model', content: [{ type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', text: `content ${i}` }, { type: 'image', assetId: 'asset' }] }] }], reasoning: [{ type: 'math', source: 'x^2' }], attachmentIds: ['asset'] })) } }), resourceHints: { asset: { archivePath: 'assets/export.png' } }, acquisitionHints: { asset: { url: 'source.png', localName: 'assets/export.png', resolvedUrl: 'https://derived.test/high-res' } }, diagnostics: [{ severity: 'warning', code: 'TEST', message: 'side channel' }] };
}
test('v2 stores structured Domain intact and excludes render/parse transport state', async () => {
    const parsed = source();
    const before = structuredClone(parsed);
    const record = await saveDomainConversation('u0', parsed, [{ assetId: 'asset', bytes: new Uint8Array([1, 2, 3]), sourcePath: 'Takeout/source.png' }]);
    assert.deepEqual(record.conversation, parsed.conversation);
    assert.equal(record.storageVersion, 2);
    assert.equal(record.domainVersion, 2);
    assert.doesNotMatch(JSON.stringify(record), /archivePath|localName|resolvedUrl|diagnostics/);
    assert.deepEqual(parsed, before);
    record.conversation.detail.messages[0].model = 'mutated';
    assert.equal((await getStoredDomain(storageIdentity('gemini', 'u0', 'c_chat')))!.conversation.detail.messages[0].model, 'Source model');
    assert.deepEqual(await getDomainResource(storageIdentity('gemini', 'u0', 'chat'), 'asset'), new Uint8Array([1, 2, 3]));
    assert.deepEqual(storedParseResult((await getStoredDomain(storageIdentity('gemini', 'u0', 'chat')))!), { sourceVersion: parsed.sourceVersion, conversation: parsed.conversation, diagnostics: [], resourceHints: {}, acquisitionHints: { asset: { url: 'source.png' } } });
});
test('accounts and providers isolate identical IDs; non-Gemini IDs remain opaque', async () => {
    assert.deepEqual(storageIdentity('gemini', 'default', 'c_chat'), storageIdentity('gemini', 'u0', 'chat'));
    assert.equal(storageIdentity('future', 'default', 'c_chat').accountSlot, 'default');
    await saveDomainConversation('default', source());
    assert.equal((await getStoredDomain(storageIdentity('gemini', 'u0', 'chat')))!.identity.accountSlot, 'u0');
    const second = source(); second.conversation.index.title = 'Other account';
    await saveDomainConversation('u1', second);
    const other = source('c_chat'); other.conversation.index.providerId = 'future';
    await saveDomainConversation('u0', other);
    assert.equal((await getStoredDomain(storageIdentity('gemini', 'u0', 'chat')))!.conversation.index.title, 'Stored title');
    assert.equal((await getStoredDomain(storageIdentity('gemini', 'u1', 'chat')))!.conversation.index.title, 'Other account');
    assert.equal(await getStoredDomain(storageIdentity('future', 'u0', 'chat')), null);
    assert.ok(await getStoredDomain(storageIdentity('future', 'u0', 'c_chat')));
});
test('partial/older captures cannot truncate current detail; migration retries are idempotent', async () => {
    const full = source('chat', 4); full.conversation.detail.completeness = 'complete';
    await saveDomainConversation('u0', full);
    const shorter = source('chat', 1); shorter.sourceVersion = 1800000000000;
    await saveDomainConversation('u0', shorter);
    const partial = source('chat', 4); partial.conversation.detail.completeness = 'partial';
    await saveDomainConversation('u0', partial);
    assert.deepEqual((await getStoredDomain(storageIdentity('gemini', 'u0', 'chat')))!.conversation, full.conversation);
    await saveDomainConversation('u0', shorter, [], true);
    assert.deepEqual((await getStoredDomain(storageIdentity('gemini', 'u0', 'chat')))!.conversation, full.conversation);
});
test('stable resource bytes survive subsequent detail saves and scoped deletion leaves other accounts intact', async () => {
    await saveDomainConversation('u0', source(), [{ assetId: 'asset', bytes: new Uint8Array([7]) }]);
    await saveDomainConversation('u0', source('chat', 3));
    await saveDomainConversation('u1', source());
    assert.deepEqual(await getDomainResource(storageIdentity('gemini', 'u0', 'chat'), 'asset'), new Uint8Array([7]));
    await removeStoredDomain(storageIdentity('gemini', 'u0', 'chat'));
    assert.equal(await getStoredDomain(storageIdentity('gemini', 'u0', 'chat')), null);
    assert.ok(await getStoredDomain(storageIdentity('gemini', 'u1', 'chat')));
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
    await assert.rejects(saveDomainConversation('u0', source(), [{ assetId: 'missing', bytes: new Uint8Array([1]) }]), /resource binding/);
});
test('legacy-storage is a distinct unified parser format and joins metadata with fuller disk body', () => {
    const metadata = { id: 'c_legacy', title: 'Legacy', timestamp: 1, messageCount: 2, messages: [{ role: 'user', content: 'short' }] };
    const detail = { id: 'legacy', messages: [{ role: 'user', content: 'Question' }, { role: 'model', content: '**Answer**', model: 'Old model', thoughts: 'Reasoning', images: [{ url: 'https://example.test/image.png', type: 'image' }] }] };
    const before = structuredClone({ metadata, detail });
    const result = parseConversation({ format: 'legacy-storage', providerId: 'gemini', data: { metadata, detail } });
    assert.equal(result.conversation.index.id, 'legacy');
    assert.equal(result.conversation.detail.messages.length, 2);
    assert.equal(result.conversation.detail.messages[1].model, 'Old model');
    assert.equal(result.conversation.detail.messages[1].role, 'assistant');
    assert.ok(result.conversation.detail.messages[1].reasoning);
    assert.equal(result.conversation.detail.assets.length, 1);
    assert.deepEqual({ metadata, detail }, before);
    assert.throws(() => parseLegacyStorageConversation({ metadata, detail: { id: 'other' } }, { providerId: 'gemini' }), /identity mismatch/);
});
test('legacy metadata without body reports partial coverage instead of fabricating a transcript', () => {
    const result = parseLegacyStorageConversation({ metadata: { id: 'meta', title: 'Meta', messageCount: 5 } }, { providerId: 'gemini' });
    assert.equal(result.conversation.detail.messages.length, 0);
    assert.equal(result.conversation.detail.completeness, 'partial');
});
test('identical captures retain the current record token', async () => {
    const parsed = source();
    const first = await saveDomainConversation('u0', parsed, [{ assetId: 'asset', bytes: new Uint8Array([1, 2]) }]);
    const again = await saveDomainConversation('u0', parsed);
    assert.equal(again.revision, first.revision);
});
test('future schema freezes writes and deletion while known Domain remains readable', async () => {
    await saveDomainConversation('u0', source());
    const before = globalThis.chrome;
    globalThis.chrome = { storage: { local: { get: async () => ({ gemini_schema_version: 4 }) } } } as unknown as typeof chrome;
    try {
        await assert.rejects(saveDomainConversation('u0', source('new')), { name: 'SchemaFrozenError' });
        await assert.rejects(removeStoredDomain(storageIdentity('gemini', 'u0', 'chat')), { name: 'SchemaFrozenError' });
        assert.ok(await getStoredDomain(storageIdentity('gemini', 'u0', 'chat')));
        assert.equal(await getStoredDomain(storageIdentity('gemini', 'u0', 'new')), null);
    } finally { globalThis.chrome = before; __setSchemaFrozenForTest(false); }
});
test('legacy upgrade does not guess ownership for shared IDs or orphan detail; source data survives', async () => {
    const before = globalThis.chrome;
    const values: Record<string, unknown> = { gemini_conversations: ([{ id: 'shared', title: 'Account A', timestamp: 1 }]).map(indexFixture), gemini_conversations_u1: ([{ id: 'shared', title: 'Account B', timestamp: 2 }]).map(indexFixture), gemini_schema_version: 1 };
    globalThis.chrome = { storage: { local: { get: async () => structuredClone(values), set: async (v: Record<string, unknown>) => { Object.assign(values, v); } } } } as unknown as typeof chrome;
    try {
        await saveConversationDetail('shared', { messages: [{ role: 'user', content: 'Unscoped' }] });
        await saveConversationDetail('orphan', { messages: [{ role: 'user', content: 'Orphan' }] });
        const report = await migrateLegacyDomains();
        assert.equal(report.converted, 2);
        assert.equal(report.issues.filter(i => i.code === 'LEGACY_AMBIGUOUS_ACCOUNT').length, 2);
        assert.ok(report.issues.some(i => i.code === 'LEGACY_ORPHAN_DETAIL'));
        assert.equal((await getStoredDomain(storageIdentity('gemini', 'u0', 'shared')))!.conversation.detail.messages.length, 0);
        assert.equal((await getStoredDomain(storageIdentity('gemini', 'u1', 'shared')))!.conversation.index.title, 'Account B');
        assert.deepEqual(values.gemini_conversations, [indexFixture({ id: 'shared', title: 'Account A', timestamp: 1 })]);
    } finally { globalThis.chrome = before; }
});

test('acquired bytes bind to source identity, survive captures and are erased on scoped deletion', async () => {
    const identity = storageIdentity('gemini', 'u0', 'chat');
    await saveDomainConversation('u0', source());
    await saveDomainConversation('u1', source());
    await cacheDomainResource(identity, 'asset', 'source.png', new Uint8Array([9]));
    await cacheDomainResource(storageIdentity('gemini', 'u1', 'chat'), 'asset', 'source.png', new Uint8Array([8]));
    await saveDomainConversation('u0', source('chat', 3));
    assert.deepEqual(await getDomainResource(identity, 'asset'), new Uint8Array([9]));
    const changed = source('chat', 4); changed.conversation.detail.assets[0].sourceUri = 'changed.png';
    await saveDomainConversation('u0', changed);
    assert.equal(await getDomainResource(identity, 'asset'), null);
    await removeStoredDomain(identity);
    await saveDomainConversation('u0', source());
    assert.equal(await getDomainResource(identity, 'asset'), null);
    assert.deepEqual(await getDomainResource(storageIdentity('gemini', 'u1', 'chat'), 'asset'), new Uint8Array([8]));
});

test('migration retries cannot resurrect scoped deleted bodies, while a fresh capture can restore them', async () => {
    const identity = storageIdentity('gemini', 'u0', 'chat');
    await saveDomainConversation('u0', source(), [], true);
    await removeStoredDomain(identity);
    assert.equal(await saveDomainConversation('u0', source(), [], true), null);
    assert.equal(await getStoredDomain(identity), null);
    await saveDomainConversation('u1', source(), [], true);
    assert.ok(await getStoredDomain(storageIdentity('gemini', 'u1', 'chat')));
    await saveDomainConversation('u0', source());
    assert.ok(await getStoredDomain(identity));
});


test('larger partial and unknown captures protect complete body while title arbitration remains independent', async () => {
    const full = source('chat', 2);
    full.conversation.detail.completeness = 'complete';
    full.conversation.index.titleSource = 'dom';
    await saveDomainConversation('u0', full);
    const more = source('chat', 5);
    more.conversation.detail.completeness = 'partial';
    more.sourceVersion = 1900000000000;
    more.conversation.index.title = 'RPC authoritative title';
    more.conversation.index.titleSource = 'rpc';
    await saveDomainConversation('u0', more);
    const stored = (await getStoredDomain(storageIdentity('gemini', 'u0', 'chat')))!.conversation;
    assert.deepEqual(stored.detail.messages, full.conversation.detail.messages);
    assert.equal(stored.detail.completeness, 'complete');
    assert.equal('updatedAt' in stored, false);
    assert.equal((await getStoredDomain(storageIdentity('gemini', 'u0', 'chat')))!.savedAt, full.sourceVersion);
    assert.equal(stored.index.title, more.conversation.index.title);
    assert.equal(stored.index.titleSource, 'rpc');
    more.conversation.detail.completeness = 'unknown';
    more.conversation.index.title = 'Weaker incoming title';
    more.conversation.index.titleSource = 'takeout';
    await saveDomainConversation('u0', more);
    const again = (await getStoredDomain(storageIdentity('gemini', 'u0', 'chat')))!.conversation;
    assert.deepEqual(again, stored);
});


test('placeholder sources never displace a real stored title, even when the incoming body wins', async () => {
    for (const title of ['Gemini', 'Google Gemini', 'New chat', '新对话', 'Untitled', 'Untitled Chat', '未命名对话']) {
        const id = `title-${title}`;
        const old = source(id, 2);
        old.conversation.index.title = 'Research question from Takeout';
        old.conversation.index.titleSource = 'takeout';
        await saveDomainConversation('u0', old);
        const incoming = source(id, 3);
        incoming.conversation.index = parseIndexMetadata({ ...incoming.conversation.index, title, titleSource: 'rpc' });
        await saveDomainConversation('u0', incoming);
        const stored = (await getStoredDomain(storageIdentity('gemini', 'u0', id)))!.conversation;
        assert.equal(stored.index.title, old.conversation.index.title, title);
        assert.equal(stored.index.titleSource, 'takeout', title);
        assert.deepEqual(stored.detail.messages, incoming.conversation.detail.messages);
    }
});

test('real titles replace higher-ranked placeholders without rejecting short or Takeout prompt titles', async () => {
    for (const title of ['A', 'Research question from Takeout']) {
        const id = `real-${title}`;
        const old = source(id, 2);
        old.conversation.index = parseIndexMetadata({ ...old.conversation.index, title: 'Gemini', titleSource: 'rpc' });
        await saveDomainConversation('u0', old);
        const incoming = source(id, 1);
        incoming.conversation.index.title = title;
        incoming.conversation.index.titleSource = 'takeout';
        await saveDomainConversation('u0', incoming);
        const stored = (await getStoredDomain(storageIdentity('gemini', 'u0', id)))!.conversation;
        assert.equal(stored.index.title, title);
        assert.equal(stored.index.titleSource, 'takeout');
        assert.deepEqual(stored.detail.messages, old.conversation.detail.messages);
    }
});


test('stored repeated source message IDs export without losing or rewriting source messages', async () => {
    const parsed = source('duplicate-identities', 3);
    parsed.conversation.detail.messages.forEach(message => { message.id = 'same'; });
    const original = structuredClone(parsed.conversation);
    await saveDomainConversation('u0', parsed);
    const stored = await getStoredDomain(storageIdentity('gemini', 'u0', parsed.conversation.index.id));
    assert.ok(stored);
    const document = composeDomainDocument(storedParseResult(stored).conversation).document;
    assert.deepEqual(document.messages.map(message => message.id), ['msg-0', 'msg-1', 'msg-2']);
    assert.equal(document.messages.length, original.detail.messages.length);
    assert.deepEqual(stored.conversation, original);
});


test('a partial capture fills an empty metadata placeholder without replacing existing nonpartial bodies', async () => {
    const identity = storageIdentity('gemini', 'u0', 'dom-capture');
    const placeholder = source('dom-capture', 0);
    await saveDomainConversation('u0', placeholder);
    const captured = source('dom-capture', 2);
    captured.conversation.detail.completeness = 'partial';
    await saveDomainConversation('u0', captured);
    assert.deepEqual((await getStoredDomain(identity))!.conversation.detail.messages, captured.conversation.detail.messages);
    const full = source('dom-capture', 3);
    await saveDomainConversation('u0', full);
    const fragment = source('dom-capture', 5);
    fragment.conversation.detail.completeness = 'partial';
    await saveDomainConversation('u0', fragment);
    assert.deepEqual((await getStoredDomain(identity))!.conversation.detail.messages, full.conversation.detail.messages);
});


test('migration report persistence failure does not reject an already migrated Domain', async () => {
    const previous = globalThis.chrome;
    const values: Record<string, unknown> = { gemini_schema_version: 1,
        gemini_conversations: [indexFixture({ id: 'report_failure', title: 'Retained source' })] };
    globalThis.chrome = { storage: { local: {
        get: async () => structuredClone(values),
        set: async (patch: Record<string, unknown>) => {
            if (DOMAIN_MIGRATION_REPORT_KEY in patch) throw new Error('Diagnostic report storage unavailable');
            Object.assign(values, patch);
        },
    } } } as unknown as typeof chrome;
    try {
        const report = await migrateLegacyDomains();
        assert.equal(report.converted, 1);
        assert.equal((await getStoredDomain(storageIdentity('gemini', 'u0', 'report_failure')))?.conversation.index.title, 'Retained source');
    } finally { globalThis.chrome = previous; }
});
