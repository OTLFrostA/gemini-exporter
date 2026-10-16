/** Provider-neutral evidence, independent of acquisition trigger and storage layout. */
export interface PageObservation<T> {
    providerId: string;
    /** Existing sync source fingerprint (not a Registry UUID); coverage migration is separate. */
    accountId: string | null;
    streamId: string;
    items: T[];
    requestCursor: string | null;
    nextCursor: string | null;
    requestedAt: number;
    requestKnown: boolean;
    valid: boolean;
    ordered: boolean;
    keys: { id: string; time: number }[];
}
