import { getAccount } from '../../api/accountRegistry.js';
import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { withConversationMetadata } from '../../domain/runtimeValidation.js';
import { getConversations } from '../conversationCatalogStore.js';
import { getDetail, storageIdentity } from './domainStore.js';
import { getAcquisitionHints } from './resourceContext.js';

/** Read composition only: canonical Index plus an independently persisted Detail. */
export async function getDomainConversationResult(accountId: string, id: string, providerId = 'gemini'): Promise<ResourceConversationParseResult | null> {
    const account = await getAccount(accountId);
    if (!account || account.providerId !== providerId) throw new TypeError('Saved Account mismatch');
    const index = (await getConversations(accountId)).find(row => row.key.conversationId === id);
    if (!index) return null;
    const detail = await getDetail(index.key);
    return detail ? { account, conversation: withConversationMetadata(detail, index),
        ...(detail.savedAt !== undefined ? { sourceVersion: detail.savedAt } : {}), diagnostics: [], resourceHints: {},
        acquisitionHints: await getAcquisitionHints(storageIdentity(providerId, accountId, id)) } : null;
}
