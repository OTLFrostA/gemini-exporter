import type { Account } from '../../l2/accountRegistry.js';

interface ProviderHost {
    getAccount(accountId: string): Promise<Account | null>;
    resolveProviderRoute(providerId: string, accountId: string): Promise<string>;
}

let host: ProviderHost | undefined;

export function provideProviderHost(value: ProviderHost): void {
    host = value;
}

export function providerHost(): ProviderHost {
    if (!host) throw new Error('Provider host has not been provided');
    return host;
}
