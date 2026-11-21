import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CLOUD_CONVERSATION_SCHEMA,
    CLOUD_CONVERSATION_VERSION,
    decodePortableCloudConversation,
    encodePortableCloudConversation,
} from '../src/l2/cloudPayload.js';
import type { Account } from '../src/l2/accountRegistry.js';
import type { ReadonlyDomain } from '../src/l2/runtimeValidation.js';

const DEVICE_A_ACCOUNT: Account = {
    id: '11111111-1111-4111-8111-111111111111',
    providerId: 'gemini',
    providerAccountId: '109876543210',
    email: 'alice@example.com',
    displayName: 'Alice',
};

function richConversation(accountId = DEVICE_A_ACCOUNT.id, conversationId = 'c_rich_01'): ReadonlyDomain {
    const key = { accountId, conversationId };
    return {
        index: {
            key,
            title: 'Quantum Harmonic Oscillator',
            titleSource: 'provider',
            createdAt: 1700000000000,
            updatedAt: 1700000500000,
        },
        detail: {
            key,
            savedAt: 1700000500000,
            quality: { status: 'complete', sourceTurn: 'finished' },
            assets: [
                {
                    id: 'img-gen-1',
                    kind: 'image',
                    name: 'wavefunction.png',
                    mediaType: 'image/png',
                    sourceUri: 'https://lh3.googleusercontent.com/d/durable-asset',
                    generation: { prompt: 'Plot ground state wavefunction', imageOrdinal: 0 },
                },
                {
                    id: 'canvas-doc-1',
                    kind: 'file',
                    name: 'solver.py',
                    mediaType: 'text/x-python',
                    document: { id: 'doc-1', contentMarkdown: '```python\nimport numpy as np\n```' },
                },
            ],
            messages: [
                {
                    id: 'm-1',
                    role: 'user',
                    timestamp: 1700000001000,
                    content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Derive the ground state energy.' }] }],
                },
                {
                    id: 'm-2',
                    role: 'assistant',
                    model: 'gemini-2.5-pro',
                    timestamp: 1700000005000,
                    reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Use ladder operators.' }] }],
                    citations: [{ id: 'cit-1', url: 'https://example.edu/qm', title: 'QM Notes' }],
                    attachmentIds: ['img-gen-1', 'canvas-doc-1'],
                    content: [
                        {
                            type: 'paragraph',
                            children: [
                                { type: 'text', text: 'Ground state energy is ' },
                                { type: 'inlineMath', source: '\\frac{1}{2}\\hbar\\omega' },
                                { type: 'citationRef', citationId: 'cit-1', label: '1' },
                            ],
                        },
                        { type: 'math', source: 'H|0\\rangle = \\frac{1}{2}\\hbar\\omega|0\\rangle' },
                        { type: 'image', assetId: 'img-gen-1', alt: 'Wavefunction' },
                        { type: 'file', assetId: 'canvas-doc-1', label: 'solver.py' },
                    ],
                },
            ],
        },
    };
}

test('L2 cloudPayload strips device-local Account UUID and preserves full semantic AST, reasoning, citations, and Canvas text', () => {
    const conv = richConversation();
    const encoded = encodePortableCloudConversation(DEVICE_A_ACCOUNT, conv);
    assert.ok(!encoded.includes(DEVICE_A_ACCOUNT.id), 'device-local Account UUID must never appear in portable cloud JSON');

    const decoded = decodePortableCloudConversation(encoded);
    assert.equal(decoded.schema, CLOUD_CONVERSATION_SCHEMA);
    assert.equal(decoded.version, CLOUD_CONVERSATION_VERSION);
    assert.deepEqual(decoded.account, {
        providerId: 'gemini',
        providerAccountId: '109876543210',
        email: 'alice@example.com',
        displayName: 'Alice',
    });
    assert.equal(decoded.conversationId, 'c_rich_01');
    assert.equal('key' in decoded.index, false);
    assert.ok(decoded.detail);
    assert.equal('key' in decoded.detail, false);
    assert.equal(decoded.index.title, 'Quantum Harmonic Oscillator');
    assert.deepEqual(decoded.detail.messages, conv.detail?.messages);
    assert.equal(decoded.detail?.assets[1]?.document?.contentMarkdown, '```python\nimport numpy as np\n```');

    // Privacy-minimal Index-only mode omits detail completely
    const indexOnlyJson = encodePortableCloudConversation(DEVICE_A_ACCOUNT, { index: conv.index });
    assert.equal(indexOnlyJson.includes('messages'), false);
    assert.equal(indexOnlyJson.includes('Derive the ground state energy'), false);
    const decodedIndexOnly = decodePortableCloudConversation(indexOnlyJson);
    assert.equal(decodedIndexOnly.detail, undefined);
    assert.equal(decodedIndexOnly.index.title, 'Quantum Harmonic Oscillator');
});

test('L2 cloudPayload rejects default placeholder accounts, key mismatches, dangling references, and malformed schemas', () => {
    const conv = richConversation();
    assert.throws(
        () => encodePortableCloudConversation({ ...DEVICE_A_ACCOUNT, providerAccountId: 'default' }, conv),
        /default placeholder/,
    );
    assert.throws(
        () => encodePortableCloudConversation({ ...DEVICE_A_ACCOUNT, id: '22222222-2222-4222-8222-222222222222' }, conv),
        /mismatch/,
    );

    const validRaw = JSON.parse(encodePortableCloudConversation(DEVICE_A_ACCOUNT, conv)) as Record<string, unknown>;

    // Extra top-level property
    assert.throws(() => decodePortableCloudConversation(JSON.stringify({ ...validRaw, extra: 1 })), /Unexpected top-level/);
    // Wrong version
    assert.throws(() => decodePortableCloudConversation(JSON.stringify({ ...validRaw, version: 99 })), /Unsupported/);
    // Embedded local key in detail
    assert.throws(
        () => decodePortableCloudConversation(JSON.stringify({
            ...validRaw,
            detail: { ...(validRaw.detail as object), key: { accountId: DEVICE_A_ACCOUNT.id, conversationId: 'c_rich_01' } },
        })),
        /Invalid portable Detail/,
    );
    // Dangling assetId reference violates L2 closure
    assert.throws(
        () => decodePortableCloudConversation(JSON.stringify({
            ...validRaw,
            detail: { ...(validRaw.detail as object), assets: [] },
        })),
        /asset|closure|reference/i,
    );
    // Signed / ephemeral URL in sourceUri is rejected by L2 schema
    assert.throws(
        () => decodePortableCloudConversation(JSON.stringify({
            ...validRaw,
            detail: {
                ...(validRaw.detail as object),
                assets: [{ id: 'img-gen-1', kind: 'image', sourceUri: 'https://example.com/a.png?X-Amz-Signature=secret' }, (validRaw.detail as { assets: unknown[] }).assets[1]],
            },
        })),
        /Invalid persisted Domain contract/,
    );
});
