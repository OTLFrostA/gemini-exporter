import { historicalFixture, historicalFixtureDomain } from './helpers/nativeFixture.js';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
import { collectDocumentResources } from '../src/core/document/ast/resourceReferences.js';
import { messageAssets } from './helpers/domainAssets.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Conversation } from '../src/types/conversation.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import { normalizeLegacyAttachments } from '../src/core/parsers/shared/resources/resolveResources.js';
import { structuredBodyAttachments } from '../src/core/compatibility/gemini/contentAdapter.js';
import { composeFixture } from './helpers/documentFixture.js';

const metadata = { id: 'resources', title: 'Resources', timestamp: null };
const generation = { chatId: metadata.id, providerRequestId: 'abcdef0123456789', time: 1700000000123,
    prompt: 'Draw a lake', generationOrdinal: 2, imageCount: 1, imageOrdinal: 0, turnId: 'turn-2' };

async function assertRoundTrip(input: Conversation): Promise<DomainConversationDetail> {
    const original = structuredClone(input);
    const { conversation: domain, resourceHints } = historicalFixture(input);
    const serialized: DomainConversationDetail = JSON.parse(JSON.stringify(domain));
    const [raw, semantic, restored] = await Promise.all([
        composeFixture(historicalFixture(input, { providerId: 'gemini' }).conversation, resourceHints), composeFixture(domain, resourceHints), composeFixture(serialized, resourceHints),
    ]);
    assert.deepEqual(semantic.document, raw.document);
    assert.deepEqual(restored.document, semantic.document);
    assert.deepEqual(restored.diagnostics, semantic.diagnostics);
    assert.deepEqual(input, original);
    for (const message of domain.messages) {
        assert.equal('images' in message, false);
        assert.equal('documents' in message, false);
    }
    return domain;
}

test('all legacy resource paths produce one Domain resource, with document and generated metadata intact', async () => {
    const structuredContent = JSON.parse(readFileSync(join(__dirname, 'fixtures/provider/structured_rpc/b-stack-structured.json'), 'utf8'));
    const [image] = structuredBodyAttachments({ structuredContent });
    assert.ok(image.sourceUrl);
    const document = { type: 'file', id: 'report-id', title: 'Report', createdAt: null,
        localName: 'files/report.md', url: 'https://example.test/report', chipUrl: 'https://example.test/chip',
        contentMarkdown: '# Report', sections: ['Intro'], links: [{ title: 'Source', url: 'https://example.test/source' }],
        candidates: ['https://example.test/report', 'https://example.test/preview'], hasFabricatedText: false };
    const input: Conversation = { ...metadata, messages: [{ role: 'assistant', content: 'fallback', structuredContent,
        attachments: [{ type: 'file', localName: document.localName, url: document.url }, { ...image, isGenerated: true, generation }],
        images: [{ type: 'image', url: image.sourceUrl, providerRequestId: generation.providerRequestId, imageOrdinal: 0 }],
        documents: [document, structuredClone(document)],
    }] };
    const domain = await assertRoundTrip(input);
    const resources = messageAssets(domain, 0)!;
    assert.equal(resources.length, 2);
    assert.equal(resources[0].name, 'Report');
    assert.deepEqual(resources[0].source, { uri: document.url });
    assert.deepEqual(resources[0].document, {
        id: document.id, createdAt: null, chipUrl: document.chipUrl, contentMarkdown: document.contentMarkdown,
        sections: document.sections, links: document.links, candidates: document.candidates, hasFabricatedText: false,
    });
    assert.deepEqual(resources[1].generation, generation);
    assert.equal(resources[1].generated, true);
    assert.equal('sourceEvidence' in resources[1], false);
    assert.equal('token' in resources[1], false);
    assert.notEqual(resources[0].document?.sections, document.sections);
    assert.notEqual(resources[0].document!.links![0], document.links[0]);
    assert.notEqual(resources[1].generation, generation);
});

test('missing and inline documents deduplicate by values, never shared object identity', async () => {
    for (const contentMarkdown of [undefined, '# Inline report']) {
        const document = { type: 'file', fileName: 'report.md', sections: ['Intro'], contentMarkdown };
        const input: Conversation = { ...metadata, messages: [{ role: 'assistant', content: '',
            attachments: [structuredClone(document)], documents: [structuredClone(document)] }] };
        const domain = await assertRoundTrip(input);
        assert.equal(messageAssets(domain, 0)?.length, 1);
        assert.deepEqual(messageAssets(domain, 0)?.[0].document?.sections, ['Intro']);
    }
});

