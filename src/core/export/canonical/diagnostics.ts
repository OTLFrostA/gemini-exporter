/**
 * src/core/export/canonical/diagnostics.ts
 * Canonical diagnostic model.
 *
 * Adapted from gemini-exporter-rendering-contract-v1 (canonical/src/diagnostics.ts),
 * v1.0.0-draft. See SOURCE.md for the source trace and adaptations.
 */

import type { JsonValue } from './json.js';
import type { SourceRef } from './provenance.js';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

/**
 * Diagnostics describe normalization/archive/render issues. They are not user
 * conversation content and must not be silently converted into Callout blocks.
 */
export interface Diagnostic {
    id: string;
    severity: DiagnosticSeverity;
    code: string;
    message: string;
    path?: string;
    sourceRef?: SourceRef;
    details?: JsonValue;
}
