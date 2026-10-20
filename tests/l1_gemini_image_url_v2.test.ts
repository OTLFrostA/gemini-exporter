// L1 owns Gemini source image URL normalization. Runtime unit tests only
// exercise the public runtime resource fetch/IPC behavior with mocked L1 inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { highResVariant } from '../src/l1/client/gemini/geminiImageUrl.js';

test('L1 Gemini /gg/ and /rd-gg/ source image URLs normalize to canonical original rendition', () => {
    const bareGg = 'https://lh3.googleusercontent.com/gg/AN-53XYZ1234567890';
    const bareRdGg = 'https://lh3.googleusercontent.com/rd-gg/AN-53XYZ1234567890';
    assert.equal(highResVariant(bareGg), bareGg + '=s0');
    assert.equal(highResVariant(bareGg + '?authuser=0'), bareGg + '=s0?authuser=0');
    assert.equal(highResVariant(bareGg + '=s512-rj?authuser=0'), bareGg + '=s0?authuser=0');
    assert.equal(highResVariant(bareRdGg), bareRdGg + '=s0');
});
