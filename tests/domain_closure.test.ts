import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Conversation } from '../src/types/conversation.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import type { BlockNode } from '../src/core/domain/content/blocks.js';
import { assertDomainClosure } from '../src/core/domain/closure.js';
import { toDomainConversationDetail, parseLegacyConversation } from '../src/core/compatibility/legacyConversationAdapter.js';
import { composeFixture } from './helpers/documentFixture.js';
import { parseProviderConversation } from '../src/core/compatibility/conversationParser.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { renderDocumentTypst } from '../src/core/renderers/typst/renderTypst.js';
import { collectDocumentResources } from '../src/core/document/ast/resourceReferences.js';
import { mapContentAssetReferences } from '../src/core/domain/content/assetReferences.js';
import { messageAssets } from './helpers/domainAssets.js';

const metadata = { id: 'closed', title: 'Closed Domain', timestamp: null };
const text = (value: string): BlockNode[] => [{ type: 'paragraph', children: [{ type: 'text', text: value }] }];
function references(blocks: BlockNode[]): string[] {
    const refs: string[] = [];
    mapContentAssetReferences(blocks, ref => { refs.push(ref); return ref; });
    return refs;
}

test('one registry resource spans messages, attachment aliases, body and reasoning', async () => {
    const generation = { chatId: metadata.id, providerRequestId: 'request-1234', generationOrdinal: 1, imageCount: 1, imageOrdinal: 0 };
    const input: Conversation = { ...metadata, messages: [
        { role: 'user', content: '![one](assets/online.png)', attachments: [{ type: 'image', localName: 'online.png', generation }] },
        { role: 'assistant', content: '> ![two](offline.png)', thoughts: '![three](https://example.test/image)',
            images: [{ type: 'image', localName: 'offline.png', sourceUrl: 'https://example.test/image', generation,
                isGenerated: true, dataBase64: 'AQID', width: 120, height: 80, mimeType: 'image/png' }] },
        { role: 'assistant', content: '![four](https://example.test/image)' },
    ] };
    const original = structuredClone(input);
    const { conversation: domain, resourceHints } = parseLegacyConversation(input);
    assert.equal(domain.assets.length, 1);
    const [asset] = domain.assets;
    assert.deepEqual(domain.messages.slice(0, 2).map(message => message.attachmentIds), [[asset.id], [asset.id]]);
    assert.equal(domain.messages[2].attachmentIds, undefined, 'a content reference does not imply a new explicit attachment');
    assert.deepEqual(domain.messages.flatMap(message => references(message.content)), [asset.id, asset.id, asset.id]);
    assert.deepEqual(references(domain.messages[1].reasoning!), [asset.id]);
    assert.deepEqual(asset.generation, generation);
    assert.equal(asset.generated, true);
    assert.deepEqual(asset.dimensions, { width: 120, height: 80 });
    assert.equal(asset.mediaType, 'image/png');
    assert.equal(asset.dataBase64, 'AQID');
    const restored: DomainConversationDetail = JSON.parse(JSON.stringify(domain));
    assert.deepEqual(restored, domain);
    const result = await composeFixture(domain);
    assert.deepEqual((await composeFixture(restored)).document, result.document);
    assert.equal(result.diagnostics.some(d => d.severity === 'error'), false);
    assert.deepEqual(input, original);
    assert.deepEqual(domain, restored, 'export must not mutate Domain');
});

test('body-only URI resources are unique across messages and reasoning, including local aliases and data URIs', async () => {
    for (const [first, second] of [
        ['https://example.test/shared.png', 'https://example.test/shared.png'],
        ['data:image/png;base64,AQID', 'data:image/png;base64,AQID'],
        ['assets/a%20b.png', './a b.png'],
    ]) {
        const domain = toDomainConversationDetail({ ...metadata, messages: [
            { role: 'user', content: `![body](${first})` },
            { role: 'assistant', content: `![body](<${second}>)`, thoughts: `![reason](<${second}>)` },
        ] });
        assert.equal(domain.assets.length, 1);
        assert.equal(domain.messages.every(message => message.attachmentIds === undefined), true);
        assert.deepEqual(references(domain.messages[1].reasoning!), [domain.assets[0].id]);
        assert.deepEqual(references(domain.messages[1].content), [domain.assets[0].id]);
        assert.deepEqual((await composeFixture(JSON.parse(JSON.stringify(domain)))).document,
            (await composeFixture(domain)).document);
    }
});

