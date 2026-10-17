import { bindFixture } from './domainFixture.js';
import { ingestConversation } from '../../src/core/storage/conversationIngest.js';
import { isResourceConversationParseResult } from '../../src/core/parsers/parsingResult.js';
import { BatchWorker, type BatchWorkerModule } from '../../src/core/engine/export/batchWorker.js';

export function makeTestWorker(overrides: Partial<BatchWorkerModule> = {}): BatchWorkerModule {
    const acquire = overrides.fetchChatDetail;
    return { ...BatchWorker, ...overrides, ...(acquire ? { async fetchChatDetail(...args: Parameters<typeof acquire>) {
        const response = await acquire(...args);
        if (response.success) for (const item of response.results?.length ? response.results : ('chat' in response ? [response.chat] : [])) if (isResourceConversationParseResult(item)) await ingestConversation(args[3], bindFixture(item, args[3]));
        return response;
    } } : {}) };
}
