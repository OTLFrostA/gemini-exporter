export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const { toDomainConversationDetail } = require('../src/core/domain/legacyConversationAdapter.js');
const { normalizeGeminiConversation } = require('../src/core/export/canonical/gemini/normalizeConversation.js');

async function assertExportEquivalent(legacy: Record<string, unknown>): Promise<void> {
    const domain = toDomainConversationDetail(legacy as never);
    const [before, after] = await Promise.all([
        normalizeGeminiConversation(legacy as never),
        normalizeGeminiConversation(domain as never),
    ]);
    assert.deepEqual(after.bundle, before.bundle);
}

const base = { id: 'conversation-1', title: 'Example', timestamp: 1700000000000 };

test('Domain adapter preserves a normal RPC conversation and message order', async () => {
    const conversation = {
        ...base,
        updatedAt: 1700000001000,
        url: 'https://gemini.google.com/app/conversation-1',
        messages: [
            { id: 'u1', role: 'user', content: 'Question', timestamp: 1700000000000 },
            { id: 'a1', role: 'model', content: 'Answer', timestamp: 1700000001000 },
        ],
    };
    await assertExportEquivalent(conversation);
    const domain = toDomainConversationDetail(conversation);
    assert.deepEqual(domain.messages.map((m: { id?: string }) => m.id), ['u1', 'a1']);
    assert.equal('turns' in domain, false);
});

test('Domain adapter preserves missing and explicitly null server timestamps', async () => {
    const conversation = {
        ...base,
        timestamp: null,
        messages: [
            { role: 'user', content: 'No timestamp' },
            { role: 'assistant', content: 'Null timestamp', timestamp: null },
        ],
    };
    const domain = toDomainConversationDetail(conversation);
    assert.equal(domain.timestamp, null);
    assert.equal(domain.messages?.[0].timestamp, undefined);
    assert.equal(domain.messages?.[1].timestamp, null);
    await assertExportEquivalent(conversation);
});

test('Domain adapter preserves attachments and images without mutating binary data', async () => {
    const conversation = {
        ...base,
        messages: [{ role: 'user', content: 'See image', attachments: [
            { type: 'image', localName: 'image.png', dataBase64: 'AQID', mimeType: 'image/png' },
        ], images: [{ type: 'image', url: 'https://example.test/image.png', isImage: true }] }],
    };
    const original = structuredClone(conversation);
    const domain = toDomainConversationDetail(conversation);
    assert.deepEqual(conversation, original);
    assert.equal(domain.messages?.[0].attachments?.[0].dataBase64, 'AQID');
    await assertExportEquivalent(conversation);
});

test('Domain adapter preserves generated media identity and export output', async () => {
    const conversation = {
        ...base,
        messages: [{ role: 'model', content: 'Generated', attachments: [{
            type: 'image', isGenerated: true, url: 'https://example.test/generated.png',
            generation: { chatId: 'conversation-1', providerRequestId: 'request-1', time: null, prompt: 'A lake', generationOrdinal: 2, imageCount: 1, imageOrdinal: 0, turnId: 'turn-2' },
        }] }],
    };
    await assertExportEquivalent(conversation);
    assert.equal(toDomainConversationDetail(conversation).messages?.[0].attachments?.[0].generation?.time, null);
});

test('Domain adapter preserves citations, document metadata, thoughts, and structured content', async () => {
    const conversation = {
        ...base,
        messages: [{
            role: 'assistant', content: 'Answer [1]', thoughts: ['Reasoned step'], thinking: 'Alternate reasoning',
            citations: [{ url: 'https://example.test/source', title: 'Source' }],
            documents: [{ type: 'doc', id: 'doc-1', title: 'Report', url: 'https://example.test/report', contentMarkdown: '# Report', sections: ['Intro'], links: [{ title: 'Source', url: 'https://example.test/source' }] }],
            structuredContent: { type: 'text', text: 'Structured answer' }, groundingCitationMarkers: ['[cite:1]'],
        }],
    };
    await assertExportEquivalent(conversation);
});

test('Domain adapter preserves Takeout-style turns-only conversations', async () => {
    const conversation = {
        ...base,
        source: 'takeout',
        turns: [{ timestamp: null, userContent: 'Question', modelContent: 'Answer', thoughts: ['Thought'], attachments: [{ type: 'file', fileName: 'input.pdf' }] }],
    };
    const domain = toDomainConversationDetail(conversation);
    assert.deepEqual(domain.messages, [
        { role: 'user', content: 'Question' },
        {
            role: 'model', content: 'Answer', thoughts: ['Thought'],
            attachments: [{ type: 'file', fileName: 'input.pdf' }],
        },
    ]);
    assert.equal('turns' in domain, false);
    await assertExportEquivalent(conversation);
});

test('Domain adapter flattens legacy turn.messages in order', async () => {
    const conversation = {
        ...base,
        turns: [{ messages: [
            { id: 'turn-user', role: 'user', content: 'First', timestamp: 100 },
            { id: 'turn-model', role: 'model', content: 'Second', timestamp: null },
        ] }],
    };
    const domain = toDomainConversationDetail(conversation);
    assert.deepEqual(domain.messages.map((message: { id?: string; role: string; content: string; timestamp?: number | null }) => ({ id: message.id, role: message.role, content: message.content, timestamp: message.timestamp })), [
        { id: 'turn-user', role: 'user', content: 'First', timestamp: 100 },
        { id: 'turn-model', role: 'model', content: 'Second', timestamp: null },
    ]);
    assert.equal('turns' in domain, false);
    await assertExportEquivalent(conversation);
});

test('Domain output always has an empty messages array when legacy body is absent', async () => {
    const conversation = { ...base };
    const domain = toDomainConversationDetail(conversation);
    assert.deepEqual(domain.messages, []);
    assert.equal('turns' in domain, false);
    await assertExportEquivalent(conversation);
});

test('Domain adapter preserves OpenAI-style assistant role and message data', async () => {
    const conversation = {
        ...base,
        titleSource: 'openai',
        messages: [{ id: 'openai-1', role: 'assistant', content: 'Hello', timestamp: null, citations: [{ url: 'https://example.test' }] }],
    };
    await assertExportEquivalent(conversation);
    assert.equal(toDomainConversationDetail(conversation).messages?.[0].role, 'assistant');
});
