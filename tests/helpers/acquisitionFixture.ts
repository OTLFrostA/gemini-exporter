import { ingestConversation } from '../../src/core/domain/ingestion.js';
import { isResourceConversationParseResult } from '../../src/core/parsers/parsingResult.js';
/** A fake L1 must publish its successful acquisition before Application consumes it. */
export async function acquiredReply<T>(reply: T): Promise<T> {
    if (!reply || typeof reply !== 'object' || Reflect.get(reply, 'success') !== true) return reply;
    const items: unknown = Reflect.get(reply, 'results') ?? [Reflect.get(reply, 'chat') ?? Reflect.get(reply, 'data')];
    if (Array.isArray(items)) for (const item of items) if (isResourceConversationParseResult(item)) await ingestConversation(item.account.id, item);
    return reply;
}
