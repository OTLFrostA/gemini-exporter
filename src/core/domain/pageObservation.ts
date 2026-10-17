/** Provider-neutral evidence, independent of acquisition trigger and storage layout. */
export interface PageObservation<T> {
    providerId: string;
    /** Local Registry UUID; null means unverified and cannot authorize ingestion or coverage. */
    accountId: string | null;
    streamId: string;
    items: T[];
    requestCursor: string | null;
    nextCursor: string | null;
    requestedAt: number;
    requestKnown: boolean;
    valid: boolean;
    ordered: boolean;
    /** Only explicit Provider proof of a history window boundary. */
    terminal?: 'provider_limit';
    keys: { id: string; time: number }[];
}
