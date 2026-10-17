export type { ProviderConversationItem } from '../parsers/contracts.js';

export type PageEvidence = Omit<import('../domain/pageObservation.js').PageObservation<unknown>, 'providerId' | 'accountId' | 'items'>;
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
    acquireResource(accountId: string, asset: import('../domain/conversationDetail.js').DomainAsset, signal?: AbortSignal): Promise<import('../resources/resourceResult.js').ResourceBytes>;
    matchesUrl(url: string): boolean;
}
