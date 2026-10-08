import { messageAssets } from './helpers/domainAssets.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correlateGeneratedImages, type GenerationBlock, type TakeoutWatermarkedImage, type ParseTakeoutHtmlOutput } from '../src/core/compatibility/takeout/takeoutHtmlParser.js';
import { parseTakeoutZip } from '../src/core/compatibility/takeout/takeoutParser.js';
import { clearTakeoutData } from '../src/core/compatibility/takeout/mediaIndex.js';
import { toDomainConversationDetail } from '../src/core/compatibility/legacyConversationAdapter.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { collectDocumentResources } from '../src/core/document/ast/resourceReferences.js';

const time = 1700000000000;
function event(chatId: string, offset: number, imageCount = 1): GenerationBlock {
    return { chatId, time: time + offset, prompt: 'Draw a cat', imageCount,
        generation: { chatId, time: time + offset, prompt: 'Draw a cat', imageCount, generationOrdinal: 0 } };
}
function correlate(images: TakeoutWatermarkedImage[], blocks: GenerationBlock[]) {
    const state: ParseTakeoutHtmlOutput = { genBlocks: blocks, localMediaMap: {}, localConvCache: {}, extractedMap: {} };
    for (const block of blocks) {
        state.localConvCache[block.chatId] = { id: block.chatId, title: 'Images', timestamp: block.time,
            messages: [{ role: 'model', content: 'Answer', generation: block.generation }] };
    }
    correlateGeneratedImages(images, blocks, state.localMediaMap, state.localConvCache, state.extractedMap);
    return state;
}

function domainFromCache(cached: ParseTakeoutHtmlOutput['localConvCache'][string]) {
    return toDomainConversationDetail({ ...cached, messages: cached.messages?.map(message => ({
        ...message,
        attachments: message.attachments?.map(a => ({ type: 'image', ...a })),
        images: message.images?.map(a => ({ type: 'image', ...a })),
    })) });
}

test('Takeout chooses the closest event by absolute distance, independent of block order', () => {
    const farther = event('farther', 4000);
    const closest = event('closest', -1000);
    for (const blocks of [[farther, closest], [closest, farther]]) {
        const result = correlate([{ filename: 'cat.png', time }], blocks);
        assert.equal(result.localMediaMap.farther, undefined);
        assert.equal(result.localMediaMap.closest[0].generation?.chatId, 'closest');
        assert.equal(result.localMediaMap.closest[0].imageOrdinal, 0);
        const domain = domainFromCache(result.localConvCache.closest);
        assert.equal(messageAssets(domain, 0)?.[0].name, 'cat.png');
        assert.equal('generation' in domain.messages[0], false);
        assert.equal(messageAssets(domain, 0)?.[0].generation?.imageCount, 1);
    }
});

test('Equally close Takeout events remain unresolved in either order', () => {
    const before = event('before', -1000);
    const after = event('after', 1000);
    const images = [{ filename: 'ambiguous.png', time }];
    for (const blocks of [[before, after], [after, before]]) {
        const result = correlate(images, blocks);
        assert.deepEqual(result.localMediaMap, {});
        assert.ok(Object.values(result.localConvCache).every(c => !c.messages?.[0].attachments));
        assert.deepEqual(images, [{ filename: 'ambiguous.png', time }], 'source media remains available without guessed ownership');
    }
});

test('Takeout retains the existing asymmetric correlation window, including singleton events', () => {
    for (const offset of [-5000, 120000, -5001, 120001]) {
        const result = correlate([{ filename: 'cat.png', time: time + offset }], [event('chat', 0)]);
        assert.equal(Boolean(result.localMediaMap.chat), offset >= -5000 && offset <= 120000);
    }
});

test('Multi-image ZIP enumeration does not establish ordinals or collapse images downstream', async () => {
    const images = [
        { filename: 'first.png', time: time + 1000, providerRequestId: 'abcd1234abcd1234' },
        { filename: 'second.png', time: time + 1000, providerRequestId: 'abcd1234abcd1234' },
    ];
    for (const ordered of [images, [...images].reverse()]) {
        const result = correlate(ordered, [event('chat', 0, 2)]);
        assert.equal(result.localMediaMap.chat.length, 2);
        for (const image of result.localMediaMap.chat) {
            assert.equal(image.imageOrdinal, undefined);
            assert.equal(image.generation?.imageOrdinal, undefined);
        }
        const domain = domainFromCache(result.localConvCache.chat);
        assert.equal(domain.messages.length, 1);
        assert.equal('generation' in domain.messages[0], false);
        assert.deepEqual(messageAssets(domain, 0)?.map(a => a.name).sort(), ['first.png', 'second.png']);
        assert.equal(collectDocumentResources(composeDomainDocument(domain).document).referencedIds.size, 2);
    }
});

test('Multi-image ordinal is preserved only when supplied by source evidence', () => {
    const result = correlate([{ filename: 'second.png', time, imageOrdinal: 1 }], [event('chat', 0, 2)]);
    assert.equal(result.localMediaMap.chat[0].imageOrdinal, 1);
    assert.equal(result.localMediaMap.chat[0].generation?.imageOrdinal, 1);
});


test('Ambiguous ZIP media retains its original bytes without claiming either generation event', async () => {
    const JSZip = require('../lib/jszip.min.js') as new () => {
        file(name: string, data: string | Uint8Array): void;
        generateAsync(options: { type: 'uint8array' }): Promise<Uint8Array>;
    };
    const previousJSZip: unknown = Reflect.get(globalThis, 'JSZip');
    Reflect.set(globalThis, 'JSZip', JSZip);
    const slot = 'ambiguous-generated-zip';
    try {
        const zip = new JSZip();
        const chatId = 'abcd1234abcd1234';
        const html = [40, 44].map(second => `<div class="outer-cell"><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted draw a cat<br>1 generated image.<br>Sep 2, 2026, 11:36:${second} AM PDT<br></div>https://gemini.google.com/app/${chatId}</div>`).join('');
        const filename = 'watermarked_img_unresolved.png';
        const bytes = new TextEncoder().encode('c2pa date="20260902183642Z"');
        zip.file('Takeout/Gemini Apps/MyActivity.html', html);
        zip.file(filename, bytes);
        const parsed = await parseTakeoutZip(await zip.generateAsync({ type: 'uint8array' }), null, slot);
        assert.equal(parsed.mediaMap[chatId]?.length ?? 0, 0);
        assert.ok(parsed.convCache[chatId].messages?.every((m: { attachments?: unknown[] }) => !m.attachments?.length));
        const stored = parsed.globalMedia[filename];
        assert.deepEqual(await stored.async!('uint8array'), bytes);
    } finally {
        clearTakeoutData(slot);
        Reflect.set(globalThis, 'JSZip', previousJSZip);
    }
});
