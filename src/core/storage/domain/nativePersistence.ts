import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { getStoredDomain, storedParseResult, storageIdentity } from './domainStore.js';

/** Raw persistence primitive for migration/recovery. Application reads use the scoped
 * conversation repository so saved metadata cannot compete with the current index. */
export async function getDomainConversationResult(accountId: string, id: string, providerId = 'gemini'): Promise<ResourceConversationParseResult | null> {
    const stored = await getStoredDomain(storageIdentity(providerId, accountId, id));
    return stored ? storedParseResult(stored) : null;
}
