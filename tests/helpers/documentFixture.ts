import { parseConversation } from '../../src/core/parsers/parseConversation.js';
import type { DomainConversationDetail } from '../../src/core/domain/conversationDetail.js';
import type { LegacyResourceHints } from '../../src/core/parsers/shared/resources/resourceHints.js';
import { composeDomainDocument } from '../../src/core/document/compose/composeDomainDocument.js';
import { prepareDomainResources } from '../../src/core/export/assets/prepareDomainResources.js';

/** Exercise the public semantic and resource boundaries independently. */
export async function composeFixture(domain: DomainConversationDetail, resourceHints: LegacyResourceHints = {}) {
    return { ...composeDomainDocument(domain), resources: await prepareDomainResources(domain, resourceHints) };
}

import type { ConversationRecordInput } from '../../src/core/compatibility/record/conversationRecord.js';

/** Raw fixture input follows the same parser, composer and preparation APIs as production. */
export async function parseFixture(raw: ConversationRecordInput) {
    const parsed = parseConversation({ format: 'conversation-record', providerId: 'gemini', data: raw });
    const composed = await composeFixture(parsed.conversation, parsed.resourceHints);
    return { ...composed, domain: parsed.conversation, diagnostics: [...parsed.diagnostics, ...composed.diagnostics] };
}
