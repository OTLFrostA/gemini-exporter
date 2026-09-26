/**
 * src/core/export/pdf/pipeline/resourceStage.ts
 *
 * D7 S2 (M3): resources stage.
 *
 * Collects every asset referenced by the projected view (shared recursive
 * collector — the same traversal the Typst payload builder uses, so the
 * payload stage can never see an asset this stage missed), resolves them
 * through the shared asset resolver against the per-run byte store, and
 * emits:
 *   - pathMap : assetId -> virtual path (only clean resolves)
 *   - mounts  : virtual path -> bytes -> mimeType (sandbox mounts for compile)
 *   - unresolved: referenced-but-not-resolved assets, each with a reason
 *
 * Stage rules honored:
 *   - bytes come from input.byteStore via asset.storageRef; ResolvedAssetEntry
 *     carries no bytes, so mounts re-read them from the same store the
 *     resolver validated. readLocalFile is NOT wired here (the stage input
 *     carries no storage reader): with the default resolver options this
 *     means every resolved asset's bytes are, by construction, in the byte
 *     store. The residual "bytes vanished" case is diagnosed, never silent.
 *   - MAX_ASSET_BYTES keeps its default (no override passed).
 *   - every omission lands in diagnostics at warning or above; nothing is
 *     silent. Resolver diagnostics are forwarded as-is; the stage adds one
 *     summary diagnostic per unresolved asset unless the resolver already
 *     emitted a warning+ for it.
 *   - abort: throws a DOMException named 'AbortError' promptly.
 */
import { collectReferencedAssetIds } from '../../typst/payload.js';
import { resolveAssets } from '../../assets/resolver.js';
import type { Asset, AssetStatus } from '../../canonical/assets.js';
import type {
    ImageMount,
    RenderDiagnostic,
    ResourceStageInput,
    ResourceStageOutput,
    StageContext,
    StageFn,
} from './types.js';

const STAGE_NAME = 'resources';

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
}

function diagFor(
    diagnostics: RenderDiagnostic[],
    assetId: string,
    severity: RenderDiagnostic['severity'],
    code: string,
    message: string,
): void {
    diagnostics.push({ severity, code, message, path: `asset:${assetId}` });
}

function hasWarnPlus(diagnostics: RenderDiagnostic[], assetId: string): boolean {
    const path = `asset:${assetId}`;
    return diagnostics.some(
        (d) => d.path === path && (d.severity === 'warning' || d.severity === 'error'),
    );
}

/** Human-readable reason for a referenced asset that did not resolve cleanly. */
function unresolvedReason(
    asset: Asset | undefined,
    effectiveStatus: Map<string, AssetStatus>,
): string {
    if (!asset) {
        return 'referenced by the projected view but absent from bundle.assets';
    }
    const status = effectiveStatus.get(asset.id) ?? asset.status;
    const detail = asset.failureReason ? ` (${asset.failureReason})` : '';
    switch (status) {
        case 'remote':
            return `remote-only; resolver performs no network fetch (offline rule)${detail}`;
        case 'missing':
        case 'notFetched':
        case 'failed':
            return `no bytes resolved (effective status '${status}')${detail}`;
        default:
            return `not resolved (effective status '${status}')${detail}`;
    }
}

export const resourceStage: StageFn<ResourceStageInput, ResourceStageOutput> = async (
    input: ResourceStageInput,
    ctx: StageContext,
) => {
    throwIfAborted(ctx.signal);
    const diagnostics: RenderDiagnostic[] = [];
    const unresolved: ResourceStageOutput['unresolved'] = [];

    // ---- 1. collect asset ids referenced by the projected view ----
    // Shared recursive collector (typst/payload.ts): walks block trees and
    // every inline tree (paragraph/heading children, table cells, ...), so
    // inline images count exactly like top-level image/file blocks.
    const referencedIds = new Set<string>();
    for (const message of input.view.messages) {
        throwIfAborted(ctx.signal);
        for (const id of collectReferencedAssetIds(message.blocks)) {
            referencedIds.add(id);
        }
    }
    ctx.log(`[${STAGE_NAME}] ${referencedIds.size} asset reference(s) in projected view`);

    // ---- 2. resolve only the referenced assets ----
    const byId = new Map<string, Asset>();
    for (const asset of input.bundle.assets) byId.set(asset.id, asset);
    const referencedAssets: Asset[] = [];
    for (const id of referencedIds) {
        const asset = byId.get(id);
        if (asset) referencedAssets.push(asset);
    }
    throwIfAborted(ctx.signal);
    // Default options: MAX_ASSET_BYTES bound stays at its default; no
    // readLocalFile is wired (stage input carries no storage reader).
    const result = await resolveAssets(referencedAssets, input.byteStore);
    throwIfAborted(ctx.signal);
    diagnostics.push(...result.diagnostics);

    // ---- 3. pathMap + mounts (virtualPath -> bytes -> mimeType) ----
    // ResolvedAssetEntry has no bytes field; the bytes the resolver validated
    // came from input.byteStore via asset.storageRef, so mounts re-read them
    // from the same store. Content addressing dedupes mounts for free.
    const pathMap = result.pathMap;
    const mounts: ImageMount[] = [];
    const mountedPaths = new Set<string>();
    for (const assetId of referencedIds) {
        const virtualPath = pathMap.get(assetId);
        if (virtualPath === undefined) continue;
        if (mountedPaths.has(virtualPath)) continue;
        mountedPaths.add(virtualPath);
        const entry = result.resolved.get(assetId);
        const storageRef = entry?.asset.storageRef;
        const bytes = storageRef !== undefined ? input.byteStore.get(storageRef) : undefined;
        if (bytes === undefined) {
            // Defensive: cannot happen with default options (resolved implies
            // bytes were read from this store), but never go silent about it.
            const reason = 'resolved to a virtual path but its bytes were unavailable from the byte store';
            unresolved.push({ assetId, reason });
            diagFor(diagnostics, assetId, 'error', 'RESOURCE_BYTES_MISSING',
                `asset ${assetId}: ${reason} (path '${virtualPath}')`);
            continue;
        }
        mounts.push({ virtualPath, bytes, mimeType: entry?.mimeType ?? 'application/octet-stream' });
    }

    // ---- 4. unresolved: referenced but not cleanly resolved ----
    for (const assetId of referencedIds) {
        if (pathMap.has(assetId)) continue;
        const asset = byId.get(assetId);
        const reason = unresolvedReason(asset, result.effectiveStatus);
        unresolved.push({ assetId, reason });
        if (!hasWarnPlus(diagnostics, assetId)) {
            diagFor(diagnostics, assetId, 'warning', 'RESOURCE_ASSET_UNRESOLVED',
                `asset ${assetId} was referenced by the projected view but not resolved: ${reason}`);
        }
    }

    ctx.log(
        `[${STAGE_NAME}] resolved ${pathMap.size}, mounts ${mounts.length}, ` +
        `unresolved ${unresolved.length}, diagnostics ${diagnostics.length}`,
    );
    ctx.reportProgress(STAGE_NAME, 1, 1);
    return { output: { pathMap, mounts, unresolved }, diagnostics };
};
