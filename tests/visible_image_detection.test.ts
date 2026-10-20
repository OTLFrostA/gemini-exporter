import { fixtureAccount } from './helpers/domainFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractResponseImageEvidence: extractResponseImages } = require('../src/l1/parsers/gemini/rpc/sourceAttachments.js');
const { parseGeminiRpcConversation } = require('../src/l1/parsers/gemini/rpc/parseConversation.js');
const { decodeGeminiDetail } = require('../src/l1/parsers/gemini/rpc/detailDecoder.js');

// Same media tuple shape as the false detections in the user's diagnostics.
const searchUrl = 'https://encrypted-tbn2.gstatic.com/licensed-image?q=example';
const searchResult = [
    [[searchUrl], null, 2048, 1536, null, null, null, 0, 'getty:example', 'getty', 'Getty Images'],
    [['https://www.gettyimages.com/detail/example'], '', 8], null,
    [[searchUrl], null, 2048, 1536, null, null, null, 0], null, null, null,
    ['http://googleusercontent.com/image_agent_tag_example', null, 'Reference diagram', null, null, 1]
];

function rawWithMetadata(document?: unknown, secondCandidate?: any): string {
    const candidate: any[] = ['rc_visible_images_test', ['Answer without pictures'], 'en'];
    candidate[12] = [searchResult];
    const model: any[] = [[candidate, ...(secondCandidate ? [secondCandidate] : [])]];
    if (document) model[12] = document;
    const turn = [['c_visible_images_test'], [1700000000, 0], [['Question']], model];
    const rpc = ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn]])]]);
    return rpc;
}
function parseWithMetadata(document?: unknown, secondCandidate?: any): any {
    return decodeGeminiDetail(rawWithMetadata(document, secondCandidate), 'c_visible_images_test');
}

test('candidate search metadata does not become a phantom image in native Domain Markdown', () => {
    const result = parseWithMetadata();
    const answer = result.messages.find((m: any) => m.role === 'model');
    assert.ok(answer);
    assert.equal(answer.images, undefined);
    assert.equal(answer.attachments, undefined);

    // Check the actual native parser -> Domain -> Document -> Markdown path.
    const native = parseGeminiRpcConversation(rawWithMetadata(), { providerId: 'gemini', account: fixtureAccount() });
    assert.deepStrictEqual(native.conversation.detail.assets, [], 'search metadata is not an authored image resource');
    const markdown = JSON.stringify(native.conversation.detail.messages.map((message: any) => message.content));
    assert.match(markdown, /Answer without pictures/);
    assert.doesNotMatch(markdown, /assets\/|Reference diagram|licensed-image/);
});

test('real wire answer image survives while unrelated search metadata is excluded', () => {
    const wire = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/provider/structured_rpc/wire-turn-3-12-b-stack.json'), 'utf8'));
    const result = parseWithMetadata(wire);
    const answer = result.messages.find((m: any) => m.role === 'model');
    assert.equal(answer.images.length, 1);
    assert.match(answer.images[0].sourceUrl, /encrypted-tbn0\.gstatic\.com\/images/);
    assert.equal(answer.attachments.filter((a: any) => a.type === 'image').length, 1);
});

test('direct image URLs in Markdown survive without structured answer data', () => {
    const images = extractResponseImages([searchResult], [], `![diagram](${searchUrl})`);
    assert.equal(images.length, 1);
});

test('plain image-agent placeholders do not prove an image was rendered', () => {
    assert.equal(extractResponseImages([searchResult], [], '<Image src="image_agent_tag_example" />').length, 0);
});

test('uploaded image tuples remain supported outside search-result metadata', () => {
    const upload = ['https://lh3.googleusercontent.com/upload.png', 640, 480];
    assert.equal(extractResponseImages([upload], [], 'Answer').length, 1);
});

test('unselected candidates are omitted without losing the primary answer image', () => {
    const wire = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/provider/structured_rpc/wire-turn-3-12-b-stack.json'), 'utf8'));
    const secondary: any[] = ['rc_secondary_images_test', ['Second answer without pictures'], 'en'];
    secondary[12] = [searchResult];
    const answers = parseWithMetadata(wire, secondary).messages.filter((m: any) => m.role === 'model');
    assert.equal(answers.length, 1);
    assert.equal(answers[0].images.length, 1);
    assert.equal(answers[0].id, 'rc_visible_images_test');
});
