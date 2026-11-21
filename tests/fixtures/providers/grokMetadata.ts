import { describeFixtures, synthetic, captured } from './provenance.js';
import { metadataBody, imageDetailBody } from './grok/sources.js';

const fixtureMap = {
    'GR_METADATA_01': () => metadataBody(),
    'GR_IMAGE_METADATA_01': () => imageDetailBody().metadata,
};

export function metadataGen(key: keyof typeof fixtureMap) { return fixtureMap[key](); }

export const fixtureOrigins = describeFixtures(fixtureMap, synthetic("Authored Grok protocol, content or state counterexample; no saved capture is used."), {
    GR_METADATA_01: captured("tests/fixtures/providers/grokDetail.json", "metadata endpoint body"),
    GR_IMAGE_METADATA_01: captured("tests/fixtures/providers/grokImageDetail.json", "metadata endpoint body"),
});
