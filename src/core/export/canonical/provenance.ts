/**
 * src/core/export/canonical/provenance.ts
 * Source references and observation records for the canonical layer.
 *
 * Adapted from gemini-exporter-rendering-contract-v1 (canonical/src/provenance.ts),
 * v1.0.0-draft. See SOURCE.md for the source trace and adaptations.
 */

import type { JsonValue, ProviderExtensions } from './json.js';

/**
 * Points back to provider/archive evidence without embedding renderer markup.
 */
export interface SourceRef {
    providerId: string;
    providerMessageId?: string;
    /** Provider-side semantic locator, e.g. Gemini data-path-to-node. */
    locator?: string;
    /** Logical reference to archived raw evidence. */
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

/**
 * Records what was actually observed/imported. This prevents the archive from
 * claiming source completeness that was never established.
 *
 * Unknown source timestamps stay absent; observedAt never impersonates
 * provider/server time.
 */
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
