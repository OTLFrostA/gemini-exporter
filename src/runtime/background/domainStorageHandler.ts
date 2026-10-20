import { ingestIndexes, ingestDetail, ingestDeletedConversation } from '../../l2/ingestion.js';
import { ensureV2Ready } from './readiness.js';
import { object, requireContentAccount, assertContentSender } from './contentSender.js';

/** Only L2 admission crosses this boundary; there is no direct Storage write port. */
export function handleDomainIngestionMessage(message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void): boolean {
    if (!message || typeof message !== 'object' || !('action' in message) || message.action !== 'domainIngest') return false;
    void (async () => {
        try {
            assertContentSender(sender);
            await ensureV2Ready();
            const request = object(message);
            const account = await requireContentAccount(sender, request.accountId);
            if (request.operation === 'indexes') {
                if (!Array.isArray(request.items)) throw new TypeError('Expected Index items');
                for (const item of request.items) {
                    const entry = object(item);
                    if (typeof entry.conversationId !== 'string' || !entry.conversationId) throw new TypeError('Expected conversation ID');
                    object(entry.fields);
                }
                if (request.page !== undefined) object(request.page);
                await ingestIndexes(account.id, request.items as Parameters<typeof ingestIndexes>[1], request.page as Parameters<typeof ingestIndexes>[2]);
            } else if (request.operation === 'detail') {
                if (typeof request.conversationId !== 'string' || !request.conversationId) throw new TypeError('Expected conversation ID');
                object(request.detail);
                if (request.indexFields !== undefined) object(request.indexFields);
                const result = await ingestDetail(account.id, request.conversationId, request.detail as Parameters<typeof ingestDetail>[2], request.indexFields as Parameters<typeof ingestDetail>[3]);
                if (!result || typeof result !== 'object' || typeof result.accepted !== 'boolean'
                    || typeof result.changed !== 'boolean' || (!result.accepted && result.changed)) {
                    throw new TypeError('Invalid committed Detail ingestion result');
                }
                respond({ ok: true, result: { accepted: result.accepted, changed: result.changed } });
                return;
            } else if (request.operation === 'deleted') {
                if (account.providerAccountId === 'default') throw new TypeError('Deletion requires an identified Account');
                if (typeof request.conversationId !== 'string' || !/^[a-f0-9]{8,64}$/.test(request.conversationId)) throw new TypeError('Expected Gemini conversation ID');
                await ingestDeletedConversation(account.id, request.conversationId);
            } else throw new TypeError('Unknown ingestion operation');
            respond({ ok: true });
        } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
    })();
    return true;
}