test('document aliases merge across messages without losing metadata or byte payloads', async () => {
    const document = { type: 'doc', id: 'report', title: 'Report', createdAt: 123, contentMarkdown: '# Report',
        chipUrl: 'https://example.test/chip', sections: ['Intro', 'Intro'], links: [{ title: 'Source', url: 'https://example.test' }],
        candidates: ['https://example.test/report'], hasFabricatedText: false };
    const input: Conversation = { ...metadata, messages: [
        { role: 'assistant', content: '', attachments: [{ ...document, dataBuffer: new Uint8Array([1, 2, 3]) }] },
        { role: 'assistant', content: '', documents: [document] },
    ] };
    const original = structuredClone(input);
    const { conversation: domain, resourceHints } = parseLegacyConversation(input);
    const [asset] = domain.assets;
    assert.equal(domain.assets.length, 1);
    assert.equal(asset.kind, 'file');
    assert.equal(asset.name, 'Report');
    assert.equal(asset.dataBase64, 'AQID');
    const { type: _type, title: _title, ...expectedDocument } = document;
    assert.deepEqual(asset.document, expectedDocument);
    assert.equal(messageAssets(domain, 0)[0], messageAssets(domain, 1)[0]);
    const restored: DomainConversationDetail = JSON.parse(JSON.stringify(domain));
    assert.deepEqual(restored, domain);
    assert.deepEqual((await composeFixture(restored)).document, (await composeFixture(domain)).document);
    assert.deepEqual(input, original);
});

test('reordering messages preserves identities established by resource source or generation evidence', () => {
    const input: Conversation = { ...metadata, messages: [
        { role: 'user', content: '![inline](https://example.test/inline)' },
        { role: 'assistant', content: '', attachments: [{ type: 'image', localName: 'one.png', providerRequestId: 'request-1234', imageOrdinal: 0 }] },
        { role: 'assistant', content: '', documents: [{ type: 'doc', id: 'report', contentMarkdown: '# Report' }] },
    ] };
    const first = toDomainConversationDetail(input);
    const reversed = toDomainConversationDetail({ ...input, messages: [...input.messages!].reverse() });
    assert.deepEqual(first.assets.map(asset => asset.id).sort(), reversed.assets.map(asset => asset.id).sort());
});

test('missing evidence, unknown ordinals and conflicting documents never collapse distinct resources', () => {
    const domain = toDomainConversationDetail({ ...metadata, messages: [
        { role: 'user', content: '', attachments: [{ type: 'file' }, { type: 'file', name: 'same.txt' }] },
        { role: 'assistant', content: '', attachments: [{ type: 'file' }, { type: 'file', name: 'same.txt' },
            { type: 'image', providerRequestId: 'request-1234' }, { type: 'image', providerRequestId: 'request-1234' }],
            documents: [{ type: 'doc', id: 'a', url: 'https://example.test/shared' }, { type: 'doc', id: 'b', url: 'https://example.test/shared' }] },
    ] });
    assert.equal(domain.assets.length, 8);
    assert.equal(new Set(domain.assets.map(asset => asset.id)).size, 8);
    assertDomainClosure(JSON.parse(JSON.stringify(domain)));
});

test('downstream binding respects Domain identity even when two URIs have the same basename', async () => {
    const domain: DomainConversationDetail = { ...metadata, providerId: 'custom', assets: [
        { id: 'one', kind: 'image', name: 'Attachment', source: { uri: 'https://one.test/shared.png' } },
        { id: 'two', kind: 'image', source: { uri: 'https://two.test/shared.png' } },
    ], messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'two', alt: 'Inline' }], attachmentIds: ['one'] }] };
    const result = await composeFixture(domain);
    assert.equal(collectDocumentResources(result.document).referencedIds.size, 2);
    assert.deepEqual(domain.assets.map(asset => asset.source?.uri), ['https://one.test/shared.png', 'https://two.test/shared.png']);
    assert.equal(result.document.messages[0].blocks[0].type, 'image');
    assert.equal(result.document.messages[0].blocks[0].type === 'image' && result.document.messages[0].blocks[0].resourceId, 'two');
});

test('resource IDs never collide with export numbering or acquisition URI aliases', async () => {
    const domain: DomainConversationDetail = { ...metadata, providerId: 'custom', assets: [
        { id: 'msg-0-a1', kind: 'image', name: 'First', source: { uri: 'https://first.test/image' } },
        { id: 'second', kind: 'image', name: 'Second', source: { uri: 'msg-0-a1' } },
    ], messages: [{ role: 'assistant', attachmentIds: ['msg-0-a1', 'second'],
        content: [{ type: 'image', assetId: 'msg-0-a1' }, { type: 'image', assetId: 'second' }] }] };
    const result = await composeFixture(domain);
    assert.deepEqual(result.document.messages[0].blocks.map(block => 'resourceId' in block ? block.resourceId : undefined), ['msg-0-a1', 'second']);
});

