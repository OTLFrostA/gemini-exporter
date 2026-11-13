import * as domain from '../../l2/ingestion.js';
import { ensureV2Ready } from './runtimeReady.js';
import { ingestContentIndexes, ingestContentDetail, ingestContentDeletedConversation } from './contentDomainIngestion.js';

const inExtension = () => typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
export const ingestIndexes: typeof domain.ingestIndexes = async (accountId, items, page) => {
    if (!inExtension()) return ingestContentIndexes(accountId, items, page);
    await ensureV2Ready();
    return domain.ingestIndexes(accountId, items, page);
};
export const ingestDetail: typeof domain.ingestDetail = async (accountId, conversationId, detail, indexFields) => {
    if (!inExtension()) return ingestContentDetail(accountId, conversationId, detail, indexFields);
    await ensureV2Ready();
    return domain.ingestDetail(accountId, conversationId, detail, indexFields);
};

/** L1 calls this only after validating request-bound Provider deletion evidence. */
export const ingestDeletedConversation: typeof domain.ingestDeletedConversation = async (accountId, conversationId) => {
    if (!inExtension()) {
        await ingestContentDeletedConversation(accountId, conversationId);
        return;
    }
    await ensureV2Ready();
    await domain.ingestDeletedConversation(accountId, conversationId);
};
