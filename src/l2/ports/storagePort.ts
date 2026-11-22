import type { Account } from '../accountRegistry.js';
import type { ConversationKey } from '../conversationKey.js';
import type { DomainConversationIndex } from '../conversationIndex.js';
import type { DomainConversationDetail } from '../conversationDetail.js';
import type { StreamCoverage } from '../streamCoverage.js';
import type { DetailIngestResult } from '../contracts/ingestionTypes.js';

export interface ConversationAtomicBatchItem {
    readonly key: ConversationKey;
    readonly decide: (
        oldIndex: DomainConversationIndex | null,
        oldDetail: DomainConversationDetail | null,
    ) => { index?: DomainConversationIndex; detail?: DomainConversationDetail; result: DetailIngestResult };
}

export interface DomainStoragePort {
    getAccount(id: Account['id']): Promise<Account | null>;
    admitAccountAtomically(
        providerId: Account['providerId'],
        decide: (existing: readonly Account[]) => Account,
    ): Promise<Account>;
    getConversationSnapshot(
        key: ConversationKey,
    ): Promise<{ index: DomainConversationIndex | null; detail: DomainConversationDetail | null }>;
    updateIndexesAtomically(
        keys: readonly ConversationKey[],
        decide: (old: readonly (DomainConversationIndex | null)[]) => readonly DomainConversationIndex[],
    ): Promise<void>;
    updateConversationAtomically<R extends DetailIngestResult | void = DetailIngestResult>(
        key: ConversationKey,
        decide: (
            oldIndex: DomainConversationIndex | null,
            oldDetail: DomainConversationDetail | null,
        ) => { index?: DomainConversationIndex; detail?: DomainConversationDetail; result: R },
    ): Promise<R>;
    updateConversationsAtomically(items: readonly ConversationAtomicBatchItem[]): Promise<DetailIngestResult[]>;
    deleteStoredConversation(key: ConversationKey): Promise<void>;
    getCoverage(accountId: Account['id'], streamId: string): Promise<StreamCoverage | null>;
    updateCoverageAtomically<R extends boolean | string | void = void>(
        accountId: Account['id'],
        streamId: string,
        decide: (current: StreamCoverage | null) => { next?: StreamCoverage; result: R },
    ): Promise<R>;
    getSourceCooldown(accountId: string): Promise<number>;
    extendSourceCooldown(accountId: string, until: number): Promise<number>;
    onCommittedKeys?: (keys: readonly ConversationKey[]) => void;
}

let storage: DomainStoragePort | undefined;

export function provideDomainStorage(value: DomainStoragePort): void {
    storage = value;
}

export function domainStorage(): DomainStoragePort {
    if (!storage) throw new Error('Domain storage has not been provided');
    return storage;
}
