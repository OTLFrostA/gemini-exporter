import { domainStorage } from './ports/storagePort.js';

export function getSourceCooldown(accountId: string): Promise<number> {
    return domainStorage().getSourceCooldown(accountId);
}

export function extendSourceCooldown(accountId: string, until: number): Promise<number> {
    return domainStorage().extendSourceCooldown(accountId, until);
}
