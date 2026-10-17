import { getAccount } from '../../api/accountRegistry.js';
import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { getStoredDomain, storedParseResult, storageIdentity } from './domainStore.js';

/** Raw persistence primitive for migration/recovery. Application reads use the scoped
 * conversation repository so saved metadata cannot compete with the current index. */
export async function getDomainConversationResult(accountId: string, id: string, providerId = 'gemini'): Promise<ResourceConversationParseResult | null> {
    const stored = await getStoredDomain(storageIdentity(providerId, accountId, id));
    const account = await getAccount(accountId);
    if (!account || account.providerId !== providerId) throw new TypeError("Saved Account mismatch");
    return stored ? storedParseResult(stored, account) : null;
}
