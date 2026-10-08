export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { messageAssets } = require('./helpers/domainAssets.js');
const { TakeoutEngine } = require('../src/core/engine/takeoutEngine.js');
const { parseFixture } = require('./helpers/documentFixture.js');
const { composeDomainDocument } = require('../src/core/document/compose/composeDomainDocument.js');

const id = '1bd028d5c5b0c0e2';
const prompt = 'Generate an image of a cute futuristic astronaut cat drinking coffee on Mars with high detail';
const time = Date.parse('2026-09-02T18:36:40.472Z');
const png = 'watermarked_img_45281370108017511-1c81efe352c9ef8a.png';
const jpg = 'watermarked_img_4528137010801751197.jpg';
function onlineChat(): any {
    return { id, messages: [
        { id: 'r_1c81efe352c9ef8a', role: 'user', content: prompt, timestamp: time },
        { id: 'm1', role: 'model', providerRequestId: '1c81efe352c9ef8a', content: '', images: [{
            type: 'image', fileName: jpg, sourceUrl: 'https://lh3.googleusercontent.com/generated-cat',
            localName: `assets/${jpg}`, isGenerated: true, providerRequestId: '1c81efe352c9ef8a', imageOrdinal: 0
        }] },
    ] };
}

test('real Takeout fixture retains generation evidence without guessing ownership of an unreferenced PNG', async () => {
    (global as any).JSZip = require('../lib/jszip.min.js');
    TakeoutEngine.clearTakeoutData('identity');
    try {
        const result = await TakeoutEngine.parseTakeoutZip(fs.readFileSync(path.join(__dirname, 'fixtures/gemini_takeout_clean.zip')), null, 'identity');
        const offline = TakeoutEngine.getTakeoutOfflineChat(id, 'identity');
        assert.ok(offline.conversation, 'production cache must carry native Domain');
        const model = offline.conversation.messages.find((m: any) => m.role === 'assistant');
        assert.deepEqual(model.generation, { mediaKind: 'image', outputCount: 1 });
        assert.deepEqual(TakeoutEngine.getTakeoutMediaForChat(id, 'identity'), []);
        assert.ok(result.diagnostics.some((d: any) => d.code === 'TAKEOUT_GENERATED_MEDIA_UNRESOLVED'));
        assert.ok((await result.globalMedia[png].async('uint8array')).length > 0, 'unowned archive bytes remain available as acquisition evidence');
        assert.equal(await TakeoutEngine.getTakeoutFallbackMedia(id, { assetId: '', sourceUri: png }, 'identity'), null, 'an archive file does not establish message ownership');
        for (const record of result.conversations) {
            assert.equal('parsed' in record, false);
            assert.equal('messages' in record, false, 'imports remain metadata-only and cannot overwrite stored detail');
        }
    } finally { TakeoutEngine.clearTakeoutData('identity'); }
});

test('RPC generated-media detector preserves generated status while inline images remain unmarked', () => {
    const { extractImages } = require('../src/core/compatibility/gemini/attachments.js');
    const generated: any[] = Array(16).fill(null);
    generated[2] = jpg;
    generated[3] = 'https://lh3.googleusercontent.com/generated';
    generated[11] = 'image/jpeg';
    generated[15] = [512, 512, 1000];
    assert.equal(extractImages([generated])[0].isGenerated, true);
    assert.equal(extractImages([['https://lh3.googleusercontent.com/inline', 512, 512]])[0].isGenerated, undefined);
});

test('regression: extractImages suppresses 2x inline tuple duplicate sharing token with generated media', () => {
    const { extractImages } = require('../src/core/compatibility/gemini/attachments.js');
    const token = '8815680899422160530';
    const inlineTuple = ['https://lh3.googleusercontent.com/inline-2x', 2816, 1536, token];
    const generatedNode: any[] = Array(16).fill(null);
    generatedNode[2] = 'watermarked_img_4528137010801751197.jpg';
    generatedNode[3] = 'https://lh3.googleusercontent.com/gg/original';
    generatedNode[5] = token;
    generatedNode[11] = 'image/jpeg';
    generatedNode[15] = [1408, 768, 924784];

    // Order 1: inline tuple first, generated node second (typical JSPB walk order)
    const imgs1 = extractImages([inlineTuple, generatedNode]);
    assert.equal(imgs1.length, 1, 'Must deduplicate to exactly 1 image');
    assert.equal(imgs1[0].fileName, 'watermarked_img_4528137010801751197.jpg');
    assert.equal(imgs1[0].isGenerated, true);
    assert.equal(imgs1[0].width, 1408);
    assert.equal(imgs1[0].height, 768);

    // Order 2: generated node first, inline tuple second
    const imgs2 = extractImages([generatedNode, inlineTuple]);
    assert.equal(imgs2.length, 1, 'Must deduplicate to exactly 1 image');
    assert.equal(imgs2[0].fileName, 'watermarked_img_4528137010801751197.jpg');
    assert.equal(imgs2[0].isGenerated, true);
    assert.equal(imgs2[0].width, 1408);
    assert.equal(imgs2[0].height, 768);
});

