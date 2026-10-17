import { withSourceVersion, restoreDomainSnapshot } from './runtimeValidation.js';
import type { Account } from './accountRegistry.js';
import { selectConversationDetail } from './conversationDetail.js';
import { mergeConversationIndex } from './conversationIndex.js';
import type { ResourceConversationParseResult } from '../parsers/parsingResult.js';
import type { ResourceAcquisitionHints } from '../resources/resourceAcquisition.js';
import { commitDomainConversation, commitDomainRequest } from '../storage/domain/domainStore.js';
import type { StoredDomainResource, TrustedDomainStorageRecord } from '../storage/domain/contracts.js';

/** One Domain decision for direct writes and background-broker submissions alike. */
export function selectSnapshot(existing: TrustedDomainStorageRecord | null, incoming: TrustedDomainStorageRecord,
    resourceChanged: boolean): TrustedDomainStorageRecord {
    if (!existing) return incoming;
    const unchanged = existing.savedAt === incoming.savedAt
        && JSON.stringify(existing.conversation) === JSON.stringify(incoming.conversation)
        && JSON.stringify(existing.acquisitionHints) === JSON.stringify(incoming.acquisitionHints);
    const selected = unchanged && !resourceChanged ? existing
        : selectConversationDetail({ detail: existing.conversation.detail, record: existing },
            { detail: incoming.conversation.detail, record: incoming }).record;
    const index = mergeConversationIndex(existing.conversation.index, incoming.conversation.index);
    return JSON.stringify(index) === JSON.stringify(selected.conversation.index) ? selected
        : { ...selected, revision: incoming.revision, conversation: { index, detail: selected.conversation.detail } };
}

export async function saveDomainConversation(accountId: string, parsed: ResourceConversationParseResult,
    resources: readonly StoredDomainResource[] = [], canCommit?: () => boolean): Promise<TrustedDomainStorageRecord> {
    const conversation = withSourceVersion(parsed.conversation, parsed.sourceVersion ?? parsed.conversation.detail.savedAt);
    return commitDomainConversation(accountId, { ...parsed, conversation }, resources, selectSnapshot, canCommit);
}
/** Transport trust is checked by Storage; the same Domain selection runs inside its transaction. */
export async function saveDomainRequest(account: Account, parsed: { conversation: unknown; acquisitionHints: ResourceAcquisitionHints; sourceVersion?: unknown },
    resources: readonly StoredDomainResource[] = []): Promise<TrustedDomainStorageRecord> {
    if (parsed.sourceVersion !== undefined && (typeof parsed.sourceVersion !== 'number' || !Number.isFinite(parsed.sourceVersion))) throw new TypeError('Invalid source conversation version');
    const conversation = restoreDomainSnapshot(parsed.conversation);
    return commitDomainRequest(account, { ...parsed, conversation: withSourceVersion(conversation, parsed.sourceVersion as number | undefined ?? conversation.detail.savedAt) }, resources, selectSnapshot);
}