test('document IDs reconcile metadata without any downloadable reference', async () => {
    const document = { type: 'file', id: 'report', title: 'Report' };
    const domain = await assertRoundTrip({ ...metadata, messages: [{ role: 'assistant', content: '',
        attachments: [document],
        documents: [{ type: 'doc', id: 'report', sections: ['Intro'], links: [], createdAt: 1700000000123 }],
    }] });
    assert.equal(messageAssets(domain, 0)?.length, 1);
    assert.equal(messageAssets(domain, 0)?.[0].document?.id, 'report');
    assert.deepEqual(messageAssets(domain, 0)?.[0].document?.sections, ['Intro']);
});

test('merging document aliases preserves repeated metadata entries and supplements missing values', () => {
    const link = { title: 'Source', url: 'https://example.test/source' };
    const source = { attachments: [{ type: 'file', id: 'report', sections: ['Intro', 'Intro'], links: [link, link] }],
        documents: [{ type: 'doc', id: 'report', sections: ['Intro', 'Intro', 'Conclusion'], links: [link, link],
            candidates: ['https://example.test/report', 'https://example.test/report'] }] };
    const original = structuredClone(source);
    const [resource] = normalizeLegacyAttachments(source);
    assert.deepEqual(resource.sections, ['Intro', 'Intro', 'Conclusion']);
    assert.deepEqual(resource.links, [link, link]);
    assert.deepEqual(resource.candidates, ['https://example.test/report', 'https://example.test/report']);
    resource.links![0].title = 'Changed';
    assert.deepEqual(source, original);
});

test('all reference fields participate in deduplication and bridging aliases collapse transitively', () => {
    const resources = normalizeLegacyAttachments({
        attachments: [{ type: 'image', localName: 'assets/lake.png', width: 100 },
            { type: 'image', url: 'https://example.test/lake', height: 200 }],
        images: [{ type: 'image', localName: 'lake.png', sourceUrl: 'https://example.test/lake', mimeType: 'image/png' }],
    });
    assert.equal(resources.length, 1);
    assert.equal(resources[0].width, 100);
    assert.equal(resources[0].height, 200);
    assert.equal(resources[0].mimeType, 'image/png');
});

test('same filenames do not collapse different resources or anonymous missing records', () => {
    const resources = normalizeLegacyAttachments({ attachments: [
        { type: 'image', localName: 'one/lake.png' }, { type: 'image', localName: 'two/lake.png' },
        { type: 'file' }, { type: 'file' },
    ] });
    assert.equal(resources.length, 4);
});

test('provider tokens resolve generated representations before tokens leave Domain', () => {
    const source = { attachments: [{ type: 'image', token: 'provider-token', sourceUrl: 'https://example.test/thumb', width: 100 }],
        images: [{ type: 'image', token: 'provider-token', sourceUrl: 'https://example.test/full', width: 1024, isGenerated: true, generation }] };
    const original = structuredClone(source);
    const [resource] = normalizeLegacyAttachments(source);
    assert.equal(resource.sourceUrl, 'https://example.test/full');
    assert.equal(resource.width, 1024);
    assert.deepEqual(resource.generation, generation);
    assert.equal('token' in resource, false);
    assert.deepEqual(source, original);
});

test('reliable generation identity merges online/offline paths and preserves metadata', async () => {
    const domain = await assertRoundTrip({ ...metadata, messages: [{ role: 'assistant', content: '',
        attachments: [{ type: 'image', localName: 'online.png', providerRequestId: 'r_ABCDEF0123456789', imageOrdinal: 0 }],
        images: [{ type: 'image', localName: 'offline.png', isGenerated: true, generation, dataBase64: 'AQID' }],
    }] });
    assert.equal(messageAssets(domain, 0)?.length, 1);
    assert.equal(messageAssets(domain, 0)?.[0].source, undefined);
    assert.deepEqual(messageAssets(domain, 0)?.[0].generation, generation);
    assert.equal(messageAssets(domain, 0)?.[0].generated, true);
});

test('body references to discarded provider aliases bind to the one semantic resource', async () => {
    const domain = await assertRoundTrip({ ...metadata, messages: [{ role: 'assistant', content: '![Lake](assets/offline.png)',
        attachments: [{ type: 'image', localName: 'online.png', generation }],
        images: [{ type: 'image', localName: 'assets/offline.png', generation, isGenerated: true }],
    }] });
    assert.equal(messageAssets(domain, 0)?.length, 1);
    const paragraph = domain.messages[0].content[0];
    assert.ok(paragraph.type === 'paragraph' && paragraph.children[0].type === 'image');
    assert.equal(paragraph.children[0].assetId, messageAssets(domain)[0].id);
    assert.equal(collectDocumentResources((await composeFixture(domain)).document).referencedIds.size, 1);
});

