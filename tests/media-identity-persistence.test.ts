import { saveDomainConversation } from '../src/core/domain/snapshotAdmission.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mediaSources, mediaChatId, mediaPrompt, mediaBytes, mediaTime } from './helpers/mediaSourceFixture.js';
import { AssetPipeline } from '../src/core/engine/assetPipeline.js';
import { planExportResources } from '../src/core/export/assets/planExportResources.js';
import { TakeoutEngine } from '../src/core/engine/takeoutEngine.js';
import { commitTakeoutData, clearTakeoutData } from '../src/core/resources/takeout/mediaIndex.js';
import { __clearDomainMemory, getDomainResource, getStoredDomain, cacheDomainResource, storageIdentity, removeStoredDomain } from '../src/core/storage/domain/domainStore.js';
import { findResourceMatch, resourceIdentity } from '../src/core/parsers/shared/resources/resourceIdentity.js';

beforeEach(() => { __clearDomainMemory(); clearTakeoutData(); });
afterEach(() => { __clearDomainMemory(); clearTakeoutData(); });
test('real RPC turns expose only source-authored event time/prompt and single-image position', () => {
    const { online, offline } = mediaSources();
    const onlineImage = online.conversation.detail.assets[0];
    const offlineImage = offline.conversation.detail.assets.find(a => a.generation?.prompt === mediaPrompt)!;
    assert.equal(onlineImage.generation?.time, mediaTime + 123);
    assert.equal(onlineImage.generation?.prompt, mediaPrompt);
    assert.equal(onlineImage.generation?.providerRequestId, 'r_request-9');
    assert.equal(onlineImage.generation?.imageCount, 1);
    assert.equal(onlineImage.generation?.imageOrdinal, 0);
    assert.notEqual(onlineImage.generation?.generationOrdinal, offlineImage.generation?.generationOrdinal);
    assert.notEqual(onlineImage.id, offlineImage.id);
    assert.notEqual(onlineImage.sourceUri, offlineImage.sourceUri);
    for (const options of [{ noTime: true }, { noPrompt: true }]) {
        const image = mediaSources(options).online.conversation.detail.assets[0];
        assert.equal(options.noTime ? image.generation?.time : image.generation?.prompt, undefined);
    }
    for (const image of mediaSources({ multi: true }).online.conversation.detail.assets) assert.equal(image.generation?.imageOrdinal, undefined, 'a traversal index is not a stable source ordinal');
});

test('real parsed sources recover renamed exports and refuse insufficient or ambiguous event evidence through AssetPipeline', async () => {
    for (const options of [{}, { noTime: true }, { noPrompt: true }, { multi: true }, { duplicate: true }]) {
        const { online, offline, files } = mediaSources(options);
        commitTakeoutData('10000000-0000-4000-8000-000000000001', { convCache: { [mediaChatId]: offline }, globalMedia: files });
        const plan = await planExportResources(online);
        const pipeline = new AssetPipeline({ accountId: '10000000-0000-4000-8000-000000000001', takeoutEngine: TakeoutEngine,
            fetchAsset: async () => ({ success: false, error: 'offline' }) });
        const result = await pipeline.acquireAssetBytes(plan.assets[0].item, { id: mediaChatId }, { isImage: true, maxRetries: 0 });
        assert.equal(result.ok, Object.keys(options).length === 0);
        if (result.ok) assert.deepEqual(result.value.bytes, mediaBytes);
        else assert.ok(result.reason);
    }
});

for (const order of ['online-first', 'takeout-first'] as const) {
    test(`DomainStore ${order}: retain the complete body and independently fill proven resource bytes`, async () => {
        const { online, offline, resources } = mediaSources();
        const snapshot = structuredClone(online.conversation);
        if (order === 'online-first') await saveDomainConversation('10000000-0000-4000-8000-000000000001', online);
        await saveDomainConversation('10000000-0000-4000-8000-000000000001', offline, resources);
        if (order === 'takeout-first') await saveDomainConversation('10000000-0000-4000-8000-000000000001', online);
        const identity = storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', mediaChatId);
        assert.deepEqual((await getStoredDomain(identity))!.conversation.detail, snapshot.detail);
        assert.equal(Reflect.get((await getStoredDomain(identity))!.conversation.index ?? {}, 'hasTakeoutImport'), undefined);
        assert.equal((await getStoredDomain(identity))!.conversation.index.title, snapshot.index.title);
        assert.deepEqual(await getDomainResource(identity, online.conversation.detail.assets[0].id), mediaBytes);
        await saveDomainConversation('10000000-0000-4000-8000-000000000001', offline, resources);
        assert.deepEqual((await getStoredDomain(identity))!.conversation.detail, snapshot.detail);
        assert.equal(Reflect.get((await getStoredDomain(identity))!.conversation.index ?? {}, 'hasTakeoutImport'), undefined);
        assert.equal((await getStoredDomain(identity))!.conversation.index.title, snapshot.index.title);
        assert.deepEqual(await getDomainResource(identity, online.conversation.detail.assets[0].id), mediaBytes);
        assert.equal(await getDomainResource(storageIdentity('gemini', '10000000-0000-4000-8000-000000000002', mediaChatId), online.conversation.detail.assets[0].id), null);
    });
}

