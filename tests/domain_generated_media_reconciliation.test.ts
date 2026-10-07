import { messageAssets } from './helpers/domainAssets.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, Conversation, GeneratedMediaIdentity } from '../src/types/conversation.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import { toDomainConversationDetail, parseLegacyConversation } from '../src/core/domain/legacyConversationAdapter.js';
import { normalizeDomainConversation } from '../src/core/export/canonical/gemini/normalizeDomainConversation.js';
import { normalizeGeminiConversation } from '../src/core/export/canonical/gemini/normalizeConversation.js';
import { supplementLegacyGeneratedMedia } from '../src/core/domain/legacyGeneratedMediaReconciliation.js';

const metadata = { id: 'media-chat', title: 'Generated media', timestamp: 1700000000123 };
const requestId = 'abcd1234abcd1234';
const generation: GeneratedMediaIdentity = {
    chatId: metadata.id, providerRequestId: requestId, time: metadata.timestamp,
    prompt: 'Draw a cat', generationOrdinal: 0, imageCount: 1, imageOrdinal: 0,
};
const media = [{ filename: 'cat.png', isGenerated: true, generation }];

function legacy(messages: ChatMessage[]): Conversation {
    return { ...metadata, messages };
}

for (const [evidence, userFields, assistantFields] of [
    ['direct request', {}, { providerRequestId: `r_${requestId.toUpperCase()}` }],
    ['legacy user message ID', { id: `r_${requestId}` }, {}],
    ['legacy assistant message ID', {}, { id: `r_${requestId}` }],
    ['legacy turn ID', { turnId: `r_${requestId}` }, {}],
    ['prompt and same-second timestamp', { timestamp: 1700000000999 }, {}],
] as const) {
    test(`Domain construction resolves generated image using ${evidence}`, async () => {
        const conversation = legacy([
            { id: 'wrong-user', role: 'user', content: 'Earlier question', timestamp: 1699999900000 },
            { id: 'wrong-assistant', role: 'model', content: 'Earlier answer' },
            { role: 'user', content: 'Draw a cat', ...userFields },
            { role: 'model', content: 'Your cat', ...assistantFields },
            { role: 'user', content: 'Later question' },
            { role: 'assistant', content: 'Later answer' },
        ]);
        const original = structuredClone(conversation);
        const originalMedia = structuredClone(media);
        const { conversation: domain, resourceHints } = parseLegacyConversation(conversation, { generatedMedia: media });
        assert.equal(domain.messages.length, 6);
        assert.equal(domain.messages[3].role, 'assistant');
        assert.equal(messageAssets(domain, 3)?.[0].name, 'cat.png');
        assert.deepEqual(domain.messages[3].content, [{ type: 'paragraph', children: [{ type: 'text', text: 'Your cat' }] }]);
        assert.equal(domain.messages.filter(m => m.attachmentIds?.length).length, 1);
        assert.deepEqual(conversation, original);
        assert.deepEqual(media, originalMedia);
        const compat = structuredClone(conversation);
        supplementLegacyGeneratedMedia(compat, metadata.id, media, { appendMarkdownRef: false });
        assert.deepEqual((await normalizeDomainConversation(domain, { resourceHints })).bundle, (await normalizeGeminiConversation(compat)).bundle);
    });
}

for (const [ambiguity, messages] of [
    ['duplicate direct request', [
        { role: 'assistant', content: 'A', providerRequestId: requestId },
        { role: 'assistant', content: 'B', providerRequestId: requestId },
    ]],
    ['duplicate legacy request', [
        { role: 'user', content: 'Draw a cat', id: `r_${requestId}` }, { role: 'model', content: 'A' },
        { role: 'user', content: 'Draw a cat', id: `r_${requestId}` }, { role: 'model', content: 'B' },
    ]],
    ['duplicate prompt and time', [
        { role: 'user', content: 'Draw a cat', timestamp: metadata.timestamp }, { role: 'model', content: 'A' },
        { role: 'user', content: 'Draw a cat', timestamp: metadata.timestamp }, { role: 'model', content: 'B' },
    ]],
    ['multiple responses', [
        { role: 'user', content: 'Draw a cat', id: `r_${requestId}` },
        { role: 'model', content: 'A' }, { role: 'assistant', content: 'B' },
    ]],
    ['next user intervenes', [
        { role: 'user', content: 'Draw a cat', id: `r_${requestId}` },
        { role: 'user', content: 'Unrelated question' }, { role: 'assistant', content: 'Unrelated answer' },
    ]],
] as const) {
    test(`Ambiguous ${ambiguity} never assigns generated image to an existing message`, () => {
        const conversation = legacy(messages.map(m => ({ ...m })));
        const { conversation: domain, resourceHints } = parseLegacyConversation(conversation, { generatedMedia: media });
        assert.ok(domain.messages.slice(0, messages.length).every(m => !m.attachmentIds?.length));
        assert.equal(domain.messages.length, messages.length + 1, 'unresolved media is retained separately');
        assert.equal(messageAssets(domain, domain.messages.length - 1)?.[0].name, 'cat.png');
        assert.ok(domain.messages.every(m => !('generation' in m)));
    });
}

