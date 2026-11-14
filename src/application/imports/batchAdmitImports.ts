import { OperationError, type OperationErrorCode } from '../../shared/errors/operationError.js';
import type { Account } from '../../l2/accountRegistry.js';
import { ingestDetail, ingestDetailsBatch } from '../../l2/ingestion.js';
import type { SourceConversationParseResult } from '../../l1/parsers/parsingResult.js';
import type { SourceResourceContext } from '../../l1/resources/sourceResources.js';
import { getAccount } from '../../runtime/api/accountRegistry.js';
import { notifyDomainChanged } from '../../runtime/api/domainChanges.js';
import type { SourcePlatform } from '../../shared/platformHosts.js';

export async function requireImportTargetAccount(
    accountId: string,
    expectedProvider: SourcePlatform,
    errorCode: OperationErrorCode,
    message: string,
): Promise<Account> {
    if (!accountId) throw new OperationError(errorCode, message);
    const account = await getAccount(accountId);
    if (!account || account.providerId !== expectedProvider) {
        throw new OperationError(errorCode, message);
    }
    return account;
}

/** Cooperatively admit parsed archive conversations to L2, bind lazy resource readers on acceptance,
 * and periodically yield to the UI event loop while publishing domain change notifications.
 */
export async function admitArchivedConversations<Item>(options: {
    readonly accountId: string;
    readonly items: readonly Item[];
    readonly yieldEvery: number;
    readonly resources?: SourceResourceContext;
    readonly extract: (item: Item) => {
        readonly conversationId: string;
        readonly parsed: SourceConversationParseResult;
        readonly bindResources?: (resources: SourceResourceContext) => void;
    };
    readonly onItemSettled?: (outcome: {
        readonly item: Item;
        readonly position: number;
        readonly total: number;
        readonly accepted: boolean;
    }) => void;
}): Promise<{ acceptedIds: Set<string>; rejectedCount: number; incompleteQuality: boolean }> {
    const acceptedIds = new Set<string>();
    let rejectedCount = 0;
    let incompleteQuality = false;
    const total = options.items.length;
    const sliceSize = Math.max(1, options.yieldEvery);

    for (let offset = 0; offset < total; offset += sliceSize) {
        const slice = options.items.slice(offset, offset + sliceSize);
        const extracted = slice.map(item => ({ item, ...options.extract(item) }));
        const admissions = extracted.length === 1
            ? [await ingestDetail(
                options.accountId,
                extracted[0].conversationId,
                extracted[0].parsed.conversation.detail,
                extracted[0].parsed.conversation.index,
            )]
            : await ingestDetailsBatch(
                options.accountId,
                extracted.map(entry => ({
                    conversationId: entry.conversationId,
                    detail: entry.parsed.conversation.detail,
                    indexFields: entry.parsed.conversation.index,
                })),
            );

        for (const [sliceIndex, entry] of extracted.entries()) {
            const position = offset + sliceIndex;
            const admission = admissions[sliceIndex];
            const accepted = admission?.accepted === true;
            if (accepted) {
                acceptedIds.add(entry.conversationId);
                if (options.resources) {
                    options.resources.retainParsed({ accountId: options.accountId, conversationId: entry.conversationId }, entry.parsed);
                    entry.bindResources?.(options.resources);
                }
            } else {
                rejectedCount++;
            }
            if (entry.parsed.conversation.detail.quality.status !== 'complete') {
                incompleteQuality = true;
            }
            options.onItemSettled?.({ item: entry.item, position, total, accepted });
        }

        if ((offset + slice.length) % sliceSize === 0) {
            notifyDomainChanged(options.accountId);
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
    }
    notifyDomainChanged(options.accountId);
    return { acceptedIds, rejectedCount, incompleteQuality };
}
