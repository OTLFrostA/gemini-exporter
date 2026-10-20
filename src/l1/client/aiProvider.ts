import type { Account } from '../../l2/accountRegistry.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import type { DomainAsset } from '../../l2/conversationDetail.js';
import type { PageObservation } from '../../l2/pageObservation.js';
import type { ResourceBytes } from '../../shared/resources/resourceResult.js';

export type { ProviderConversationItem } from '../parsers/contracts.js';

export type PageEvidence = Omit<PageObservation<unknown>, 'providerId' | 'accountId' | 'items'>;
export interface CommittedListPage { page: number; totalObserved: number; scanHead?: PageEvidence }
export type ListEnd = 'source_end' | 'provider_limit' | 'max_pages' | 'stopped';
export interface ProviderListOptions {
    accountId: Account['id'];
    streamId: string;
    signal?: AbortSignal;
    onPageCommitted?: (info: CommittedListPage) => Promise<boolean>;
}

export interface ProviderReadiness {
    ready: boolean;
    accountName?: string;
    error?: string;
}

export interface AIProvider {
    readonly id: string;
    readonly name: string;
    readonly hostPatterns: string[];

    checkReadiness(accountId: Account['id']): Promise<ProviderReadiness>;
    listConversations(options: ProviderListOptions): Promise<ListEnd>;
    fetchConversationDetail(accountId: Account['id'], conversationId: ConversationKey['conversationId'], signal?: AbortSignal): Promise<void>;
    acquireResource(key: ConversationKey, asset: DomainAsset, signal?: AbortSignal): Promise<ResourceBytes>;
    matchesUrl(url: string): boolean;
}
