import { collectPdfImageIds } from '../imageResources.js';
import { collectDocumentResources } from '../../document/resourceReferences.js';
import { checkImageContent, MAX_ASSET_BYTES, buildVirtualAssetPath } from '../../assets/imageContent.js';
import { sha256Hex } from '../../assets/sha256.js';
import type { ImageMount, RenderDiagnostic, ResourceStageInput, ResourceStageOutput, StageFn } from './types.js';

/** Only image placements need binary mounts. File cards already carry their presentation metadata in AST. */
export const resourceStage: StageFn<ResourceStageInput, ResourceStageOutput> = async (input, ctx) => {
    ctx.signal.throwIfAborted();
    const diagnostics: RenderDiagnostic[] = [];
    const unresolved: ResourceStageOutput['unresolved'] = [];
    const pathMap = new Map<string, string>();
    const mounts: ImageMount[] = [], mountedPaths = new Set<string>();
    const { referencedIds } = collectDocumentResources(input.document);
    const imageIds = collectPdfImageIds(input.document);
    const diag = (id: string, severity: RenderDiagnostic['severity'], code: string, message: string): void => {
        diagnostics.push({ severity, code, message, path: `asset:${id}` });
    };
    for (const id of imageIds) {
        ctx.signal.throwIfAborted();
        const resource = input.resources.get(id);
        const bytes = resource?.bytes;
        let reason: string | undefined;
        if (!resource) reason = 'image placement has no registered prepared resource';
        else if (!bytes) reason = resource.failureReason ?? 'no prepared image bytes (offline resource stage performs no network fetch)';
        else if (!bytes.length) {
            reason = 'image resolved to zero bytes';
            diag(id, 'warning', 'ASSET_ZERO_BYTES', reason);
        } else if (bytes.length > MAX_ASSET_BYTES) {
            reason = `image exceeds the ${MAX_ASSET_BYTES}-byte limit`;
            diag(id, 'warning', 'ASSET_TOO_LARGE', reason);
        } else {
            const verdict = checkImageContent({ id, name: resource.name, mimeType: resource.mediaType }, bytes, diag);
            if (!verdict.ok) reason = 'image bytes are corrupt or unsupported';
            else {
                try {
                    const path = buildVirtualAssetPath(await sha256Hex(bytes), verdict.ext);
                    ctx.signal.throwIfAborted();
                    pathMap.set(id, path);
                    if (!mountedPaths.has(path)) {
                        mountedPaths.add(path);
                        mounts.push({ virtualPath: path, bytes, mimeType: verdict.mime });
                    }
                } catch (error) {
                    ctx.signal.throwIfAborted();
                    reason = `failed hashing image: ${error instanceof Error ? error.message : String(error)}`;
                    diag(id, 'error', 'ASSET_HASH_FAILED', reason);
                }
            }
        }
        if (reason) {
            unresolved.push({ assetId: id, reason });
            if (!diagnostics.some(d => d.path === `asset:${id}` && d.severity !== 'info')) diag(id, 'warning', 'RESOURCE_ASSET_UNRESOLVED', reason);
        }
    }
    ctx.log(`[resources] ${referencedIds.size} references, ${pathMap.size} resolved, ${mounts.length} mounts, ${unresolved.length} unresolved, ${referencedIds.size - imageIds.size} metadata-only skipped`);
    ctx.reportProgress('resources', 1, 1);
    return { output: { pathMap, mounts, unresolved }, diagnostics };
};
