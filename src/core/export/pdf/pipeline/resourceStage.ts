/**
 * src/core/export/pdf/pipeline/resourceStage.ts
 *
 * D7 S2 (M3): resources stage.
 *
 * Collects every asset referenced by the projected view (shared recursive
 * collector — the same traversal the Typst payload builder uses, so the
 * payload stage can never see an asset this stage missed), resolves the
 * binary-render subset through the shared asset resolver against the
 * per-run byte store, and emits:
 *   - pathMap : assetId -> virtual path (assets needing binary bytes —
 *               block image placements plus kind:'image' message
 *               companions — that resolved cleanly; metadata-only
 *               attachments never enter)
 *   - mounts  : virtual path -> bytes -> mimeType (sandbox mounts for
 *               compile; binary assets only)
 *   - unresolved: binary-referenced-but-not-resolved assets, each with a reason
 *
 * Binary vs metadata-only split (collectBinaryRenderAssetIds): the decision
 * is AST placement, not Asset.kind. Every ImageBlock.assetId and
 * ImageInline.assetId needs bytes (Typst image()); FileBlock/audio/video
 * attachments render as metadata-only cards straight from the Asset entity
 * (name/mimeType/sizeBytes) and skip byte resolution entirely — no read, no
 * hash, no byteStore traffic. A 40MB report.pdf that only shows
 * "report.pdf · PDF · 40 MB" therefore costs nothing here. An image
 * placement referencing a known non-image kind still resolves (placement
 * wins) but gets an ASSET_KIND_MISMATCH warning.
 * Message-level companions (associatedAssetIds, roadmap §43: messages link
 * resources via blocks AND associatedAssetIds) follow the same doctrine:
 * an associated id with kind 'image' and no block placement becomes a
 * trailing image attachment in the Typst payload (renderMessage calls
 * options.assetPath(asset) for it), so it needs bytes exactly like a block
 * image placement. The kind check is legitimate for companions because the
 * payload's own `asset.kind === 'image'` branch is what defines that usage
 * as an image; other/unknown kinds render metadata-only file cards and
 * never touch bytes.
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
import { collectReferencedAssetIds, collectBinaryRenderAssetIds, collectUnplacedAssociatedImageIds } from '../../typst/payload.js';
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
    // inline images count exactly like top-level image blocks.
    // Two sets: every referenced id (for the summary log), and the binary
    // subset — assets referenced by image placements (ImageBlock /
    // ImageInline). The binary decision is placement, not Asset.kind: the
    // canonical validator does not force ImageBlock -> kind 'image', so a
    // kind:'file' asset under an ImageBlock genuinely needs its bytes.
    // File/audio/video blocks are metadata-only (file cards render from the
    // Asset entity) and never reach the resolver.
    // Message-level companions (associatedAssetIds with no block placement)
    // join the same sets: kind 'image' companions become trailing image
    // attachments in the Typst payload and need bytes; other kinds render
    // metadata-only file cards. See the file header for why the kind check
    // is legitimate for companions.
    // Message-level companions (associatedAssetIds with no block placement)
    // join the same sets. Every unplaced associated id counts as referenced
    // (metadata-only file cards render from the Asset entity); which of them
    // are trailing image attachments — and therefore need bytes — is decided
    // by the shared collectUnplacedAssociatedImageIds helper, the same rule
    // the Typst payload builder uses, so the two stages can never disagree.
    // See the file header for why the kind check is legitimate for
    // companions.
    const byId = new Map<string, Asset>();
    for (const asset of input.bundle.assets) byId.set(asset.id, asset);
    const referencedIds = new Set<string>();
    const binaryIds = new Set<string>();
    for (const message of input.view.messages) {
        throwIfAborted(ctx.signal);
        const blockIds = collectReferencedAssetIds(message.blocks);
        for (const id of blockIds) referencedIds.add(id);
        for (const id of collectBinaryRenderAssetIds(message.blocks)) binaryIds.add(id);
        for (const id of message.associatedAssetIds ?? []) {
            // The payload builder skips block-referenced ids for companions
            // (an inline image must not reappear as a trailing attachment),
            // so only ids with no block placement can be companions here.
            if (blockIds.has(id)) continue;
            const asset = byId.get(id);
            if (!asset) continue; // payload skips unknown ids the same way
            referencedIds.add(id);
        }
        for (const id of collectUnplacedAssociatedImageIds(message, blockIds, (aid) => byId.get(aid)?.kind)) {
            binaryIds.add(id);
        }
    }
    // Kind/placement mismatch is diagnostic-only: placement wins for
    // resolution, but a known non-image kind under an image placement
    // usually means the normalizer misclassified the asset.
    for (const id of binaryIds) {
        const asset = byId.get(id);
        if (asset && typeof asset.kind === 'string' && asset.kind !== 'image') {
            diagFor(diagnostics, id, 'warning', 'ASSET_KIND_MISMATCH',
                `asset ${id} is referenced by an image placement but its kind is '${asset.kind}'; resolving by placement`);
        }
    }
    const metadataOnlySkipped = referencedIds.size - binaryIds.size;
    ctx.log(
        `[${STAGE_NAME}] ${referencedIds.size} asset reference(s) in projected view ` +
        `(${binaryIds.size} binary, ${metadataOnlySkipped} metadata-only skipped before resolution)`,
    );

    // ---- 2. resolve only the binary (image-placement + image-companion) assets ----
    // Metadata-only attachments skip resolveAssets() entirely: no byte read,
    // no SHA-256, no byteStore traffic. They are not "unresolved" — their
    // file cards render from Asset metadata — so they get no diagnostic.
    const binaryAssets: Asset[] = [];
    for (const id of binaryIds) {
        const asset = byId.get(id);
        if (asset) binaryAssets.push(asset);
    }
    throwIfAborted(ctx.signal);
    // Default options: MAX_ASSET_BYTES bound stays at its default; no
    // readLocalFile is wired (stage input carries no storage reader).
    const result = await resolveAssets(binaryAssets, input.byteStore);
    throwIfAborted(ctx.signal);
    diagnostics.push(...result.diagnostics);

    // ---- 3. pathMap + mounts (virtualPath -> bytes -> mimeType) ----
    // ResolvedAssetEntry has no bytes field; the bytes the resolver validated
    // came from input.byteStore via asset.storageRef, so mounts re-read them
    // from the same store. Content addressing dedupes mounts for free.
    const pathMap = result.pathMap;
    const mounts: ImageMount[] = [];
    const mountedPaths = new Set<string>();
    // Asset ids whose bytes vanished between resolve and mount (defensive
    // branch below). They are already in `unresolved` with a dedicated
    // RESOURCE_BYTES_MISSING diagnostic; step 4 must not re-report them.
    const bytesMissing = new Set<string>();
    for (const assetId of binaryIds) {
        const virtualPath = pathMap.get(assetId);
        if (virtualPath === undefined) continue;
        if (mountedPaths.has(virtualPath)) continue;
        const entry = result.resolved.get(assetId);
        const storageRef = entry?.asset.storageRef;
        const bytes = storageRef !== undefined ? input.byteStore.get(storageRef) : undefined;
        if (bytes === undefined) {
            // Defensive: cannot happen with default options (resolved implies
            // bytes were read from this store), but never go silent about it.
            // Keep the output contract honest: pathMap is only for assets
            // that resolved cleanly, so drop the stale entry.
            pathMap.delete(assetId);
            bytesMissing.add(assetId);
            const reason = 'resolved to a virtual path but its bytes were unavailable from the byte store';
            unresolved.push({ assetId, reason });
            diagFor(diagnostics, assetId, 'error', 'RESOURCE_BYTES_MISSING',
                `asset ${assetId}: ${reason} (path '${virtualPath}')`);
            continue;
        }
        mountedPaths.add(virtualPath);
        mounts.push({ virtualPath, bytes, mimeType: entry?.mimeType ?? 'application/octet-stream' });
    }

    // ---- 4. unresolved: binary-referenced but not cleanly resolved ----
    // Metadata-only attachments are intentionally absent from this list:
    // their file cards render from Asset metadata, so there is nothing to
    // resolve and nothing to diagnose.
    for (const assetId of binaryIds) {
        if (pathMap.has(assetId)) continue;
        if (bytesMissing.has(assetId)) continue; // diagnosed with RESOURCE_BYTES_MISSING above
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
        `unresolved ${unresolved.length}, diagnostics ${diagnostics.length}, ` +
        `metadata-only skipped before resolution ${metadataOnlySkipped}`,
    );
    ctx.reportProgress(STAGE_NAME, 1, 1);
    return { output: { pathMap, mounts, unresolved }, diagnostics };
};
