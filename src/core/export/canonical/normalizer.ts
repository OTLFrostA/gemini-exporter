/**
 * src/core/export/canonical/normalizer.ts
 * Provider normalizer contract (interfaces only).
 *
 * Adapted from gemini-exporter-rendering-contract-v1 (canonical/src/normalizer.ts),
 * v1.0.0-draft. See SOURCE.md for the source trace and adaptations.
 *
 * The Gemini normalizer implementation is F2b; this file only lands the shared
 * contract so F2b, the ChatGPT route and archive importers target one shape.
 */

import type { CanonicalConversationBundle } from './conversation.js';
import type { Diagnostic } from './diagnostics.js';

export interface RawEvidenceWriter {
    /** Store provider raw evidence and return a stable logical archive/repository ref. */
    put(kind: string, data: unknown): Promise<string>;
}

export interface NormalizationContext {
    providerId: string;
    /**
     * TODO(F1): populated by the F1 composite-identity migration. Never
     * synthesize an ad-hoc account id that may collide across accounts.
     */
    accountId: string;
    observedAt: string;
    rawEvidence?: RawEvidenceWriter;
}

export interface NormalizationResult {
    bundle: CanonicalConversationBundle;
    diagnostics: Diagnostic[];
}

/**
 * Provider adapters own parsing of provider payload/DOM/archive formats.
 * Renderers never implement provider parsing.
 */
export interface ProviderNormalizer<TRaw> {
    readonly providerId: string;
    normalize(raw: TRaw, context: NormalizationContext): Promise<NormalizationResult>;
}
