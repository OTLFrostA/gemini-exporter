/**
 * tests/canonical-generated-image-consistency.test.ts
 * Tier 1 unit tests for PR 4 (Issue D): Generated Image Semantic Consistency.
 *
 * Verifies:
 * 1. Single generated image -> 1 inline figure + 1 companion card
 * 2. Multiple generated images -> N inline figures + N companion cards
 * 3. Uploaded image attachment (user turn) -> 0 inline figures + 1 attachment card (no upgrade)
 * 4. Inline Markdown image attachment -> 0 duplicate companion cards
 * 5. Real-world 040ffd Imagen regression shape (model text + 6 generated images)
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const canonical = require('../src/core/export/canonical/index.js');
const { normalizeGeminiConversation, renderCanonicalHtml } = canonical;

test('PR 4 - 1: Single generated image on model turn renders 1 inline figure and 1 companion card', async () => {
    const raw: any = {
        id: 'c_gen_single',
        title: 'Single Imagen Test',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: 'Here is your generated image of a martian cat.',
                images: [
                    {
                        type: 'image',
                        name: 'martian_cat.png',
                        localName: 'assets/martian_cat.png',
                        url: 'https://example.com/martian_cat.png',
                    },
                ],
            },
        ],
    };

    const { bundle } = await normalizeGeminiConversation(raw);
    const msg = bundle.conversation.messages[0];

    // Canonical AST check
    const imgBlock = msg.blocks.find((b: any) => b.type === 'image');
    assert.ok(imgBlock, 'ImageBlock must exist in canonical blocks');
    assert.strictEqual(imgBlock.origin, 'generated', 'ImageBlock origin must be "generated"');

    // HTML Rendering check
    const { html, diagnostics } = renderCanonicalHtml(bundle);
    assert.strictEqual(diagnostics.length, 0, 'Expected zero diagnostics for resolvable image');

    // 1 inline visual figure in model content
    const inlineFigures = html.match(/<figure class="gem-figure gem-image-block"/g) || [];
    assert.strictEqual(inlineFigures.length, 1, 'Expected exactly 1 inline <figure> in model content');
    assert.ok(html.includes('class="gem-msg-img"'), 'Expected inline image to have gem-msg-img class');
    assert.ok(html.includes('src="assets/martian_cat.png"'), 'Expected image URL in inline img src');

    // 1 companion card in carousel
    const cards = html.match(/<a class="gem-att-card gem-att-img"/g) || [];
    assert.strictEqual(cards.length, 1, 'Expected exactly 1 companion card in carousel');
    assert.ok(html.includes('href="assets/martian_cat.png"'), 'Expected companion card to link to image storageRef');
});

test('PR 4 - 2: Multiple generated images on model turn render N inline figures and N companion cards', async () => {
    const images = [
        { type: 'image', name: 'cat_variant_1.png', localName: 'assets/cat_1.png', url: 'https://example.com/cat_1.png' },
        { type: 'image', name: 'cat_variant_2.png', localName: 'assets/cat_2.png', url: 'https://example.com/cat_2.png' },
        { type: 'image', name: 'cat_variant_3.png', localName: 'assets/cat_3.png', url: 'https://example.com/cat_3.png' },
        { type: 'image', name: 'cat_variant_4.png', localName: 'assets/cat_4.png', url: 'https://example.com/cat_4.png' },
    ];

    const raw: any = {
        id: 'c_gen_multi',
        title: 'Multiple Imagen Test',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: 'Here are 4 variants of your request.',
                images,
            },
        ],
    };

    const { bundle } = await normalizeGeminiConversation(raw);
    const msg = bundle.conversation.messages[0];

    const imgBlocks = msg.blocks.filter((b: any) => b.type === 'image');
    assert.strictEqual(imgBlocks.length, 4, 'Expected 4 canonical ImageBlocks');
    for (const b of imgBlocks) {
        assert.strictEqual(b.origin, 'generated', 'Every model image block must have origin "generated"');
    }

    const { html, diagnostics } = renderCanonicalHtml(bundle);
    assert.strictEqual(diagnostics.length, 0, 'Expected zero diagnostics');

    // N inline figures
    const inlineFigures = html.match(/<figure class="gem-figure gem-image-block"/g) || [];
    assert.strictEqual(inlineFigures.length, 4, 'Expected 4 inline figures');

    // N companion cards
    const cards = html.match(/<a class="gem-att-card gem-att-img"/g) || [];
    assert.strictEqual(cards.length, 4, 'Expected 4 companion cards');

    // Verify all 4 paths exist in both inline figures and companion cards
    for (let i = 1; i <= 4; i++) {
        const path = `assets/cat_${i}.png`;
        const count = html.split(path).length - 1;
        // Each path appears at least twice (inline img + card)
        assert.ok(count >= 2, `Expected path ${path} to appear at least twice in HTML, found ${count}`);
    }
});

test('PR 4 - 3: User uploaded image attachment renders 0 inline figures and 1 attachment card', async () => {
    const raw: any = {
        id: 'c_user_upload',
        title: 'User Upload Test',
        messages: [
            {
                id: 'u1',
                role: 'user',
                content: 'Analyze this photo from my garden.',
                attachments: [
                    {
                        type: 'image',
                        name: 'garden_photo.jpg',
                        localName: 'assets/garden_photo.jpg',
                        url: 'https://example.com/garden_photo.jpg',
                    },
                ],
            },
            {
                id: 'm1',
                role: 'model',
                content: 'That looks like a beautiful rose garden.',
            },
        ],
    };

    const { bundle } = await normalizeGeminiConversation(raw);
    const userMsg = bundle.conversation.messages[0];

    // Canonical AST check
    const userImgBlock = userMsg.blocks.find((b: any) => b.type === 'image');
    assert.ok(userImgBlock, 'User image block must exist');
    assert.strictEqual(userImgBlock.origin, 'attachment', 'User image must have origin "attachment", NOT "generated"');

    const { html } = renderCanonicalHtml(bundle);

    // User prompt bubble must NOT contain inline image figures
    const userTurn = html.slice(html.indexOf('<section class="gem-turn gem-turn-user"'), html.indexOf('<section class="gem-turn gem-turn-model"'));
    const userBubble = userTurn.slice(userTurn.indexOf('gem-user-bubble'));
    assert.ok(!userBubble.includes('gem-image-block'), 'User prompt bubble must not contain .gem-image-block inline figures');
    assert.ok(!userBubble.includes('gem-msg-img'), 'User prompt bubble must not contain .gem-msg-img');

    // User turn carousel track MUST contain the attachment card
    const userCards = userTurn.match(/<a class="gem-att-card gem-att-img"/g) || [];
    assert.strictEqual(userCards.length, 1, 'Expected exactly 1 attachment card in user turn');
    assert.ok(userTurn.includes('garden_photo.jpg'), 'Attachment card must display file name');
});

test('PR 4 - 4: Generated image with explicit markdown embed does not produce duplicate cards', async () => {
    const raw: any = {
        id: 'c_markdown_dedup',
        title: 'Markdown Embed Dedup Test',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: 'Here is the generated output:\n\n![Generated Image](assets/generated_preview.png)',
                attachments: [
                    {
                        type: 'image',
                        localName: 'assets/generated_preview.png',
                        name: 'generated_preview.png',
                        url: 'https://example.com/generated_preview.png',
                        isGenerated: true,
                    },
                ],
            },
        ],
    };

    const { bundle } = await normalizeGeminiConversation(raw);
    const { html } = renderCanonicalHtml(bundle);

    // Markdown inline image rendered
    assert.ok(html.includes('gem-inline-img'), 'Expected inline markdown image to be rendered');
    assert.ok(html.includes('assets/generated_preview.png'), 'Expected asset path in HTML');

    // No duplicate companion cards for inline markdown image
    const cards = html.match(/<a class="gem-att-card/g) || [];
    assert.strictEqual(cards.length, 0, 'Explicit inline markdown image should not generate redundant companion cards');
});

test('PR 4 - 5: Real-world 040ffd Imagen regression shape (model text + 6 generated images)', async () => {
    const rawImages = [
        { type: 'image', name: 'cat_01.jpg', localName: 'assets/cat_01.jpg', url: 'https://example.com/cat_01.jpg' },
        { type: 'image', name: 'cat_02.jpg', localName: 'assets/cat_02.jpg', url: 'https://example.com/cat_02.jpg' },
        { type: 'image', name: 'cat_03.jpg', localName: 'assets/cat_03.jpg', url: 'https://example.com/cat_03.jpg' },
        { type: 'image', name: 'cat_04.jpg', localName: 'assets/cat_04.jpg', url: 'https://example.com/cat_04.jpg' },
        { type: 'image', name: 'cat_05.jpg', localName: 'assets/cat_05.jpg', url: 'https://example.com/cat_05.jpg' },
        { type: 'image', name: 'cat_06.jpg', localName: 'assets/cat_06.jpg', url: 'https://example.com/cat_06.jpg' },
    ];

    const raw: any = {
        id: '97f22329fd040ffd',
        title: 'Martian Astronaut Cat Drinking Coffee',
        messages: [
            {
                id: 'msg-0',
                role: 'user',
                content: 'Generate images of a martian astronaut cat drinking coffee on Mars.',
            },
            {
                id: 'msg-1',
                role: 'model',
                content: 'Here are several concepts of a martian astronaut cat enjoying coffee on Mars:',
                images: rawImages,
                attachments: rawImages,
            },
        ],
    };

    const { bundle } = await normalizeGeminiConversation(raw);
    const modelMsg = bundle.conversation.messages[1];

    // Verify deduplication in normalizeMessage (rawImages passed in both images and attachments)
    const imgBlocks = modelMsg.blocks.filter((b: any) => b.type === 'image');
    assert.strictEqual(imgBlocks.length, 6, 'Expected exactly 6 image blocks after attachment deduplication');

    const { html, diagnostics } = renderCanonicalHtml(bundle);
    assert.strictEqual(diagnostics.length, 0, 'Expected zero diagnostics');

    // Verify model content is NOT empty
    const modelTurn = html.slice(html.indexOf('gem-turn-model'));
    const modelContentMatch = modelTurn.match(/<div class="gem-model-content">([\s\S]*?)<\/div>/);
    assert.ok(modelContentMatch, 'gem-model-content must exist in model turn');
    const modelContent = modelContentMatch[1];

    // Must contain intro text
    assert.ok(modelContent.includes('Here are several concepts'), 'gem-model-content must contain the model text response');

    // Must contain all 6 inline figures
    const inlineFigures = modelContent.match(/<figure class="gem-figure gem-image-block"/g) || [];
    assert.strictEqual(inlineFigures.length, 6, 'gem-model-content must contain all 6 generated images inline');

    // Carousel must contain all 6 companion download cards
    const cards = modelTurn.match(/<a class="gem-att-card gem-att-img"/g) || [];
    assert.strictEqual(cards.length, 6, 'Carousel must contain all 6 companion download cards');
});
