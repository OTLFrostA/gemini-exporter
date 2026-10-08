import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { saveDomainConversation, getStoredDomain, storedParseResult, storageIdentity } from './domainStore.js';
import type { StoredDomainResource } from './contracts.js';

export async function persistNativeConversation(accountSlot: string, result: ResourceConversationParseResult, resources: readonly StoredDomainResource[] = []): Promise<void> {
    await saveDomainConversation(accountSlot, result, resources);
}
export async function getDomainConversationResult(accountSlot: string, id: string, providerId = 'gemini'): Promise<ResourceConversationParseResult | null> {
    const stored = await getStoredDomain(storageIdentity(providerId, accountSlot, id));
    return stored ? storedParseResult(stored) : null;
}
