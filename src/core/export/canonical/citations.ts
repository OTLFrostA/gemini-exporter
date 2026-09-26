/**
 * src/core/export/canonical/citations.ts
 * Canonical citation entity model.
 *
 * Adapted from gemini-exporter-rendering-contract-v1 (canonical/src/citations.ts),
 * v1.0.0-draft. See SOURCE.md for the source trace and adaptations.
 */

import type { ProviderExtensions } from './json.js';
import type { SourceRef } from './provenance.js';

export type CitationKind = 'web' | 'file' | 'attachment' | 'provider' | 'other';

export interface Citation {
    id: string;
    kind: CitationKind;

    url?: string;
    title?: string;
    publisher?: string;
    snippet?: string;
    assetId?: string;

    sourceRef?: SourceRef;
    extensions?: ProviderExtensions;
}