test('resource metadata and audio/video kinds survive neutral downstream adaptation', async () => {
    const domain: DomainConversationDetail = { ...metadata, providerId: 'custom', assets: [
        { id: 'audio', kind: 'audio', name: 'Audio' }, { id: 'video', kind: 'video', name: 'Video' },
        { id: 'image', kind: 'image', name: 'Shared', mediaType: 'image/png', dimensions: { width: 120, height: 80 },
            source: { uri: 'https://example.test/image' } },
    ], messages: [{ role: 'assistant', attachmentIds: ['audio', 'video'], content: [{ type: 'image', assetId: 'image' }] }] };
    const result = await composeFixture(domain);
    const [image, audio, video] = result.document.messages[0].blocks;
    assert.ok(image.type === 'image');
    assert.equal(image.resourceId, 'image');
    assert.equal(image.alt, 'Shared');
    assert.ok(audio.type === 'file' && video.type === 'file');
    assert.equal(audio.kind, 'audio');
    assert.equal(video.kind, 'video');
    assert.equal(domain.assets[2].mediaType, 'image/png');
    assert.deepEqual(domain.assets[2].dimensions, { width: 120, height: 80 });
});

test('reasoning is parsed at the producer boundary and Domain reasoning text stays literal downstream', async () => {
    const parsed = toDomainConversationDetail({ ...metadata, messages: [{ role: 'assistant', content: 'Body',
        thoughts: '<p>**strong**</p><p>![image](https://example.test/image)</p>' }] });
    assert.ok(parsed.messages[0].reasoning?.[0].type === 'paragraph');
    assert.equal(parsed.messages[0].reasoning[0].children[0].type, 'strong');
    assert.equal(parsed.assets.length, 1);
    const literal: DomainConversationDetail = { ...metadata, providerId: 'custom', assets: [], messages: [{
        role: 'assistant', content: text('Body'), reasoning: text('**literal** <b>HTML</b> ![image](url) $x$'),
    }] };
    const original = structuredClone(literal);
    const result = await composeFixture(literal);
    const [thought] = result.document.messages[0].blocks;
    assert.ok(thought.type === 'disclosure');
    assert.deepEqual(thought.blocks, literal.messages[0].reasoning);
    assert.equal(collectDocumentResources(result.document).referencedIds.size, 0);
    assert.deepEqual(literal, original);
});

for (const providerId of ['openai', 'anthropic', 'custom-provider']) {
    test(`Composer trusts Domain provider ${providerId} for conversation and diagnostics`, async () => {
        const domain = toDomainConversationDetail({ ...metadata, source: 'openai-import', messages: [{ role: 'assistant', content: '![missing](missing.png)' }] }, { providerId });
        assert.equal(domain.providerId, providerId);
        const result = await composeFixture(domain);
        assert.equal(result.document.header.providerLabel, providerId);
        const parsed = parseProviderConversation({ ...metadata, messages: [{ role: 'tool', content: 42 }] }, { providerId });
        assert.equal(parsed.conversation.providerId, providerId);
        assert.ok(parsed.diagnostics.some(d => d.code === 'UNKNOWN_ROLE'));
        assert.ok(parsed.diagnostics.some(d => d.code === 'UNKNOWN_MESSAGE_CONTENT'));
    });
}

test('provider identity is assigned only by producers, with OpenAI and Takeout correctly distinguished', () => {
    assert.equal(toDomainConversationDetail({ ...metadata, source: 'openai-import' }).providerId, 'openai');
    assert.equal(toDomainConversationDetail({ ...metadata, source: 'takeout' }).providerId, 'gemini');
    assert.throws(() => toDomainConversationDetail(metadata, { providerId: '' }), /providerId/);
});

