import type { Account } from '../../../src/l2/accountRegistry.js';
import type { AIProvider } from '../../../src/l1/client/aiProvider.js';

/**
 * A native-source fixture for one real L1 provider. Only transport and source
 * responses are faked; the provider and L1 parsers run unchanged. L2/Runtime
 * decisions remain controlled by the existing frozen-v2 unit port mocks.
 */
export interface ProviderContractAdapter {
    readonly id: string;
    readonly account: Account;
    readonly foreignAccount: Account;
    readonly conversationId: string;
    createProvider(options?: {
        /** Return an untrustworthy, but parseable, native source list page. */
        invalidList?: boolean;
        /** Observe calls to the native source boundary (not L2 calls). */
        onSourceRequest?: () => void;
    }): AIProvider;
}
