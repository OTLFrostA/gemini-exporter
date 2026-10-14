import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTimestamp } from '../src/core/domain/time.js';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';
import { closeDomainResources } from '../src/core/parsers/shared/resources/domainResourceAdapter.js';
import { sameGenerationEvent, eventSecond } from '../src/core/parsers/shared/resources/generationEvent.js';
import { findResourceMatch, resourceIdentity, type ResourceIdentity } from '../src/core/parsers/shared/resources/resourceIdentity.js';
import { parseConversationRecord } from '../src/core/compatibility/record/parseConversationRecord.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { preparePdfItem, pdfDomainSelection } from '../src/core/export/pdf/prepareItem.js';
import type { DomainAsset, DomainConversationDetail, DomainMessage } from '../src/core/domain/conversationDetail.js';
import type { ResourceEvidence } from '../src/core/parsers/shared/resources/resourceEvidence.js';
import type { GeneratedMediaIdentity } from '../src/types/conversation.js';

function baseConversation(assets: DomainAsset[] = [], messages: DomainMessage[] = []): DomainConversationDetail {
    return {
        providerId: 'gemini',
        id: 'c_resource_meta_test',
        title: 'Resource Metadata Contract Test',
        timestamp: 1700000000000,
        assets,
        messages: messages.length ? messages : [{
            id: 'm1',
            role: 'assistant',
            content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello' }] }],
        }],
    };
}

test('1. 时间存在: document.createdAt and generation.time preserve valid Unix milliseconds in Domain', () => {
    const validTime = 1700000000123;
    const evidence: ResourceEvidence = {
        type: 'image',
        id: 'doc-1',
        name: 'test.png',
        url: 'https://example.test/test.png',
        createdAt: validTime,
        generation: {
            chatId: 'c_resource_meta_test',
            providerRequestId: 'req-1',
            time: validTime,
            prompt: 'sunset over mountains',
            generationOrdinal: 1,
            imageCount: 1,
            imageOrdinal: 0,
        },
    };

    const closed = closeDomainResources('gemini', [], [{
        input: { attachments: [evidence] },
        bodyAttachments: [],
    }]);

    assert.equal(closed.assets.length, 1);
    const asset = closed.assets[0];
    assert.equal(asset.document?.createdAt, validTime);
    assert.equal(asset.generation?.time, validTime);

    // validateParserDomain strictly accepts valid timestamps
    const domain = validateParserDomain(baseConversation([asset]));
    assert.equal(domain.assets[0].document?.createdAt, validTime);
    assert.equal(domain.assets[0].generation?.time, validTime);
});

test('2. 时间缺失: document.createdAt and generation.time are omitted when unknown, never fabricated', () => {
    const evidence: ResourceEvidence = {
        type: 'file',
        id: 'file-1',
        name: 'notes.txt',
        url: 'https://example.test/notes.txt',
        generation: {
            chatId: 'c_resource_meta_test',
            generationOrdinal: 0,
            prompt: 'test prompt',
        },
    };

    const closed = closeDomainResources('gemini', [], [{
        input: { attachments: [evidence] },
        bodyAttachments: [],
    }]);

    assert.equal(closed.assets.length, 1);
    const asset = closed.assets[0];

    // Optional fields must be omitted
    assert.equal(asset.document?.createdAt, undefined);
    assert.equal('createdAt' in (asset.document ?? {}), false);
    assert.equal(asset.generation?.time, undefined);
    assert.equal('time' in (asset.generation ?? {}), false);

    const domain = validateParserDomain(baseConversation([asset]));
    assert.equal(domain.assets[0].document?.createdAt, undefined);
    assert.equal(domain.assets[0].generation?.time, undefined);
    assert.equal('createdAt' in (domain.assets[0].document ?? {}), false);
    assert.equal('time' in (domain.assets[0].generation ?? {}), false);
});

