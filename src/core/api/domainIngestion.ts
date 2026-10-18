import * as domain from '../domain/ingestion.js';
import { ensureV2Ready } from './runtimeReady.js';

async function ingest(operation: 'indexes' | 'detail', parameters: Record<string, unknown>): Promise<void> {
    const response: unknown = await chrome.runtime.sendMessage({ action: 'domainIngest', operation, ...parameters });
    if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true) {
        throw new Error(response && typeof response === 'object' && 'error' in response ? String(response.error) : 'Domain ingestion unavailable');
    }
}
const inExtension = () => typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
export const ingestIndexes: typeof domain.ingestIndexes = async (accountId, items, page) => {
    if (!inExtension()) return ingest('indexes', { accountId, items, ...(page === undefined ? {} : { page }) });
    await ensureV2Ready();
    await domain.ingestIndexes(accountId, items, page);
};
export const ingestDetail: typeof domain.ingestDetail = async (accountId, conversationId, detail, indexFields) => {
    if (!inExtension()) return ingest('detail', { accountId, conversationId, detail, ...(indexFields === undefined ? {} : { indexFields }) });
    await ensureV2Ready();
    await domain.ingestDetail(accountId, conversationId, detail, indexFields);
};
