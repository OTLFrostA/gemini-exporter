/**
 * src/core/export/canonical/assetResolution.ts
 * Export-time asset availability classification and byte resolution.
 *
 * Implements integration doc section 3, item 4 ("assets"): before export,
 * resolve real bytes, effective status and the archive-local path.
 * 'available' from metadata alone is not enough -- an asset marked available
 * whose bytes cannot be resolved is classified as missing and diagnosed
 * (pseudo-available), so no renderer can pretend an offline export succeeded
 * from a remote URL.
 */

import type { Asset, AssetStatus } from './assets.js';
import type { Diagnostic } from './diagnostics.js';

export interface ClassifiedAsset {
    asset: Asset;
    effectiveStatus: AssetStatus;
    /** True when metadata said 'available' but no bytes could be resolved. */
    pseudoAvailable: boolean;
    diagnostic?: Diagnostic;
}

/**
 * Classify an asset's effective availability given whether its bytes are
 * actually resolvable (from storageRef, cache or a fresh fetch).
 */
export function classifyAssetAvailability(asset: Asset, hasBytes: boolean): ClassifiedAsset {
    const base: ClassifiedAsset = { asset, effectiveStatus: asset.status, pseudoAvailable: false };
    if (asset.status === 'available' && !hasBytes) {
        base.effectiveStatus = 'missing';
        base.pseudoAvailable = true;
        base.diagnostic = {
            id: `pseudo-available:${asset.id}`,
            severity: 'warning',
            code: 'PSEUDO_AVAILABLE',
            message: `asset ${asset.id} was marked 'available' but no bytes could be resolved; treating as missing`,
            details: { storageRef: asset.storageRef ?? null, sourceUrl: asset.sourceUrl ?? null },
        };
    }
    return base;
}

export interface AssetByteSource {
    /** Return the asset bytes, or null when they cannot be obtained. */
    getBytes(asset: Asset): Promise<Uint8Array | null>;
}

export interface ResolvedAssetBytes {
    asset: Asset;
    bytes: Uint8Array | null;
    effectiveStatus: AssetStatus;
    failureReason?: string;
    diagnostics: Diagnostic[];
}

/**
 * Resolve an asset to its real bytes before export. Missing entities get an
 * explicit placeholder reason; nothing is left ambiguous for renderers.
 */
export async function resolveAssetBytes(asset: Asset, byteSource: AssetByteSource): Promise<ResolvedAssetBytes> {
    const diagnostics: Diagnostic[] = [];
    let bytes: Uint8Array | null = null;
    try {
        bytes = await byteSource.getBytes(asset);
    } catch (err) {
        diagnostics.push({
            id: `asset-fetch-error:${asset.id}`,
            severity: 'warning',
            code: 'ASSET_FETCH_ERROR',
            message: `failed to fetch bytes for asset ${asset.id}: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
    const classified = classifyAssetAvailability(asset, bytes !== null);
    if (classified.diagnostic) diagnostics.push(classified.diagnostic);
    return {
        asset,
        bytes,
        effectiveStatus: classified.effectiveStatus,
        failureReason: classified.pseudoAvailable
            ? (asset.failureReason ?? 'marked available but bytes could not be resolved')
            : asset.failureReason,
        diagnostics,
    };
}
