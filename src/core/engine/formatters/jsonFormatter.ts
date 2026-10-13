import { prepareDomainResources } from '../../export/assets/prepareDomainResources.js';
import type { ResourceResult, ResourceDelivery } from '../../resources/resourceResult.js';
import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
/** A versioned semantic archive, independent of storage and transport implementations. */
export function toJsonStandard(result: ResourceConversationParseResult, deliveries: readonly ResourceResult<ResourceDelivery>[] = []): string {
    const resources = Object.fromEntries(Object.entries(prepareDomainResources(deliveries)).map(([id, path]) => [id, { path }]));
    return JSON.stringify({ format: 'gemini-exporter-domain', version: 1, conversation: result.conversation,
        ...(Object.keys(resources).length ? { resources } : {}) }, null, 2);
}
