export {};
const test = require('node:test');
const assert = require('node:assert');

const { isInternalChipUrl, stripInternalChipMarkdown } = require('../src/core/utils/chipUtils.js');

test('chipUtils - isInternalChipUrl detects all Google internal chip URLs', () => {
    // Both long and short variants
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/deep_research/abc'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/deep_research_confirmation_content/xyz'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/map_content/1'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/map_location/2'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/map_location_reference/3'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/web_search/query'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/web_search_content/query'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/grounding_content/ref'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/youtube_content/video'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/image_generation_content/img'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/generated_image/art'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/workspace_content/doc'), true);

    // Negative cases
    assert.strictEqual(isInternalChipUrl(null), false);
    assert.strictEqual(isInternalChipUrl(''), false);
    assert.strictEqual(isInternalChipUrl('https://google.com'), false);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/avatar/profile.jpg'), false);
    assert.strictEqual(isInternalChipUrl('https://example.com/deep_research'), false);
});

test('chipUtils - stripInternalChipMarkdown removes standalone chips and unwraps links', () => {
    // 1. Unwrapping markdown link
    const textWithLink = 'Refer to the report: [Deep Research Analysis](https://googleusercontent.com/deep_research/ref123).';
    assert.strictEqual(
        stripInternalChipMarkdown(textWithLink),
        'Refer to the report: Deep Research Analysis.'
    );

    // 2. Standalone URL lines
    const textWithStandalone = 'Line 1\nhttps://googleusercontent.com/map_content/loc1\nLine 2';
    assert.strictEqual(
        stripInternalChipMarkdown(textWithStandalone),
        'Line 1\n\nLine 2'
    );

    // 3. Bracketed standalone URL line
    const textWithBracketed = 'Header\n[https://googleusercontent.com/web_search_content/q1]\nFooter';
    assert.strictEqual(
        stripInternalChipMarkdown(textWithBracketed),
        'Header\n\nFooter'
    );

    // 4. Preserves non-chip links
    const textWithRealLink = 'Check [Google Search](https://www.google.com) for details.';
    assert.strictEqual(
        stripInternalChipMarkdown(textWithRealLink),
        'Check [Google Search](https://www.google.com) for details.'
    );
});