test('unknown image ordinals and conflicting generation ownership remain distinct', () => {
    const ambiguous = { ...generation, imageOrdinal: undefined, imageCount: 2 };
    assert.equal(normalizeLegacyAttachments({ attachments: [
        { type: 'image', localName: 'one.png', generation: ambiguous },
        { type: 'image', localName: 'two.png', generation: ambiguous },
    ] }).length, 2);
    assert.equal(normalizeLegacyAttachments({ attachments: [
        { type: 'image', url: 'https://example.test/shared', generation },
        { type: 'image', url: 'https://example.test/shared', generation: { ...generation, chatId: 'other-chat' } },
        { type: 'image', url: 'https://example.test/shared', generation: { ...generation, imageOrdinal: 1 } },
    ] }).length, 3);
});

test('an untagged alias cannot bridge conflicting document or generation identities', () => {
    const url = 'https://example.test/shared';
    assert.equal(normalizeLegacyAttachments({
        attachments: [{ type: 'file', id: 'report-a', url }, { type: 'file', id: 'report-b', url }],
        documents: [{ type: 'file', url }],
    }).length, 3);
    assert.equal(normalizeLegacyAttachments({
        attachments: [{ type: 'image', url, generation },
            { type: 'image', url, generation: { ...generation, chatId: 'other-chat' } }],
        images: [{ type: 'image', url }],
    }).length, 3);
});

test('generation event metadata without a request ID needs matching time, prompt and known image ordinal', () => {
    const event = { ...generation, providerRequestId: undefined };
    const resources = normalizeLegacyAttachments({ attachments: [
        { type: 'image', localName: 'online.png', generation: event },
        { type: 'image', localName: 'offline.png', generation: event },
        { type: 'image', localName: 'online.png', generation: { ...event, time: 1700000005123 } },
    ] });
    assert.equal(resources.length, 2);
    assert.equal(resources[0].localName, 'online.png');
});

test('binary views survive Domain JSON round trips without changing input bytes', async () => {
    const buffer = new Uint8Array([9, 1, 2, 3, 9]);
    const view = new DataView(buffer.buffer, 1, 3);
    const domain = await assertRoundTrip({ ...metadata, messages: [{ role: 'assistant', content: '', attachments: [
        { type: 'file', name: 'bytes.bin', dataBuffer: view },
    ] }] });
    assert.equal(messageAssets(domain, 0)?.[0].dataBase64, 'AQID');
    assert.equal('dataBuffer' in messageAssets(domain, 0)![0], false);
    assert.deepEqual([...buffer], [9, 1, 2, 3, 9]);
    buffer[1] = 99;
    assert.equal(messageAssets(domain, 0)?.[0].dataBase64, 'AQID');
});

test('Composer trusts explicit Domain resources and ignores runtime legacy aliases', async () => {
    const resource = { id: 'report', kind: 'file' as const, name: 'report.md', document: { contentMarkdown: '# Report' } };
    const domain: DomainConversationDetail = { ...metadata, providerId: 'gemini', assets: [resource], messages: [{ role: 'assistant', content: [], attachmentIds: [resource.id] }] };
    const expected = await composeFixture(domain);
    const leaked = { ...domain, messages: [{ ...domain.messages[0], images: [{ type: 'image', url: 'wrong.png' }], documents: [{ ...resource }] }] };
    assert.deepEqual((await composeFixture(leaked)).document, expected.document);
    const explicit = { ...domain, assets: [resource, { ...resource, id: 'second-report' }], messages: [{ ...domain.messages[0], attachmentIds: [resource.id, 'second-report'] }] };
    assert.equal(collectDocumentResources((await composeFixture(explicit)).document).referencedIds.size, 2,
        'Composer must not reconcile alias evidence or infer resource identity');
});

test('shared Composer and Domain consumption have no legacy resource alias reconciliation', () => {
    for (const file of ['src/core/domain/closure.ts', 'src/core/document/compose/composeDomainDocument.ts',
        'src/core/document/compose/composeContent.ts']) {
        const source = readFileSync(join(__dirname, '..', file), 'utf8');
        assert.doesNotMatch(source, /mergeMessageAttachments|reconcileLegacyMediaLists|structuredBodyAttachments|attachments\.includes|\bimages\??:|\bdocuments\??:/);
    }
});
