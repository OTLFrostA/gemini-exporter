import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetPipeline } from '../src/core/engine/assetPipeline.js';
import type { ResourceRequest } from '../src/core/resources/resourceAcquisition.js';
import { TakeoutEngine } from '../src/core/engine/takeoutEngine.js';
import { commitTakeoutData, clearTakeoutData } from '../src/core/resources/takeout/mediaIndex.js';
import { planExportResources } from '../src/core/export/assets/planExportResources.js';
import type { ResourceConversationParseResult } from '../src/core/parsers/parsingResult.js';
import type { DomainAsset } from '../src/core/domain/conversationDetail.js';

const chatId = 'lookup-regression';
const generation = { generationOrdinal: 2, time: 1700000000123, prompt: 'Draw a diagram', imageCount: 2 };
const source = (id: string, ordinal?: number): DomainAsset => ({ id, kind: 'image', name: 'diagram.png',
    sourceUri: `Takeout/Gemini Apps/${id}.png`, generation: { ...generation, imageOrdinal: ordinal } });
const native = (assets: DomainAsset[]): ResourceConversationParseResult => ({ account: fixtureAccount(),
    sourceVersion: 1700000000000, conversation: validateParserDomain({ index: { key: fixtureKey(String(chatId), 'gemini'),   titleSource: "derived",   title: 'Lookup' }, detail: { key: fixtureKey(String(chatId), 'gemini'), quality: { status: 'partial' }, messages: [], assets } }),
    diagnostics: [], acquisitionHints: {}, resourceHints: Object.fromEntries(assets.map(asset =>
        [asset.id, { archivePath: asset.sourceUri!! }])),
});

async function recover(assets: DomainAsset[], item: ResourceRequest, options: { localOnly?: boolean } = {}) {
    const slot = '10000000-0000-4000-8000-000000000001';
    let downloads = 0;
    const written: Array<{ path: string; bytes: Uint8Array }> = [];
    // Populate only the Takeout index: the persistent resource cache is empty.
    commitTakeoutData(slot, { convCache: { [chatId]: native(assets) }, globalMedia: Object.fromEntries(assets.map((asset, i) =>
        [asset.sourceUri!!, { async: async () => new Uint8Array([i + 1, 42]) }])), mediaMap: {} });
    try {
        const pipeline = new AssetPipeline({ accountId: slot, takeoutEngine: TakeoutEngine,
            fetchAsset: async () => { downloads++; return { success: false, error: 'network unavailable' }; },
            writeFileDirect: async (path, bytes) => { written.push({ path, bytes }); } });
        const result = await pipeline.processAsset(item, { id: chatId }, { isImage: true, maxRetries: 0, ...options });
        return { result, written, downloads };
    } finally { clearTakeoutData(slot); }
}

test('Takeout lookup through AssetPipeline preserves source identity when export planning renames the file', async () => {
    const asset: DomainAsset = { id: 'original-resource', kind: 'image', name: 'diagram.png', sourceUri: 'Takeout/Gemini Apps/diagram.png' };
    const plan = await planExportResources(native([asset]));
    const item = { ...plan.assets[0].item, resolvedUrl: 'https://offline.test/diagram.png' };
    assert.notEqual(item.localName, asset.sourceUri!);
    const recovered = await recover([asset], item);
    assert.equal(recovered.downloads, 1);
    assert.equal(recovered.result.ok, true);
    assert.deepEqual(recovered.written, [{ path: item.localName, bytes: new Uint8Array([1, 42]) }]);
    if (!recovered.result.ok) throw new Error('expected offline recovery');
    assert.equal(recovered.result.resourceId, item.assetId, 'recovery must retain requested Domain identity');
    assert.equal(recovered.result.value.path, item.localName, 'writer path must match the planned export destination');

    const offlineOnly = await recover([asset], item, { localOnly: true });
    assert.equal(offlineOnly.downloads, 0, 'offline exports must never attempt a remote download');
    assert.equal(offlineOnly.result.ok, true);
    assert.deepEqual(offlineOnly.written, [{ path: item.localName, bytes: new Uint8Array([1, 42]) }]);
});

test('Takeout lookup through AssetPipeline uses the exact source URI when asset IDs differ', async () => {
    const asset = { ...source('takeout-id'), generation: undefined };
    const recovered = await recover([asset], { assetId: 'online-id', sourceUrl: asset.sourceUri!,
        resolvedUrl: 'https://offline.test/image.png', localName: 'assets/abcdef_diagram.png' });
    assert.equal(recovered.result.ok, true);
    assert.deepEqual(recovered.written, [{ path: 'assets/abcdef_diagram.png', bytes: new Uint8Array([1, 42]) }]);
    if (!recovered.result.ok) throw new Error('expected source-URI recovery');
    assert.equal(recovered.result.resourceId, 'online-id',
        'the Takeout source identity must not replace the requested Domain asset identity');
});

