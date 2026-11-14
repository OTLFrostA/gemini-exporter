import { OperationError, type OperationErrorCode } from '../../shared/errors/operationError.js';
import type { Account } from '../../l2/accountRegistry.js';
import { ingestDetail } from '../../l2/ingestion.js';
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
}): Promise<{ acceptedIds: Set<string>; addedCount: number; rejectedCount: number; incompleteQuality: boolean }> {
    const acceptedIds = new Set<string>();
    let addedCount = 0;
    let rejectedCount = 0;
    let incompleteQuality = false;
    const total = options.items.length;

    for (const [position, item] of options.items.entries()) {
        const { conversationId, parsed, bindResources } = options.extract(item);
        const admission = await ingestDetail(
            options.accountId,
            conversationId,
            parsed.conversation.detail,
            parsed.conversation.index,
        );
        if (admission.indexAdded) addedCount++;
        if (admission.accepted) {
            acceptedIds.add(conversationId);
            if (options.resources) {
                options.resources.retainParsed({ accountId: options.accountId, conversationId }, parsed);
                bindResources?.(options.resources);
            }
        } else {
            rejectedCount++;
        }
        if (parsed.conversation.detail.quality.status !== 'complete') {
            incompleteQuality = true;
        }
        options.onItemSettled?.({ item, position, total, accepted: admission.accepted });
        if ((position + 1) % options.yieldEvery === 0) {
            notifyDomainChanged(options.accountId);
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
    }
    notifyDomainChanged(options.accountId);
    return { acceptedIds, addedCount, rejectedCount, incompleteQuality };
}
