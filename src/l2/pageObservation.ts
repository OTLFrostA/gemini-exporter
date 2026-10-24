import type { Account } from './accountRegistry.js';
import type { CoverageKey } from './streamCoverage.js';

/** Provider-neutral cursor evidence; does not carry source conversation payloads. */
export interface PageObservationEvidence {
    providerId: Account['providerId'];
    /** Local Registry UUID; null means unverified and cannot authorize ingestion or coverage. */
    accountId: Account['id'] | null;
    streamId: string;
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

/** The untrusted source items are separate from the trusted cursor evidence. */
export interface PageObservation<T> extends PageObservationEvidence {
    items: readonly T[];
}

/** Callback/scan boundary: no source payload or account identity duplication. */
export type PageObservationHead = Omit<PageObservationEvidence, 'providerId' | 'accountId'>;
