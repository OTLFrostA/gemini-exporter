import { provideApplicationHost } from '../../application/host.js';
import { getAccount, getOrCreateAccount } from './accountRegistry.js';
import { notifyDomainChanged } from './domainChanges.js';

export function installApplicationHost(): void {
    provideApplicationHost({ getAccount, getOrCreateAccount, notifyDomainChanged });
}