test('Takeout lookup through AssetPipeline links different IDs by a unique generation event and image ordinal', async () => {
    const recovered = await recover([source('takeout-0', 0), source('takeout-1', 1)], {
        assetId: 'online-1', sourceUrl: 'https://offline.test/online.png', localName: 'assets/abcdef_diagram.png',
        generation: { ...generation, time: 1700000000999, imageOrdinal: 1 } });
    assert.equal(recovered.downloads, 1);
    assert.equal(recovered.result.ok, true);
    assert.deepEqual(recovered.written[0].bytes, new Uint8Array([2, 42]));
});

test('Takeout lookup through AssetPipeline refuses ambiguous images, missing ordinals, and weak filename evidence', async () => {
    for (const assets of [[source('one', 0), source('two', 0)], [source('one'), source('two', 1)], [source('one'), source('two', 0)]]) {
        const recovered = await recover(assets, { assetId: 'online', sourceUrl: 'https://offline.test/image.png',
            localName: 'assets/abcdef_diagram.png', generation: { ...generation, imageOrdinal: 0 } });
        assert.equal(recovered.result.ok, false);
        assert.deepEqual(recovered.written, []);
    }
    const recovered = await recover([{ ...source('one'), generation: undefined }], {
        assetId: 'online', sourceUrl: 'https://offline.test/one.png', localName: 'Takeout/Gemini Apps/one.png' });
    assert.equal(recovered.result.ok, false, 'neither output path nor URI basename establishes ownership');
    assert.deepEqual(recovered.written, []);
});

test('Takeout lookup through AssetPipeline rejects conflicting source and generation evidence', async () => {
    const assets = [source('takeout-0', 0), source('takeout-1', 1)];
    const base = { assetId: 'takeout-0', sourceUrl: 'https://offline.test/image.png', localName: 'assets/diagram.png' };
    for (const item of [
        { ...base, sourceUrl: assets[1].sourceUri! },
        { ...base, generation: { ...generation, imageOrdinal: 1 } },
        { ...base, generation: { ...generation, imageOrdinal: 0, prompt: 'Another prompt' } },
        { ...base, assetId: 'online', generation },
    ]) {
        const recovered = await recover(assets, item);
        assert.equal(recovered.result.ok, false);
        assert.deepEqual(recovered.written, []);
    }
});

test('Takeout lookup through AssetPipeline requires a unique event before selecting its image ordinal', async () => {
    const assets = [
        { ...source('event-a', 0), generation: { ...generation, imageOrdinal: 0, providerRequestId: 'request-a' } },
        { ...source('event-b', 1), generation: { ...generation, imageOrdinal: 1, providerRequestId: 'request-b' } },
    ];
    const item = { assetId: 'online', sourceUrl: 'https://offline.test/image.png', localName: 'assets/diagram.png',
        generation: { ...generation, imageOrdinal: 1 } };
    const ambiguous = await recover(assets, item);
    assert.equal(ambiguous.result.ok, false);
    assert.deepEqual(ambiguous.written, []);
    const exactRequest = await recover(assets, { ...item, generation: { ...item.generation, providerRequestId: 'request-b' } });
    assert.equal(exactRequest.result.ok, true);
    assert.deepEqual(exactRequest.written[0].bytes, new Uint8Array([2, 42]));
});

test('Takeout lookup through AssetPipeline allows exact identity without inferring an unknown image ordinal', async () => {
    const asset = source('takeout-id');
    const recovered = await recover([asset], { assetId: asset.id, sourceUrl: asset.sourceUri!,
        resolvedUrl: 'https://offline.test/image.png', localName: 'assets/diagram.png', generation });
    assert.equal(recovered.result.ok, true);
    assert.deepEqual(recovered.written[0].bytes, new Uint8Array([1, 42]));
});

test('Takeout lookup through AssetPipeline resolves a unique single-image event without explicit ordinals', async () => {
    const asset = { ...source('takeout-id'), generation: { ...generation, imageCount: 1 } };
    const recovered = await recover([asset], { assetId: 'online-id', sourceUrl: 'https://offline.test/image.png',
        localName: 'assets/diagram.png', generation: { ...generation, imageCount: 1 } });
    assert.equal(recovered.result.ok, true);
    assert.deepEqual(recovered.written[0].bytes, new Uint8Array([1, 42]));
});
