/**
 * src/core/export/canonical/assets.ts
 * Canonical asset entity model.
 *
 * Adapted from gemini-exporter-rendering-contract-v1 (canonical/src/assets.ts),
 * v1.0.0-draft. See SOURCE.md for the source trace and adaptations.
 *
 * Binary data is never embedded in content blocks; blocks reference assets by id.
 */

import type { ProviderExtensions } from './json.js';
import type { SourceRef } from './provenance.js';

export type AssetKind = 'image' | 'file' | 'audio' | 'video' | 'other';

export type AssetStatus =
    | 'available'
    | 'remote'
    | 'missing'
    | 'failed'
    | 'notFetched';

export interface AssetDimensions {
    widthPx: number;
    heightPx: number;
}

export interface Asset {
    id: string;
    kind: AssetKind;

    name?: string;
    mimeType?: string;
    sizeBytes?: number;
    sha256?: string;
    dimensions?: AssetDimensions;

    /** Original provider URL/reference when available. */
    sourceUrl?: string;

    /**
     * Logical local/archive reference, never an absolute OS path.
     * Example: assets/sha256/ab/cd/....png
     */
    storageRef?: string;

    /**
     * 'available' means the bytes were actually fetched and stored; it must not
     * be set from metadata alone. assetResolution.ts classifies the effective
     * status at export time (pseudo-available => missing + diagnostic).
     */
    status: AssetStatus;
    failureReason?: string;

    sourceRef?: SourceRef;
    extensions?: ProviderExtensions;
}
