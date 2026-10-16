import { resourceValue } from './helpers/resources.js';
import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { historicalFixture } from './helpers/nativeFixture.js';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationRecordInput } from '../src/core/parsers/legacyStorage/conversationRecord.js';
import { missingResource, type ResourceResult, type ResourceBytes } from '../src/core/resources/resourceResult.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { collectDocumentResources } from '../src/core/document/ast/resourceReferences.js';
import { preparePdfResources } from '../src/core/export/pdf/prepareResources.js';
import { preparePdfItem } from '../src/core/export/pdf/prepareItem.js';

const url = 'https://example.test/shared-image';
const firstBytes = new Uint8Array([11, 22, 33]);
const secondBytes = new Uint8Array([44, 55, 66]);
function result(resourceId: string, bytes: Uint8Array | null): ResourceResult<ResourceBytes> {
    return bytes ? { ok: true, resourceId, value: { bytes, mediaType: 'image/png' } } : missingResource(resourceId, 'HTTP 404', 'HTTP_NOT_FOUND');
}
function input() {
    return { id: 'resource-boundary', url: 'https://gemini.google.com/app/resource-boundary', title: 'Boundary', messages: ['request-one', 'request-two'].map((request, index) => ({
        role: 'model', id: `message-${index}`, content: `![Image](${url})`, attachments: [{
            type: 'image', url, localName: 'assets/same.png', fileName: `original-${index}.png`,
            candidates: [`https://example.test/fallback-${index}`], providerRequestId: request,
            generation: { chatId: 'resource-boundary', generationOrdinal: index, providerRequestId: request, imageOrdinal: 0 },
        }],
    })) };
}

test('same URL with different generation/provider identities acquires separately by Domain asset ID', async () => {
    const raw = input(), original = structuredClone(raw);
    const parsed = historicalFixture(raw, { providerId: 'gemini' });
    assert.equal(parsed.conversation.detail.assets.length, 2);
    const ids = parsed.conversation.detail.assets.map(asset => asset.id);
    assert.notEqual(ids[0], ids[1]);
    assert.deepEqual(Object.keys(parsed.acquisitionHints), ids);
    const document = composeDomainDocument(parsed.conversation).document;
    const calls: string[] = [];
    const prepared = await preparePdfResources((parsed.conversation).detail, collectDocumentResources(document).imageIds, parsed.acquisitionHints, {
        acquire: async (id, hint) => {
            calls.push(id);
            assert.equal(hint.url, url);
            assert.equal(hint.localName, 'assets/same.png');
            assert.equal(hint.generation?.providerRequestId, id === ids[0] ? 'request-one' : 'request-two');
            assert.deepEqual(hint.candidates, [`https://example.test/fallback-${id === ids[0] ? 0 : 1}`]);
            return result(id, id === ids[0] ? firstBytes : secondBytes);
        },
    });
    assert.deepEqual(calls, ids);
    assert.deepEqual(resourceValue(prepared.resources.get(ids[0])).bytes, firstBytes);
    assert.deepEqual(resourceValue(prepared.resources.get(ids[1])).bytes, secondBytes);
    // Exercise the actual PDF orchestrator as well, not just the preparation helper.
    const requests: Array<string | undefined> = [];
    const pdf = await preparePdfItem(historicalFixture(raw), { accountId: '10000000-0000-4000-8000-000000000001', ...({ assetPipeline: { acquireAssetBytes: async hint => {
        requests.push(hint.generation?.providerRequestId);
        return result(hint.assetId, hint.generation?.providerRequestId === 'request-one' ? firstBytes : secondBytes);
    } } }) });
    assert.equal(pdf.ok, true);
    assert.deepEqual(requests, ['request-one', 'request-two']);
    assert.deepEqual(pdf.document, document);
    assert.deepEqual(resourceValue(pdf.resources.get(ids[0])).bytes, firstBytes);
    assert.deepEqual(resourceValue(pdf.resources.get(ids[1])).bytes, secondBytes);
    assert.deepEqual(raw, original);
});

test('acquired bytes, MIME and failure outcomes never enter Domain JSON or change Domain/AST', async () => {
    const raw = input(), original = structuredClone(raw);
    const parsed = historicalFixture(raw, { providerId: 'gemini' });
    const domainJson = JSON.stringify(parsed.conversation);
    const hintsJson = JSON.stringify(parsed.acquisitionHints);
    const document = composeDomainDocument(parsed.conversation).document;
    const astJson = JSON.stringify(document);
    const imageIds = collectDocumentResources(document).imageIds;
    for (const bytes of [firstBytes, null]) {
        const prepared = await preparePdfResources(parsed.conversation.detail, imageIds, parsed.acquisitionHints, {
            acquire: async (id, hint) => {
                // Even a transport that mutates its request must not mutate parser output.
                hint.generation!.prompt = 'transport-only';
                hint.candidates!.push('transport-only');
                return result(id, bytes);
            },
        });
        assert.equal(JSON.stringify(parsed.conversation), domainJson);
        assert.equal(JSON.stringify(parsed.acquisitionHints), hintsJson);
        assert.equal(JSON.stringify(document), astJson);
        assert.equal(JSON.stringify(composeDomainDocument(parsed.conversation).document), astJson);
        assert.ok(!domainJson.includes('dataBase64'));
        assert.ok(!domainJson.includes(Buffer.from(firstBytes).toString('base64')));
        for (const resource of prepared.resources.values()) {
            if (resource.ok) assert.deepEqual(resource.value.bytes, bytes);
            else { assert.equal(bytes, null); assert.equal(resource.reason, 'HTTP 404'); assert.equal(resource.code, 'HTTP_NOT_FOUND'); }
        }
        const pdf = await preparePdfItem(historicalFixture(raw), { accountId: '10000000-0000-4000-8000-000000000001', ...({ assetPipeline: { acquireAssetBytes: async item => result(item.assetId, bytes) } }) });
        assert.equal(pdf.ok, true);
        assert.equal(JSON.stringify(pdf.document), astJson);
        assert.equal(pdf.resources.size, imageIds.size, 'every placed image must retain an acquisition outcome');
        for (const outcome of pdf.resources.values()) {
            if (bytes !== null) {
                assert.equal(outcome.ok, true);
                if (outcome.ok) assert.deepEqual(outcome.value.bytes, bytes);
            } else {
                assert.equal(outcome.ok, false, 'failed resource acquisition must not become a successful blank image');
                if (!outcome.ok) assert.equal(outcome.code, 'HTTP_NOT_FOUND');
            }
        }
    }
    const restored = JSON.parse(domainJson);
    assert.equal(JSON.stringify(composeDomainDocument(restored).document), astJson);
    assert.deepEqual(raw, original);
});

test('source-provided original bytes survive JSON round-trip and bypass runtime acquisition', async () => {
    const raw: ConversationRecordInput = { id: 'inline-fact', messages: [{ role: 'model', content: '',
        images: [{ type: 'image', dataBuffer: firstBytes, mimeType: 'image/png' }] }] };
    const parsed = historicalFixture(raw, { providerId: 'gemini' });
    assert.equal(parsed.conversation.detail.assets[0].dataBase64, Buffer.from(firstBytes).toString('base64'));
    const domain = JSON.parse(JSON.stringify(parsed.conversation));
    const document = composeDomainDocument(domain).document;
    const prepared = await preparePdfResources((domain).detail, collectDocumentResources(document).imageIds, parsed.acquisitionHints, {
        acquire: async () => { assert.fail('original inline bytes must skip acquisition'); },
    });
    assert.deepEqual(resourceValue(prepared.resources.get(domain.detail.assets[0].id)).bytes, firstBytes);
});
