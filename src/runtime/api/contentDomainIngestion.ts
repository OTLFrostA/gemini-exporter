import type * as domain from '../../l2/ingestion.js';

type IngestionRequest = { accountId: string } & (
    | { operation: 'indexes'; items: Parameters<typeof domain.ingestIndexes>[1]; page?: Parameters<typeof domain.ingestIndexes>[2] }
    | { operation: 'detail'; conversationId: string; detail: Parameters<typeof domain.ingestDetail>[2]; indexFields?: Parameters<typeof domain.ingestDetail>[3] }
    | { operation: 'deleted'; conversationId: string }
);

async function ingest(parameters: IngestionRequest): Promise<unknown> {
    const response: unknown = await chrome.runtime.sendMessage({ action: 'domainIngest', ...parameters });
    if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true) {
        throw new Error(response && typeof response === 'object' && 'error' in response ? String(response.error) : 'Domain ingestion unavailable');
    }
    return 'result' in response ? response.result : undefined;
}

/** Content-world Domain ingestion IPC client. Carries type-only contracts; never bundles L2/L3a implementations. */
export const ingestContentIndexes: typeof domain.ingestIndexes = async (accountId, items, page) => {
    const result = await ingest({ operation: 'indexes', accountId, items, ...(page === undefined ? {} : { page }) });
    if (!result || typeof result !== 'object' || !('added' in result) || !('updated' in result)
        || typeof result.added !== 'number' || !Number.isSafeInteger(result.added) || result.added < 0
        || typeof result.updated !== 'number' || !Number.isSafeInteger(result.updated) || result.updated < 0
        || result.added + result.updated > items.length) throw new TypeError('Invalid committed Index ingestion result');
    return { added: result.added, updated: result.updated };
};

export const ingestContentDetail: typeof domain.ingestDetail = async (accountId, conversationId, detail, indexFields) => {
    const result = await ingest({ operation: 'detail', accountId, conversationId, detail, ...(indexFields === undefined ? {} : { indexFields }) });
    if (!result || typeof result !== 'object' || !('accepted' in result) || !('changed' in result)
        || typeof result.accepted !== 'boolean' || typeof result.changed !== 'boolean'
        || (!result.accepted && result.changed)
        || ('indexAdded' in result && result.indexAdded !== true)) throw new TypeError('Invalid committed Detail ingestion result');
    const committed: domain.DetailIngestResult = { accepted: result.accepted, changed: result.changed };
    if ('indexAdded' in result) committed.indexAdded = true;
    return committed;
};

export const ingestContentDeletedConversation: typeof domain.ingestDeletedConversation = async (accountId, conversationId) => {
    await ingest({ operation: 'deleted', accountId, conversationId });
};
