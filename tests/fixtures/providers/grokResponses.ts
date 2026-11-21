import { describeFixtures, synthetic, captured } from './provenance.js';
import { responsesBody, imageDetailBody } from './grok/sources.js';

const fixtureMap = {
    'GR_RESPONSES_01': () => responsesBody(),
    'GR_IMAGE_RESPONSES_01': () => imageDetailBody().bodies,
};

export function responsesGen(key: keyof typeof fixtureMap) { return fixtureMap[key](); }

export const fixtureOrigins = describeFixtures(fixtureMap, synthetic("Authored Grok protocol, content or state counterexample; no saved capture is used."), {
    GR_RESPONSES_01: captured("tests/fixtures/providers/grokDetail.json", "load-responses endpoint body"),
    GR_IMAGE_RESPONSES_01: captured("tests/fixtures/providers/grokImageDetail.json", "load-responses endpoint body"),
});
