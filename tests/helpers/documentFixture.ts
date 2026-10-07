import type { DomainConversationDetail } from '../../src/core/domain/conversationDetail.js';
import type { LegacyResourceHints } from '../../src/core/export/assets/resourceHints.js';
import { composeDomainDocument } from '../../src/core/export/document/composeDomainDocument.js';
import { prepareDomainResources } from '../../src/core/export/document/prepareDomainResources.js';

/** Exercise the public semantic and resource boundaries independently. */
export async function composeFixture(domain: DomainConversationDetail, resourceHints: LegacyResourceHints = {}) {
    return { ...composeDomainDocument(domain), resources: await prepareDomainResources(domain, resourceHints) };
}
