import { provideApplicationHost } from '../../application/host.js';
import { getAccount, getOrCreateAccount } from './accountRegistry.js';
import { notifyDomainChanged } from './domainChanges.js';
import { subscribeCommittedKeys } from './domainStorage.js';

export function installApplicationHost(): void {
    provideApplicationHost({ getAccount, getOrCreateAccount, notifyDomainChanged, subscribeCommittedKeys });
}
