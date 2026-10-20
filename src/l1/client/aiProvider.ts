export type { ProviderConversationItem } from '../parsers/contracts.js';

export type PageEvidence = Omit<import('../../l2/pageObservation.js').PageObservation<unknown>, 'providerId' | 'accountId' | 'items'>;
export interface CommittedListPage { page: number; totalObserved: number; scanHead?: PageEvidence }
export type ListEnd = 'source_end' | 'provider_limit' | 'max_pages' | 'stopped';
export interface ProviderListOptions {
    accountId: string;
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

    checkReadiness(accountId: string): Promise<ProviderReadiness>;
    listConversations(options: ProviderListOptions): Promise<ListEnd>;
    fetchConversationDetail(accountId: string, conversationId: string, signal?: AbortSignal): Promise<void>;
    acquireResource(key: import('../../l2/conversationKey.js').ConversationKey, asset: import('../../l2/conversationDetail.js').DomainAsset, signal?: AbortSignal): Promise<import('../../shared/resources/resourceResult.js').ResourceBytes>;
    matchesUrl(url: string): boolean;
}