test('regression: extractImages suppresses 2x upscale derivative rendition (slot 8 === 2) and retains authoritative 1x watermarked image', () => {
    const { extractImages } = require('../src/core/compatibility/gemini/attachments.js');
    const baseNode: any[] = Array(16).fill(null);
    baseNode[2] = 'watermarked_img_4528137010801751197.jpg';
    baseNode[3] = 'https://lh3.googleusercontent.com/gg/original';
    baseNode[5] = '$token_base';
    baseNode[8] = null; // base authoritative generation
    baseNode[11] = 'image/jpeg';
    baseNode[15] = [1408, 768, 934819];

    const upscaleNode: any[] = Array(25).fill(null);
    upscaleNode[2] = '8815680899422160530.jpeg';
    upscaleNode[3] = 'https://lh3.googleusercontent.com/gg/upscaled';
    upscaleNode[5] = '$token_upscale';
    upscaleNode[8] = 2; // 2x upscale derivative rendition
    upscaleNode[11] = 'image/jpeg';
    upscaleNode[15] = [2816, 1536, 3435994];

    const imgs = extractImages([baseNode, upscaleNode]);
    assert.equal(imgs.length, 1, 'Must retain only 1 authoritative base image');
    assert.equal(imgs[0].fileName, 'watermarked_img_4528137010801751197.jpg');
    assert.equal(imgs[0].width, 1408);
    assert.equal(imgs[0].height, 768);
    assert.equal(imgs[0].isGenerated, true);
});

test('regression: extractTurnRequestId schema slot evidence and fallback boundaries', () => {
    const { extractTurnRequestId } = require('../src/core/parsers/gemini/rpc/detailDecoder.js');
    const { GEMINI_JSPB_SCHEMA } = require('../src/core/parsers/gemini/rpc/extractors.js');

    // Verify schema constant
    assert.equal(GEMINI_JSPB_SCHEMA.TURN.REQUEST_ID_SLOT, 1, 'REQUEST_ID_SLOT must be index 1 in ID_META');

    // Case 1: Standard canonical slot: idMeta[1] carries "r_<hex>"
    const turnStandard = [
        ["c_d3226d9a046c1116", "r_1c81efe352c9ef8a"],
        [1725302200, 0],
        [["user text"]],
        [[["rc_model_1", ["model text"]]]]
    ];
    assert.equal(extractTurnRequestId(turnStandard), '1c81efe352c9ef8a', 'Extract from standard slot 1');

    // Case 2: Standalone slot 0 when convId is absent
    const turnStandalone = [
        ["r_2b3c4d5e6f7a8b9c"],
        [1725302200, 0],
        [["user text"]],
        [[["rc_model_1", ["model text"]]]]
    ];
    assert.equal(extractTurnRequestId(turnStandalone), '2b3c4d5e6f7a8b9c', 'Extract from slot 0 when convId is absent');

    // Case 3: Direct string idMeta
    const turnStringId = [
        "r_9988776655443322",
        [1725302200, 0]
    ];
    assert.equal(extractTurnRequestId(turnStringId), '9988776655443322', 'Extract from direct string idMeta');

    // Case 4: Non-schema slot (e.g. slot 2) must NOT be matched via .find() heuristic (returns undefined)
    const turnUnconfirmedSlot = [
        ["c_conv123", null, "r_unconfirmed12345678"],
        [1725302200, 0]
    ];
    assert.equal(extractTurnRequestId(turnUnconfirmedSlot), undefined, 'Must return undefined for unconfirmed slot (no .find() heuristic)');

    // Case 5: "r_" in turn[1] (TIMESTAMP slot) or other non-id slots must be REJECTED
    const turnWithRInTimestamp = [
        ["c_conv123"],
        "r_fake_in_timestamp_slot"
    ];
    assert.equal(extractTurnRequestId(turnWithRInTimestamp), undefined, 'Must NEVER search outside ID_META (e.g. timestamp slot 1)');

    // Case 6: No r_ present anywhere in idMeta
    const turnNoR = [
        ["c_conv123", "non_r_identifier"],
        [1725302200, 0]
    ];
    assert.equal(extractTurnRequestId(turnNoR), undefined, 'Return undefined when no r_ present');
});

