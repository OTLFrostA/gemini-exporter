import type { Diagnostic } from '../../shared/diagnostics/diagnostic.js';
import type { Account } from '../../l2/accountRegistry.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import type { DomainAsset } from '../../l2/conversationDetail.js';
import type { PageObservation } from '../../l2/pageObservation.js';
import type { ResourceBytes } from '../../shared/resources/resourceResult.js';

export type PageEvidence = Omit<PageObservation<unknown>, 'providerId' | 'accountId' | 'items'>;
export interface CommittedListPage { page: number; totalObserved: number; scanHead?: PageEvidence }
export type ListEnd = 'source_end' | 'provider_limit' | 'max_pages' | 'stopped';
/** Request-bound evidence for a failed list page, retained for explicit diagnostic export. */
export interface ListFailureDiagnostics {
    providerId: string;
    streamId: string;
    page: number;
    requestCursor: string | null;
    failure: string;
    details?: Readonly<Record<string, unknown>>;
}
export class ProviderListError extends Error {
    constructor(message: string, readonly diagnostics: ListFailureDiagnostics) {
        super(message);
        this.name = 'ProviderListError';
    }
}
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
    fetchConversationDetail(accountId: Account['id'], conversationId: ConversationKey['conversationId'], signal?: AbortSignal, onDiagnostic?: (diagnostic: Diagnostic) => void): Promise<void>;
    /** Stable provider locators can reacquire bytes without refreshing the whole Detail. */
    canAcquireResourceDirectly?(asset: DomainAsset): boolean;
    acquireResource(key: ConversationKey, asset: DomainAsset, signal?: AbortSignal): Promise<ResourceBytes>;
    matchesUrl(url: string): boolean;
}
