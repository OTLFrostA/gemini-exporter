import { versionCases } from './gemini/detail/versionCases.js';
import { protocolCases } from './gemini/detail/protocolCases.js';
import { contentCases } from './gemini/detail/contentCases.js';
import { resourcesCases } from './gemini/detail/resourcesCases.js';
import { integrationCases } from './gemini/detail/integrationCases.js';
import { p0CapturedCases } from './gemini/detail/p0CapturedCases.js';

import { tableRecoveryCases } from './gemini/detail/tableRecoveryCases.js';

const fixtureMap = {
    ...versionCases,
    ...protocolCases,
    ...contentCases,
    ...resourcesCases,
    ...integrationCases,
    ...p0CapturedCases,
    ...tableRecoveryCases,
};

export function detailGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}
