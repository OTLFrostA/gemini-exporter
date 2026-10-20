import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureAccountFor, fixtureKey } from './helpers/domainFixture.js';
import { resourceValue } from './helpers/resources.js';
import { validateParserDomain } from '../src/l2/runtimeValidation.js';
import type { DomainAsset } from '../src/l2/conversationDetail.js';
import type { SourceConversationParseResult } from '../src/l1/parsers/parsingResult.js';
import { createSourceResourceContext } from '../src/l1/resources/sourceResources.js';
import { composeDomainDocument } from '../src/l3b/compose/composeDomainDocument.js';
import { collectDocumentResources } from '../src/l3b/ast/resourceReferences.js';
import { prepareExportResources } from '../src/application/export/prepareExportResources.js';

const url = 'https://example.test/shared-image';
const firstBytes = new Uint8Array([11, 22, 33]);
const secondBytes = new Uint8Array([44, 55, 66]);

/** V2 identities and durable locators are L2 facts; network hints/bytes are not. */
function conversation() {
    const key = fixtureKey('resource-boundary');
    const assets: DomainAsset[] = [
        { id: 'image-request-one', kind: 'image', name: 'same.png', mediaType: 'image/png',
            sourceUri: url, generation: { providerRequestId: 'request-one', imageOrdinal: 0 } },
        { id: 'image-request-two', kind: 'image', name: 'same.png', mediaType: 'image/png',
            sourceUri: url, generation: { providerRequestId: 'request-two', imageOrdinal: 0 } },
    ];
    return validateParserDomain({
        index: { key, title: 'Boundary', titleSource: 'provider' },
        detail: { key, quality: { status: 'complete' }, assets, messages: [
            { role: 'assistant', content: [{ type: 'image', assetId: assets[0].id }] },
            { role: 'assistant', content: [{ type: 'image', assetId: assets[1].id }] },
        ] },
    });
}

test('same source URL with distinct generation identities is acquired once per v2 Asset ID', async () => {
    const domain = conversation();
    const original = structuredClone(domain);
    const ids = domain.detail.assets.map(asset => asset.id);
    const document = composeDomainDocument(domain, fixtureAccountFor(domain));
    const references = collectDocumentResources(document);
    assert.deepEqual([...references.imageIds], ids);
    assert.deepEqual([...references.referencedIds], ids);

    const calls: string[] = [];
    const prepared = await prepareExportResources(domain.detail.assets, references.referencedIds, async asset => {
        calls.push(asset.id);
        assert.equal(asset.sourceUri, url);
        assert.equal(asset.name, 'same.png', 'the shared export name is not the acquisition key');
        assert.equal(asset.generation?.providerRequestId, asset.id === ids[0] ? 'request-one' : 'request-two');
        return { bytes: asset.id === ids[0] ? firstBytes : secondBytes };
    });

    assert.deepEqual(calls, ids);
    assert.deepEqual(resourceValue(prepared.get(ids[0])).bytes, firstBytes);
    assert.deepEqual(resourceValue(prepared.get(ids[1])).bytes, secondBytes);
    assert.equal(resourceValue(prepared.get(ids[0])).mediaType, 'image/png', 'v2 preparation retains trusted MIME metadata');
    assert.deepEqual(domain, original);
    assert.deepEqual(composeDomainDocument(domain, fixtureAccountFor(domain)), document);
});

test('prepared bytes and acquisition failures stay outside Domain and Document AST', async () => {
    const domain = conversation();
    const json = JSON.stringify(domain);
    const document = composeDomainDocument(domain, fixtureAccountFor(domain));
    const astJson = JSON.stringify(document);
    const ids = collectDocumentResources(document).referencedIds;
    let acquisitions = 0;

    for (const success of [true, false]) {
        const prepared = await prepareExportResources(domain.detail.assets, ids, async asset => {
            acquisitions++;
            if (!success) throw new Error('HTTP 404 for ' + asset.id);
            return { bytes: firstBytes, mediaType: 'image/png' };
        });
        assert.equal(prepared.size, ids.size, 'each referenced image retains its acquisition outcome');
        for (const [id, outcome] of prepared) {
            if (success) {
                assert.deepEqual(resourceValue(outcome).bytes, firstBytes);
            } else {
                assert.equal(outcome.ok, false, 'failure must not become a successful blank image');
                if (!outcome.ok) {
                    assert.equal(outcome.resourceId, id);
                    assert.equal(outcome.code, 'RESOURCE_UNAVAILABLE');
                    assert.match(outcome.reason, /HTTP 404/);
                }
            }
        }
        assert.equal(JSON.stringify(domain), json);
        assert.equal(JSON.stringify(document), astJson);
        assert.equal(JSON.stringify(composeDomainDocument(domain, fixtureAccountFor(domain))), astJson);
        assert.ok(!json.includes('dataBase64') && !json.includes('failureReason'));
        assert.ok(!astJson.includes('dataBase64') && !astJson.includes('RESOURCE_UNAVAILABLE'));
    }

    const none = await prepareExportResources(domain.detail.assets, new Set<string>(), async () => {
        assert.fail('includeAssets=false must not acquire any bytes');
    });
    assert.equal(none.size, 0);
    assert.equal(acquisitions, ids.size * 2);
    const restored = validateParserDomain(JSON.parse(json));
    assert.deepEqual(composeDomainDocument(restored, fixtureAccountFor(restored)), document);
});

test('inline source bytes are reusable in the same task but never persisted in v2 Domain JSON', async () => {
    const domain = conversation();
    const asset = domain.detail.assets[0];
    const key = domain.index.key;
    const { key: _detailKey, ...detail } = domain.detail;
    const inline = Buffer.from(firstBytes).toString('base64');
    const parsed: SourceConversationParseResult = {
        conversationId: key.conversationId,
        conversation: { index: {}, detail },
        acquisitionHints: { [asset.id]: { dataBase64: inline } },
        diagnostics: [],
    };
    const json = JSON.stringify(domain);
    assert.ok(!json.includes(inline));
    assert.ok(!json.includes('dataBase64'));

    const resources = createSourceResourceContext();
    try {
        // This is the L1 side channel retained only after the Detail candidate is accepted.
        resources.retainParsed(key, parsed);
        const prepared = await prepareExportResources(domain.detail.assets, new Set([asset.id]),
            item => resources.acquire(key, item, undefined, async () => {
                assert.fail('same-task inline bytes must not require a remote fetch');
            }));
        assert.deepEqual(resourceValue(prepared.get(asset.id)).bytes, firstBytes);
        assert.equal(JSON.stringify(domain), json);
        assert.deepEqual(composeDomainDocument(validateParserDomain(JSON.parse(json)), fixtureAccountFor(domain)),
            composeDomainDocument(domain, fixtureAccountFor(domain)));
    } finally {
        resources.release();
    }
    await assert.rejects(resources.acquire(key, asset), /Resource context released/);
});
