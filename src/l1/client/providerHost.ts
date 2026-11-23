import type { Account } from '../../l2/accountRegistry.js';
import type * as domain from '../../l2/ingestion.js';

interface ProviderIngestionPort {
    ingestIndexes(
        accountId: Parameters<typeof domain.ingestIndexes>[0],
        items: Parameters<typeof domain.ingestIndexes>[1],
        page?: Parameters<typeof domain.ingestIndexes>[2],
    ): Promise<domain.IndexIngestResult>;
    ingestDetail: typeof domain.ingestDetail;
    ingestDeletedConversation: typeof domain.ingestDeletedConversation;
}

interface ProviderCooldownPort {
    getSourceCooldown(accountId: string): Promise<number>;
    extendSourceCooldown(accountId: string, until: number): Promise<number>;
}

interface ProviderHost {
    getAccount(accountId: string): Promise<Account | null>;
    resolveProviderRoute(providerId: string, accountId: string): Promise<string>;
    readonly ingestion: ProviderIngestionPort;
    readonly cooldown: ProviderCooldownPort;
}

let host: ProviderHost | undefined;

export function provideProviderHost(value: ProviderHost): void {
    host = value;
}

export function providerHost(): ProviderHost {
    if (!host) throw new Error('Provider host has not been provided');
    return host;
}
