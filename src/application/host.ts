import type { Account } from '../l2/accountRegistry.js';

export interface ApplicationHost {
    getAccount(accountId: string): Promise<Account | null>;
    getOrCreateAccount(providerId: string, providerAccountId: string, email?: string, displayName?: string): Promise<Account>;
    notifyDomainChanged(accountId: string): void;
}

let host: ApplicationHost | undefined;

export function provideApplicationHost(value: ApplicationHost): void {
    host = value;
}

export function applicationHost(): ApplicationHost {
    if (!host) throw new Error('Application host has not been provided');
    return host;
}
