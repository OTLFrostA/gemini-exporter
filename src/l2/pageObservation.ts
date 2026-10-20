import type { Account } from './accountRegistry.js';
import type { CoverageKey } from './streamCoverage.js';

/** Provider-neutral evidence, independent of acquisition trigger and storage layout. */
export interface PageObservation<T> {
    providerId: Account['providerId'];
    /** Local Registry UUID; null means unverified and cannot authorize ingestion or coverage. */
    accountId: Account['id'] | null;
    streamId: string;
    items: readonly T[];
    requestCursor: string | null;
    nextCursor: string | null;
    requestedAt: number;
    requestKnown: boolean;
    valid: boolean;
    ordered: boolean;
    /** Only explicit Provider proof of a history window boundary. */
    terminal?: 'provider_limit';
    keys: readonly CoverageKey[];
}
