import { provideContentRuntimeHost } from '../../l1/contentPorts.js';
import { getContentAccount } from '../api/contentAccountRegistry.js';
import {
    ingestContentDeletedConversation,
    ingestContentDetail,
    ingestContentIndexes,
} from '../api/contentDomainIngestion.js';
import {
    isCurrentAccount,
    matchesCurrentAccount,
    resolveCurrentAccount,
    resolveRequestAccount,
} from './accountContext.js';
import { registerCleanup } from './cleanupRegistry.js';

export function installContentRuntimeHost(): void {
    provideContentRuntimeHost({
        ingestion: {
            ingestIndexes: ingestContentIndexes,
            ingestDetail: ingestContentDetail,
            ingestDeletedConversation: ingestContentDeletedConversation,
        },
        account: {
            getAccount: getContentAccount,
            resolveRequestAccount,
            resolveCurrentAccount,
            matchesCurrentAccount,
            isCurrentAccount,
        },
        registerCleanup,
    });
}