test('Domain closure rejects invalid provider, repeated registry/message IDs and dangling references', async () => {
    const domain: DomainConversationDetail = { ...metadata, providerId: 'custom', assets: [{ id: 'asset', kind: 'file' }],
        messages: [{ role: 'assistant', content: [], attachmentIds: ['asset'] }] };
    assertDomainClosure(domain);
    const invalid: DomainConversationDetail[] = [
        { ...domain, providerId: '' },
        { ...domain, assets: [domain.assets[0], { ...domain.assets[0] }] },
        { ...domain, messages: [{ ...domain.messages[0], attachmentIds: ['asset', 'asset'] }] },
        { ...domain, messages: [{ ...domain.messages[0], attachmentIds: ['unknown'] }] },
        { ...domain, messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'unknown' }] }] },
        { ...domain, messages: [{ role: 'assistant', content: [], reasoning: [{ type: 'file', assetId: 'unknown' }] }] },
        { ...domain, messages: [{ role: 'assistant', content: [], reasoning: 'raw string' as never }] },
    ];
    for (const input of invalid) {
        assert.throws(() => assertDomainClosure(input), TypeError);
        await assert.rejects(composeFixture(input), TypeError);
    }
});

test('Domain consumers never parse provider syntax or reconcile acquisition aliases', () => {
    for (const file of ['src/core/domain/closure.ts', 'src/core/document/compose/composeDomainDocument.ts',
        'src/core/document/compose/composeContent.ts']) {
        const source = readFileSync(join(__dirname, '..', file), 'utf8');
        assert.doesNotMatch(source, /parseGemini|parseImported|parseLegacyReasoning|preprocessGemini|convertHtmlToMarkdown|structuredBodyAttachments|resolveLegacyAttachment/);
        assert.doesNotMatch(source, /from\s+['"][^'"]*(?:provider\/|api\/parser)[^'"]*['"]/);
    }
    const domain = toDomainConversationDetail({ ...metadata, messages: [{ role: 'assistant', content: '', attachments: [{
        type: 'image', subDir: 'export-destination', localName: 'source.png', isGenerated: true,
    }] }] });
    assert.deepEqual(Object.keys(domain.assets[0]).sort(), ['generated', 'id', 'kind']);
    assert.equal(domain.assets[0].source, undefined);
    assert.equal('attachments' in domain.messages[0], false);
});

test('existing raw corpus preserves Domain, AST and all backend outputs across JSON round trips', async () => {
    const fixtureDir = join(__dirname, 'fixtures/provider');
    const inputs: Conversation[] = [];
    for (const file of ['conversation-sample.json', 'conversation-turns.json']) {
        const input: Conversation = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
        // The Domain producer rejects malformed raw message bodies; compatibility fallback has its own tests.
        if (input.messages) input.messages = input.messages.filter(message => typeof message.content === 'string');
        inputs.push(input);
    }
    for (const file of readdirSync(join(fixtureDir, 'structured_rpc'))) {
        const structure: { children?: unknown[] } = JSON.parse(readFileSync(join(fixtureDir, 'structured_rpc', file), 'utf8'));
        if (structure.children) inputs.push({ ...metadata, id: file, messages: [{ id: 'm', role: 'model', content: 'Markdown fallback', structuredContent: structure }] });
    }
    const corpus: { corpusSets: Record<string, { documents?: Array<{ id: string; content?: string; markdown?: string; text?: string }> }> } =
        JSON.parse(readFileSync(join(__dirname, 'fixtures/parser_migration_corpus.json'), 'utf8'));
    for (const group of Object.values(corpus.corpusSets)) {
        for (const document of group.documents ?? []) {
            const content = document.content || document.markdown || document.text;
            if (typeof content === 'string') inputs.push({ ...metadata, id: document.id, messages: [{ id: 'm', role: 'model', content }] });
        }
    }
    assert.ok(inputs.length > 100);
    for (const input of inputs) {
        const original = structuredClone(input);
        const { conversation: domain, resourceHints } = parseLegacyConversation(input);
        const semantic = await composeFixture(domain, resourceHints);
        const restored = await composeFixture(JSON.parse(JSON.stringify(domain)), resourceHints);
        const parsed = parseProviderConversation(input);
        const direct = await composeFixture(parsed.conversation, parsed.resourceHints);
        assert.deepEqual(domain, parsed.conversation, input.id);
        assert.deepEqual(direct.document, semantic.document, input.id);
        assert.deepEqual(restored, semantic, input.id);
        assert.deepEqual(renderDocumentHtml(semantic.document, semantic.resources), renderDocumentHtml(restored.document, restored.resources), input.id);
        assert.equal(renderDocumentMarkdown(semantic.document, semantic.resources), renderDocumentMarkdown(restored.document, restored.resources), input.id);
        assert.deepEqual(renderDocumentTypst(semantic.document, semantic.resources), renderDocumentTypst(restored.document, restored.resources), input.id);
        assert.deepEqual(input, original, input.id);
    }
});
