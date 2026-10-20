import * as domain from '../../l2/ingestion.js';
import { ensureV2Ready } from './runtimeReady.js';

async function ingest(operation: 'indexes' | 'detail' | 'deleted', parameters: Record<string, unknown>): Promise<{ changed?: boolean }> {
    const response: unknown = await chrome.runtime.sendMessage({ action: 'domainIngest', operation, ...parameters });
    if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true) {
        throw new Error(response && typeof response === 'object' && 'error' in response ? String(response.error) : 'Domain ingestion unavailable');
    }
    return response as { changed?: boolean };
}
const inExtension = () => typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
export const ingestIndexes: typeof domain.ingestIndexes = async (accountId, items, page) => {
    if (!inExtension()) {
        await ingest('indexes', { accountId, items, ...(page === undefined ? {} : { page }) });
        return;
    }
    await ensureV2Ready();
    await domain.ingestIndexes(accountId, items, page);
};
export const ingestDetail: typeof domain.ingestDetail = async (accountId, conversationId, detail, indexFields) => {
    if (!inExtension()) {
        const result = await ingest('detail', { accountId, conversationId, detail, ...(indexFields === undefined ? {} : { indexFields }) });
        if (typeof result.changed !== 'boolean') throw new TypeError('Missing committed Detail changed result');
        return result.changed;
    }
    await ensureV2Ready();
    return domain.ingestDetail(accountId, conversationId, detail, indexFields);
};

/** L1 calls this only after validating request-bound Provider deletion evidence. */
export const ingestDeletedConversation: typeof domain.ingestDeletedConversation = async (accountId, conversationId) => {
    if (!inExtension()) {
        await ingest('deleted', { accountId, conversationId });
        return;
    }
    await ensureV2Ready();
    await domain.ingestDeletedConversation(accountId, conversationId);
};
