import type { Account } from '../l2/accountRegistry.js';
import type * as domain from '../l2/ingestion.js';

export interface ContentAccountContext {
    readonly providerId: string;
    readonly accountId: string;
    readonly slot: string;
}

export interface ContentIngestionPort {
    ingestIndexes(
        accountId: Parameters<typeof domain.ingestIndexes>[0],
        items: Parameters<typeof domain.ingestIndexes>[1],
        page?: Parameters<typeof domain.ingestIndexes>[2],
    ): Promise<domain.IndexIngestResult>;
    ingestDetail: typeof domain.ingestDetail;
    ingestDeletedConversation: typeof domain.ingestDeletedConversation;
}

export interface ContentAccountPort {
    getAccount(accountId: string): Promise<Account | null>;
    resolveRequestAccount(
        observed: Omit<Account, 'id'> | null,
        capturedSlot: string,
    ): Promise<ContentAccountContext | null>;
    resolveCurrentAccount(
        observed?: Omit<Account, 'id'> | null,
        capturedSlot?: string,
    ): Promise<ContentAccountContext | null>;
    matchesCurrentAccount(observation: Omit<Account, 'id'>): boolean;
    isCurrentAccount(context: ContentAccountContext | null): boolean;
}

export type RegisterCleanup = (fn: () => void) => () => void;

interface ContentRuntimeHost {
    readonly ingestion: ContentIngestionPort;
    readonly account: ContentAccountPort;
    readonly registerCleanup: RegisterCleanup;
}

let host: ContentRuntimeHost | undefined;

export function provideContentRuntimeHost(value: ContentRuntimeHost): void {
    host = value;
}

export function contentRuntimeHost(): ContentRuntimeHost {
    if (!host) throw new Error('Content runtime host has not been provided');
    return host;
}