test('DomainStore rebinds existing byte-cache entries only with unique event proof', async () => {
    const { online, offline } = mediaSources();
    await saveDomainConversation('10000000-0000-4000-8000-000000000001', offline);
    const original = offline.conversation.detail.assets.find(a => a.generation?.prompt === mediaPrompt)!;
    const identity = storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', mediaChatId);
    await cacheDomainResource(identity, original.id, original.sourceUri!!, mediaBytes);
    await saveDomainConversation('10000000-0000-4000-8000-000000000001', online);
    assert.deepEqual(await getDomainResource(identity, online.conversation.detail.assets[0].id), mediaBytes);
    const changed = structuredClone(online); changed.conversation.detail.assets[0].sourceUri! = 'https://lh3.googleusercontent.com/another';
    changed.conversation.detail.assets[0].generation!.prompt = 'Unrelated prompt';
    changed.acquisitionHints = {};
    await saveDomainConversation('10000000-0000-4000-8000-000000000001', changed);
    assert.equal(await getDomainResource(identity, changed.conversation.detail.assets[0].id), null);
});

test('production RPC request conflicts reject cross-source reuse even with identical event timestamps and prompts', async () => {
    const first = mediaSources().online;
    const second = mediaSources({ requestId: 'r_other-request', uriSuffix: '-different' }).online;
    assert.equal(findResourceMatch(mediaChatId, resourceIdentity(first.conversation.detail.assets[0], first.conversation.index.key.conversationId), second.conversation.detail.assets.map(asset => resourceIdentity(asset, second.conversation.index.key.conversationId))), null);
    await saveDomainConversation('10000000-0000-4000-8000-000000000001', first, [{ assetId: first.conversation.detail.assets[0].id, bytes: mediaBytes }]);
    await saveDomainConversation('10000000-0000-4000-8000-000000000001', second);
    assert.equal(await getDomainResource(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', mediaChatId), second.conversation.detail.assets[0].id), null);
});

test('byte-cache reuse cannot bypass conflicting event evidence when an asset ID and URI are reused', async () => {
    const { online } = mediaSources();
    const identity = storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', mediaChatId);
    const image = online.conversation.detail.assets[0];
    await saveDomainConversation('10000000-0000-4000-8000-000000000001', online);
    await cacheDomainResource(identity, image.id, image.sourceUri!!, mediaBytes);
    const changed = structuredClone(online);
    changed.conversation.detail.assets[0].generation!.prompt = 'A different event';
    await saveDomainConversation('10000000-0000-4000-8000-000000000001', changed);
    assert.equal(await getDomainResource(identity, image.id), null);
});

test('DomainStore refuses ambiguous matches in either direction and deletion erases rebound caches', async () => {
    for (const options of [{ duplicate: true }, { multi: true }, { noTime: true }, { noPrompt: true }]) {
        __clearDomainMemory();
        const { online, offline, resources } = mediaSources(options);
        await saveDomainConversation('10000000-0000-4000-8000-000000000001', online);
        await saveDomainConversation('10000000-0000-4000-8000-000000000001', offline, resources);
        assert.equal(await getDomainResource(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', mediaChatId), online.conversation.detail.assets[0].id), null);
    }
    __clearDomainMemory();
    const { online, offline, resources } = mediaSources();
    await saveDomainConversation('10000000-0000-4000-8000-000000000001', offline, resources);
    await saveDomainConversation('10000000-0000-4000-8000-000000000001', online);
    const identity = storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', mediaChatId);
    assert.deepEqual(await getDomainResource(identity, online.conversation.detail.assets[0].id), mediaBytes);
    await removeStoredDomain(identity);
    await saveDomainConversation('10000000-0000-4000-8000-000000000001', online);
    assert.equal(await getDomainResource(identity, online.conversation.detail.assets[0].id), null);
});

test('URI-less imported resources remain retrievable without carrying inline bytes into current or subsequent saves', async () => {
    const parsed = mediaSources().online;
    const asset = parsed.conversation.detail.assets[0]; delete asset.sourceUri;
    parsed.acquisitionHints = {};
    const identity = storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', mediaChatId);
    const initial = await saveDomainConversation('10000000-0000-4000-8000-000000000001', parsed, [{ assetId: asset.id, bytes: mediaBytes }]);
    assert.equal(initial.resources.length, 0);
    parsed.conversation.index.title = 'Continued conversation';
    const continued = await saveDomainConversation('10000000-0000-4000-8000-000000000001', parsed);
    assert.equal(continued.resources.length, 0);
    assert.deepEqual(await getDomainResource(identity, asset.id), mediaBytes);
});

test('current resource receipts update archive paths while repeated receipts stay idempotent', async () => {
    const parsed = mediaSources().online;
    const resource = { assetId: parsed.conversation.detail.assets[0].id, sourcePath: 'archive/original.png', bytes: mediaBytes };
    await saveDomainConversation('10000000-0000-4000-8000-000000000001', parsed, [resource]);
    resource.sourcePath = 'archive/relocated.png';
    const relocated = await saveDomainConversation('10000000-0000-4000-8000-000000000001', parsed, [resource]);
    assert.equal(relocated.resourceDigests?.[resource.assetId]?.sourcePath, 'archive/relocated.png');
    const repeated = await saveDomainConversation('10000000-0000-4000-8000-000000000001', parsed, [resource]);
    assert.equal(repeated.revision, relocated.revision);
    assert.deepEqual(await getDomainResource(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', mediaChatId), resource.assetId), mediaBytes);
});