test('Domain construction reconciles flattened legacy turns before evidence is discarded', () => {
    const conversation: Conversation = { ...metadata, turns: [{ messages: [
        { role: 'user', content: 'Draw a cat', turnId: `r_${requestId}` }, { role: 'model', content: 'Answer' },
    ] }] };
    const { conversation: domain, resourceHints } = parseLegacyConversation(conversation, { generatedMedia: media });
    assert.equal(messageAssets(domain, 1)?.[0].name, 'cat.png');
    assert.equal('turnId' in domain.messages[0], false);
});

test('Domain construction deduplicates provider representations while Canonical uses explicit media only', async () => {
    const first = { type: 'image', isGenerated: true, providerRequestId: requestId, imageOrdinal: 0, localName: 'online.jpg', dataBase64: 'AQID' };
    const duplicate = { ...first, localName: 'offline.png', generation };
    const second = { ...first, imageOrdinal: 1, localName: 'second.jpg' };
    const conversation = legacy([{ role: 'assistant', content: '', attachments: [first], images: [duplicate, second] }]);
    const original = structuredClone(conversation);
    const { conversation: domain, resourceHints } = parseLegacyConversation(conversation);
    assert.ok(messageAssets(domain, 0)?.every(asset => !('path' in (asset.source ?? {}))));
    assert.deepEqual((await normalizeDomainConversation(domain, { resourceHints })).bundle, (await normalizeGeminiConversation(conversation)).bundle);
    assert.deepEqual(conversation, original);
    const explicitDomain: DomainConversationDetail = { ...metadata, providerId: 'gemini', assets: ['one', 'two', 'three'].map(id => ({ id, kind: 'image', generation })), messages: [{ role: 'assistant', content: [], attachmentIds: ['one', 'two', 'three'] }] };
    assert.equal((await normalizeDomainConversation(explicitDomain)).bundle.assets.length, 3,
        'Canonical must not collapse explicit attachments using provider IDs');
});

test('Explicit message attachment ownership is authoritative downstream', async () => {
    const domain: DomainConversationDetail = { ...metadata, providerId: 'gemini', assets: [{ id: 'cat', kind: 'image', name: 'cat.png', dataBase64: 'AQID', generation }], messages: [
        { id: requestId, role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'First' }] }], provenance: { providerRequestId: requestId } },
        { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Second' }] }], attachmentIds: ['cat'] },
    ] };
    const original = structuredClone(domain);
    const result = await normalizeDomainConversation(domain);
    assert.equal(result.bundle.conversation.messages[0].blocks.some(b => b.type === 'image'), false);
    assert.equal(result.bundle.conversation.messages[1].blocks.some(b => b.type === 'image'), true);
    assert.deepEqual(domain, original);
});

test('Unknown or foreign evidence never borrows an arbitrary assistant response', () => {
    const domain = toDomainConversationDetail(legacy([{ role: 'assistant', content: 'Existing' }]), { generatedMedia: [
        { filename: 'unknown.png', isGenerated: true },
        { filename: 'foreign.png', isGenerated: true, generation: { ...generation, chatId: 'foreign-chat' } },
    ] });
    assert.equal(domain.messages.length, 3);
    assert.deepEqual(messageAssets(domain, 0), []);
    assert.equal(messageAssets(domain, 1)?.[0].name, 'unknown.png');
    assert.equal(messageAssets(domain, 2)?.[0].name, 'foreign.png');
});

test('Conflicting response request evidence cannot be overridden by prompt/time fallback', () => {
    const domain = toDomainConversationDetail(legacy([
        { role: 'user', content: 'Draw a cat', timestamp: metadata.timestamp },
        { role: 'assistant', content: 'Another event', providerRequestId: 'different-request' },
    ]), { generatedMedia: media });
    assert.deepEqual(messageAssets(domain, 1), []);
    assert.equal(domain.messages.length, 3);
});

test('Detached generated media without messages remains a separate resolved attachment', () => {
    const domain = toDomainConversationDetail(legacy([]), { generatedMedia: media });
    assert.equal(domain.messages.length, 1);
    assert.equal(domain.messages[0].role, 'assistant');
    assert.equal(messageAssets(domain, 0)?.[0].name, 'cat.png');
});

test('Unknown multi-image ordinals cannot suppress detached media using request identity', async () => {
    const multiGeneration = { ...generation, imageCount: 2, imageOrdinal: undefined };
    const conversation = legacy([{ role: 'assistant', content: 'Two cats', providerRequestId: requestId,
        generation: multiGeneration,
        images: [{ type: 'image', isGenerated: true, providerRequestId: requestId, imageOrdinal: 0, fileName: 'online.jpg', url: 'https://example.test/online.jpg' }],
    }]);
    const original = structuredClone(conversation);
    const domain = toDomainConversationDetail(conversation, { generatedMedia: [
        { filename: 'offline-a.png', isGenerated: true, generation: multiGeneration },
        { filename: 'offline-b.png', isGenerated: true, generation: multiGeneration },
    ] });
    assert.equal(domain.messages.length, 1);
    assert.deepEqual(messageAssets(domain, 0)?.map(a => a.name), ['offline-a.png', 'offline-b.png', 'online.jpg']);
    assert.equal('generation' in domain.messages[0], false);
    assert.equal((await normalizeDomainConversation(domain)).bundle.assets.length, 3);
    assert.deepEqual(conversation, original);
});