test('3. null 输入: Parser boundary normalizes null to omitted, and Domain strictly rejects raw null', () => {
    const evidenceWithNull: ResourceEvidence = {
        type: 'image',
        id: 'doc-null',
        name: 'null-time.png',
        url: 'https://example.test/null.png',
        createdAt: null,
        generation: {
            chatId: 'c_resource_meta_test',
            providerRequestId: 'req-null',
            time: null,
            prompt: 'draw a cat',
            generationOrdinal: 0,
        },
    };

    const closed = closeDomainResources('gemini', [], [{
        input: { attachments: [evidenceWithNull] },
        bodyAttachments: [],
    }]);

    const asset = closed.assets[0];
    assert.equal(asset.document?.createdAt, undefined);
    assert.equal(asset.generation?.time, undefined);
    assert.equal('createdAt' in (asset.document ?? {}), false);
    assert.equal('time' in (asset.generation ?? {}), false);

    // validateParserDomain strictly rejects raw null on document.createdAt
    assert.throws(
        () => validateParserDomain(baseConversation([{
            id: 'raw-null-doc',
            kind: 'file',
            document: { id: 'd1', createdAt: null as never },
        }])),
        /Invalid persisted Domain contract: assets/
    );

    // validateParserDomain strictly rejects raw null on generation.time
    assert.throws(
        () => validateParserDomain(baseConversation([{
            id: 'raw-null-gen',
            kind: 'image',
            generation: { chatId: 'c1', time: null as never, generationOrdinal: 0 },
        }])),
        /Invalid persisted Domain contract: assets/
    );
});

test('4. 字符串与无效时间输入: normalizer safely maps ISO and numeric strings, omits invalid timestamps', () => {
    // Valid ISO and numeric string normalization
    assert.equal(normalizeTimestamp('2026-10-06T12:00:00Z'), Date.parse('2026-10-06T12:00:00Z'));
    assert.equal(normalizeTimestamp('1700000000000'), 1700000000000);

    // Invalid timestamps return undefined
    for (const invalid of ['not-a-date', '', '   ', NaN, Infinity, -Infinity, true, false, {}, []]) {
        assert.equal(normalizeTimestamp(invalid), undefined);
    }

    // String input on ResourceEvidence.createdAt is normalized to Unix ms or omitted
    const evidenceWithString: ResourceEvidence = {
        type: 'file',
        id: 'file-str',
        name: 'data.csv',
        url: 'https://example.test/data.csv',
        createdAt: '2026-10-06T12:00:00Z' as unknown as number,
    };
    const closed = closeDomainResources('gemini', [], [{
        input: { attachments: [evidenceWithString] },
        bodyAttachments: [],
    }]);
    assert.equal(closed.assets[0].document?.createdAt, Date.parse('2026-10-06T12:00:00Z'));

    // Corrupt non-numeric timestamps are rejected by Domain schema
    assert.throws(
        () => validateParserDomain(baseConversation([{
            id: 'corrupt-time',
            kind: 'image',
            generation: { chatId: 'c1', time: 'not-a-number' as never, generationOrdinal: 0 },
        }])),
        /Invalid persisted Domain contract: assets/
    );
});

test('5. RPC 与 Takeout 资源转换: evidence to Domain normalizes timestamps without changing properties', () => {
    // RPC-like evidence with legacy nulls
    const rpcAttachment: ResourceEvidence = {
        type: 'image',
        name: 'rpc-image.png',
        url: 'https://example.test/rpc-image.png',
        isGenerated: true,
        providerRequestId: 'r_abc123',
        imageOrdinal: 0,
        createdAt: null,
        generation: {
            chatId: 'conv-rpc',
            providerRequestId: 'r_abc123',
            time: null,
            prompt: 'high precision drawing',
            generationOrdinal: 1,
            imageCount: 1,
        },
    };

    const rpcClosed = closeDomainResources('gemini', [], [{
        input: { attachments: [rpcAttachment] },
        bodyAttachments: [],
    }]);
    const rpcAsset = rpcClosed.assets[0];
    assert.equal(rpcAsset.generated, true);
    assert.equal(rpcAsset.generation?.providerRequestId, 'r_abc123');
    assert.equal(rpcAsset.generation?.generationOrdinal, 1);
    assert.equal(rpcAsset.generation?.prompt, 'high precision drawing');
    assert.equal('time' in (rpcAsset.generation ?? {}), false);
    assert.equal('createdAt' in (rpcAsset.document ?? {}), false);

    // Takeout-like evidence with second-precision timestamp
    const takeoutAttachment: ResourceEvidence = {
        type: 'image',
        name: 'takeout-image.png',
        url: 'assets/takeout-image.png',
        sourceUrl: 'assets/takeout-image.png',
        isGenerated: true,
        generation: {
            chatId: 'conv-takeout',
            time: 1700000000000,
            prompt: 'takeout prompt',
            generationOrdinal: 0,
            imageCount: 1,
            imageOrdinal: 0,
        },
    };

    const takeoutClosed = closeDomainResources('gemini', [], [{
        input: { attachments: [takeoutAttachment] },
        bodyAttachments: [],
    }]);
    const takeoutAsset = takeoutClosed.assets[0];
    assert.equal(takeoutAsset.generation?.time, 1700000000000);
    assert.equal(takeoutAsset.generation?.prompt, 'takeout prompt');

    // Compatibility parseConversationRecord normalization
    const compatResult = parseConversationRecord({
        id: 'compat-1',
        title: 'Compatibility Record',
        messages: [{
            role: 'model',
            content: 'Here is your file',
            attachments: [{
                type: 'file',
                id: 'compat-doc',
                name: 'doc.pdf',
                url: 'https://example.test/doc.pdf',
                createdAt: null,
                generation: {
                    chatId: 'compat-1',
                    providerRequestId: 'req-compat',
                    time: null,
                    prompt: 'draw chart',
                    generationOrdinal: 0,
                },
            }],
        }],
    }, { providerId: 'gemini' });

    assert.equal(compatResult.conversation.assets.length, 1);
    const compatAsset = compatResult.conversation.assets[0];
    assert.equal('createdAt' in (compatAsset.document ?? {}), false);
    assert.equal('time' in (compatAsset.generation ?? {}), false);
});

