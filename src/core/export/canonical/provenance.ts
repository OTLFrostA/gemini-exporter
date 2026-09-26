import type { JsonValue, ProviderExtensions } from './json.js';

export interface SourceRef {
    providerId: string;
    providerMessageId?: string;
    locator?: string;
    rawRef?: string;
}

export type ObservationSourceType =
    | 'live'
    | 'official-export'
    | 'archive-import'
    | 'legacy-migration'
    | 'other';

export interface ObservationIssue {
    code: string;
    message: string;
    details?: JsonValue;
}

export interface SourceObservation {
    id: string;
    providerId: string;
    sourceType: ObservationSourceType;
    observedAt: string;

    requestScope?: JsonValue;
    cursor?: string;
    batchId?: string;

    rawCount?: number;
    parsedCount?: number;

    errors?: ObservationIssue[];
    unknownFields?: string[];
    rawRef?: string;

    extensions?: ProviderExtensions;
}
