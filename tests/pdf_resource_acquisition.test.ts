import test from 'node:test';
import assert from 'node:assert/strict';
import type { GeminiNormalizationInput } from '../src/core/provider/gemini/exportInput.js';
import type { AcquireAssetBytesResult } from '../src/core/engine/assetPipeline.js';
import { parseProviderConversation } from '../src/core/provider/conversationParser.js';
import { composeDomainDocument } from '../src/core/export/document/composeDomainDocument.js';
import { collectDocumentResources } from '../src/core/export/document/resourceReferences.js';
import { preparePdfResources } from '../src/core/export/pdf/prepareResources.js';
import { preparePdfItem } from '../src/core/export/pdf/prepareItem.js';

const url = 'https://example.test/shared-image';
const firstBytes = new Uint8Array([11, 22, 33]);
const secondBytes = new Uint8Array([44, 55, 66]);
function result(bytes: Uint8Array | null): AcquireAssetBytesResult {
    return { ok: !!bytes, bytes, mimeType: 'image/png', failReason: bytes ? '' : 'HTTP 404',
        recoveredFromTakeout: false, localName: 'same.png' };
}
function input() {
    return { id: 'resource-boundary', title: 'Boundary', messages: ['request-one', 'request-two'].map((request, index) => ({
        role: 'model', id: `message-${index}`, content: `![Image](${url})`, attachments: [{
            type: 'image', url, localName: 'assets/same.png', fileName: `original-${index}.png`,
            candidates: [`https://example.test/fallback-${index}`], providerRequestId: request,
            generation: { chatId: 'resource-boundary', generationOrdinal: index, providerRequestId: request, imageOrdinal: 0 },
        }],
    })) };
}

test('same URL with different generation/provider identities acquires separately by Domain asset ID', async () => {
    const raw = input(), original = structuredClone(raw);
    const parsed = parseProviderConversation(raw);
    assert.equal(parsed.conversation.assets.length, 2);
    const ids = parsed.conversation.assets.map(asset => asset.id);
    assert.notEqual(ids[0], ids[1]);
    assert.deepEqual(Object.keys(parsed.acquisitionHints), ids);
    const document = composeDomainDocument(parsed.conversation).document;
    const calls: string[] = [];
    const prepared = await preparePdfResources(parsed.conversation, collectDocumentResources(document).imageIds, parsed.acquisitionHints, {
        acquire: async (id, hint) => {
            calls.push(id);
            assert.equal(hint.url, url);
            assert.equal(hint.localName, 'assets/same.png');
            assert.equal(hint.generation?.providerRequestId, id === ids[0] ? 'request-one' : 'request-two');
            assert.deepEqual(hint.candidates, [`https://example.test/fallback-${id === ids[0] ? 0 : 1}`]);
            return result(id === ids[0] ? firstBytes : secondBytes);
        },
    });
    assert.deepEqual(calls, ids);
    assert.deepEqual(prepared.resources.get(ids[0])?.bytes, firstBytes);
    assert.deepEqual(prepared.resources.get(ids[1])?.bytes, secondBytes);
    // Exercise the actual PDF orchestrator as well, not just the preparation helper.
    const requests: Array<string | undefined> = [];
    const pdf = await preparePdfItem(raw, { assetPipeline: { acquireAssetBytes: async hint => {
        requests.push(hint.generation?.providerRequestId);
        return result(hint.generation?.providerRequestId === 'request-one' ? firstBytes : secondBytes);
    } } });
    assert.equal(pdf.ok, true);
    assert.deepEqual(requests, ['request-one', 'request-two']);
    assert.deepEqual(pdf.document, document);
    assert.deepEqual(pdf.resources.get(ids[0])?.bytes, firstBytes);
    assert.deepEqual(pdf.resources.get(ids[1])?.bytes, secondBytes);
    assert.deepEqual(raw, original);
});

test('acquired bytes, MIME and failure outcomes never enter Domain JSON or change Domain/AST', async () => {
    const raw = input(), original = structuredClone(raw);
    const parsed = parseProviderConversation(raw);
    const domainJson = JSON.stringify(parsed.conversation);
    const hintsJson = JSON.stringify(parsed.acquisitionHints);
    const document = composeDomainDocument(parsed.conversation).document;
    const astJson = JSON.stringify(document);
    const imageIds = collectDocumentResources(document).imageIds;
    for (const bytes of [firstBytes, null]) {
        const prepared = await preparePdfResources(parsed.conversation, imageIds, parsed.acquisitionHints, {
            acquire: async (_id, hint) => {
                // Even a transport that mutates its request must not mutate parser output.
                hint.generation!.prompt = 'transport-only';
                hint.candidates!.push('transport-only');
                return result(bytes);
            },
        });
        assert.equal(JSON.stringify(parsed.conversation), domainJson);
        assert.equal(JSON.stringify(parsed.acquisitionHints), hintsJson);
        assert.equal(JSON.stringify(document), astJson);
        assert.equal(JSON.stringify(composeDomainDocument(parsed.conversation).document), astJson);
        assert.equal(JSON.stringify(parseProviderConversation(raw).conversation), domainJson);
        assert.ok(!domainJson.includes('dataBase64'));
        assert.ok(!domainJson.includes(Buffer.from(firstBytes).toString('base64')));
        for (const resource of prepared.resources.values()) {
            assert.deepEqual(resource.bytes, bytes ?? undefined);
            assert.equal(resource.failureReason, bytes ? undefined : 'HTTP 404');
        }
        const pdf = await preparePdfItem(raw, { assetPipeline: { acquireAssetBytes: async () => result(bytes) } });
        assert.equal(pdf.ok, true);
            assert.equal(JSON.stringify(pdf.document), astJson);
    }
    const restored = JSON.parse(domainJson);
    assert.equal(JSON.stringify(composeDomainDocument(restored).document), astJson);
    assert.deepEqual(raw, original);
});

test('source-provided original bytes survive JSON round-trip and bypass runtime acquisition', async () => {
    const raw: GeminiNormalizationInput = { id: 'inline-fact', messages: [{ role: 'model', content: '',
        images: [{ type: 'image', dataBuffer: firstBytes, mimeType: 'image/png' }] }] };
    const parsed = parseProviderConversation(raw);
    assert.equal(parsed.conversation.assets[0].dataBase64, Buffer.from(firstBytes).toString('base64'));
    const domain = JSON.parse(JSON.stringify(parsed.conversation));
    const document = composeDomainDocument(domain).document;
    const prepared = await preparePdfResources(domain, collectDocumentResources(document).imageIds, parsed.acquisitionHints, {
        acquire: async () => { assert.fail('original inline bytes must skip acquisition'); },
    });
    assert.deepEqual(prepared.resources.get(domain.assets[0].id)?.bytes, firstBytes);
});