test('6. 生成图片身份关联与去重不变: sameGenerationEvent and findResourceMatch parity', () => {
    const timeA = 1700000000123;
    const timeB = 1700000000999; // same second (1700000000)
    const timeDiff = 1700000005000; // different second (1700000005)

    const genBase: GeneratedMediaIdentity = {
        chatId: 'chat-1',
        prompt: 'a tranquil lake',
        generationOrdinal: 1,
    };

    // Both with same second timestamp match
    assert.equal(
        sameGenerationEvent({ ...genBase, time: timeA }, { ...genBase, time: timeB }),
        true
    );

    // Different second timestamps do not match
    assert.equal(
        sameGenerationEvent({ ...genBase, time: timeA }, { ...genBase, time: timeDiff }),
        false
    );

    // eventSecond(undefined) and eventSecond(null) both evaluate to null
    assert.equal(eventSecond(undefined), null);
    assert.equal(eventSecond(null), null);

    // When time is missing/omitted in both, prompt + generationOrdinal alone without time cannot match cross-second
    assert.equal(
        sameGenerationEvent({ ...genBase }, { ...genBase }),
        false
    );
    assert.equal(
        sameGenerationEvent({ ...genBase, time: null }, { ...genBase, time: null }),
        false
    );

    // Request ID matching is authoritative regardless of time presence or absence
    assert.equal(
        sameGenerationEvent(
            { ...genBase, providerRequestId: 'req-authoritative', time: undefined },
            { ...genBase, providerRequestId: 'req-authoritative', time: timeA }
        ),
        true
    );
    assert.equal(
        sameGenerationEvent(
            { ...genBase, providerRequestId: 'req-authoritative', time: null },
            { ...genBase, providerRequestId: 'req-authoritative', time: undefined }
        ),
        true
    );

    // findResourceMatch parity
    const targetAsset: ResourceIdentity = {
        assetId: 'target-1',
        sourceUris: ['https://example.test/img1.png'],
        generation: { ...genBase, time: timeA, imageOrdinal: 0, imageCount: 1 },
    };
    const candidates: ResourceIdentity[] = [
        {
            assetId: 'cand-1',
            sourceUris: ['https://example.test/img-other.png'],
            generation: { ...genBase, time: timeB, imageOrdinal: 0, imageCount: 1 },
        },
        {
            assetId: 'cand-2',
            sourceUris: ['https://example.test/img-diff.png'],
            generation: { ...genBase, time: timeDiff, imageOrdinal: 0, imageCount: 1 },
        },
    ];

    // Matches cand-1 by same-second event and position
    const matchIndex = findResourceMatch('chat-1', {
        assetId: '',
        sourceUris: [],
        generation: { ...genBase, time: timeA, imageOrdinal: 0, imageCount: 1 },
    }, candidates);
    assert.equal(matchIndex, 0);

    // With exact assetId match
    const exactMatch = findResourceMatch('chat-1', targetAsset, [targetAsset, ...candidates]);
    assert.equal(exactMatch, 0);
});

