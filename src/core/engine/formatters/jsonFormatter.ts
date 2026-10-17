import { readAccount } from '../../domain/accountRegistry.js';
import { sameConversationKey } from '../../domain/conversationKey.js';
import { savedConversationVersion } from '../../domain/conversationVersion.js';
import { DOMAIN_CONTRACT_VERSION } from '../../storage/domain/contracts.js';
import { prepareDomainResources } from '../../export/assets/prepareDomainResources.js';
import type { ResourceResult, ResourceDelivery } from '../../resources/resourceResult.js';
import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
/** A versioned semantic archive, independent of storage and transport implementations. */
export function toJsonStandard(result: ResourceConversationParseResult, deliveries: readonly ResourceResult<ResourceDelivery>[] = []): string {
    const account = readAccount(result.account);
    if (account.id !== result.conversation.index.key.accountId || !sameConversationKey(result.conversation.index.key, result.conversation.detail.key)) throw new TypeError('JSON Account/key mismatch');
    const resources = Object.fromEntries(Object.entries(prepareDomainResources(deliveries)).map(([id, path]) => [id, { path }]));
    const savedAt = savedConversationVersion(result.conversation, result.sourceVersion);
    return JSON.stringify({ format: 'gemini-exporter-domain', version: DOMAIN_CONTRACT_VERSION, account, ...(savedAt !== undefined ? { savedAt } : {}), conversation: result.conversation,
        ...(Object.keys(resources).length ? { resources } : {}) }, null, 2);
}
