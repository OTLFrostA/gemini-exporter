// Resource delivery fallback scenario retained under normal full discovery for its Application owner.
import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { admitFixture } from './helpers/admitFixture.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mediaSources, mediaChatId, mediaPrompt, mediaBytes, mediaTime } from './helpers/mediaSourceFixture.js';
import { AssetPipeline } from '../src/core/engine/assetPipeline.js';
import { planExportResources } from '../src/l4/format/resources/planExportResources.js';
import { TakeoutEngine } from '../src/l1/imports/takeoutEngine.js';
import { commitTakeoutData, clearTakeoutData } from '../src/shared/resources/takeout/mediaIndex.js';
import { __clearDomainMemory, storageIdentity } from '../src/l3a/domain/domainStore.js';
import { getDomainResource, cacheDomainResource } from '../src/l3a/domain/resourceContext.js';
import { readFixture, removeFixture } from './helpers/admitFixture.js';
import { findResourceMatch, resourceIdentity } from '../src/l1/parsers/shared/resources/resourceIdentity.js';

beforeEach(() => { __clearDomainMemory(); clearTakeoutData(); });
afterEach(() => { __clearDomainMemory(); clearTakeoutData(); });
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