test('7. 历史 Domain 快照读取: restoreDomainSnapshot safely recovers historical nulls and preserves keys', () => {
    // Historical Domain snapshot containing createdAt: null and time: null
    const historicalSnapshot = {
        providerId: 'gemini',
        id: 'c_historical_snapshot',
        title: 'Historical Snapshot',
        timestamp: null,
        assets: [{
            id: 'legacy-asset-1',
            kind: 'image',
            name: 'historical.png',
            generation: {
                chatId: 'c_historical_snapshot',
                providerRequestId: 'hist-req',
                time: null,
                prompt: 'historical prompt',
                generationOrdinal: 0,
            },
            document: {
                id: 'doc-hist',
                createdAt: null,
                contentMarkdown: '# Historical document',
            },
        }],
        messages: [{
            id: 'm1',
            role: 'assistant',
            content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello history' }] }],
        }],
    };

    const restored = restoreDomainSnapshot(historicalSnapshot);
    assert.equal(restored.assets.length, 1);
    const restoredAsset = restored.assets[0];

    // nulls are stripped and fields omitted
    assert.equal(restoredAsset.generation?.time, undefined);
    assert.equal('time' in (restoredAsset.generation ?? {}), false);
    assert.equal(restoredAsset.document?.createdAt, undefined);
    assert.equal('createdAt' in (restoredAsset.document ?? {}), false);

    // Valid fields remain intact
    assert.equal(restoredAsset.generation?.prompt, 'historical prompt');
    assert.equal(restoredAsset.document?.contentMarkdown, '# Historical document');

    // Serialization key order preserved: assets must precede messages as in input
    const serialized = JSON.stringify(restored);
    const assetsIdx = serialized.indexOf('"assets"');
    const messagesIdx = serialized.indexOf('"messages"');
    assert.ok(assetsIdx < messagesIdx, 'assets key must maintain its position before messages');

    // Truly corrupt data in historical assets is rejected, not masked
    assert.throws(
        () => restoreDomainSnapshot({
            ...historicalSnapshot,
            assets: [{ id: 'corrupt', kind: 'invalid-kind' }],
        }),
        /Invalid persisted Domain contract/
    );
});

test('8. HTML / Markdown / PDF 资源行为不变: document renderers handle assets with valid or omitted times', async () => {
    const makeConversationWithAsset = (time?: number): DomainConversationDetail => ({
        providerId: 'gemini',
        id: 'c_export_parity',
        title: 'Export Parity Test',
        timestamp: 1700000000000,
        assets: [{
            id: 'img-1',
            kind: 'image',
            name: 'illustration.png',
            source: { uri: 'https://example.test/img.png' },
            dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            generation: {
                chatId: 'c_export_parity',
                prompt: 'a diagram',
                generationOrdinal: 0,
                ...(time !== undefined ? { time } : {}),
            },
            document: {
                id: 'doc-1',
                contentMarkdown: '# Report details',
                ...(time !== undefined ? { createdAt: time } : {}),
            },
        }],
        messages: [{
            id: 'm1',
            role: 'assistant',
            content: [
                { type: 'paragraph', children: [{ type: 'text', text: 'Here is the image:' }] },
                { type: 'image', assetId: 'img-1', alt: 'illustration' },
            ],
            attachmentIds: ['img-1'],
        }],
    });

    const convWithTime = validateParserDomain(makeConversationWithAsset(1700000000000));
    const convWithoutTime = validateParserDomain(makeConversationWithAsset(undefined));

    // HTML rendering parity
    const docWithTime = composeDomainDocument(convWithTime).document;
    const docWithoutTime = composeDomainDocument(convWithoutTime).document;

    const htmlWithTime = renderDocumentHtml(docWithTime, {});
    const htmlWithoutTime = renderDocumentHtml(docWithoutTime, {});
    assert.equal(htmlWithTime.html, htmlWithoutTime.html);

    // Markdown rendering parity
    const mdWithTime = renderDocumentMarkdown(docWithTime, {});
    const mdWithoutTime = renderDocumentMarkdown(docWithoutTime, {});
    assert.equal(mdWithTime, mdWithoutTime);

    // PDF preparation parity
    const pdfWithTime = await preparePdfItem(pdfDomainSelection(convWithTime), { includeAssets: false });
    const pdfWithoutTime = await preparePdfItem(pdfDomainSelection(convWithoutTime), { includeAssets: false });
    assert.equal(pdfWithTime.ok, true);
    assert.equal(pdfWithoutTime.ok, true);
    assert.deepEqual(pdfWithTime.document, pdfWithoutTime.document);
});
