import type { DomainConversationDetail } from '../../src/core/domain/conversationDetail.js';
import type { LegacyResourceHints } from '../../src/core/export/assets/resourceHints.js';
import { composeDomainDocument } from '../../src/core/export/document/composeDomainDocument.js';
import { prepareDomainResources } from '../../src/core/export/document/prepareDomainResources.js';

/** Exercise the public semantic and resource boundaries independently. */
export async function composeFixture(domain: DomainConversationDetail, resourceHints: LegacyResourceHints = {}) {
    return { ...composeDomainDocument(domain), resources: await prepareDomainResources(domain, resourceHints) };
}

import type { GeminiNormalizationInput } from '../../src/core/provider/gemini/exportInput.js';
import { parseProviderConversation } from '../../src/core/provider/conversationParser.js';

/** Raw fixture input follows the same parser, composer and preparation APIs as production. */
export async function parseFixture(raw: GeminiNormalizationInput) {
    const parsed = parseProviderConversation(raw);
    const composed = await composeFixture(parsed.conversation, parsed.resourceHints);
    return { ...composed, domain: parsed.conversation, diagnostics: [...parsed.diagnostics, ...composed.diagnostics] };
}
