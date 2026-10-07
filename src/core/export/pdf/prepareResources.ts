import type { DomainConversationDetail } from '../../domain/conversationDetail.js';
import type { AcquireAssetBytesResult } from '../../engine/assetPipeline.js';
import type { ResourceAcquisitionHint, ResourceAcquisitionHints } from '../assets/resourceAcquisitionHints.js';
import type { PreparedResource, PreparedResources } from '../assets/preparedResources.js';
import type { DocumentDiagnostic } from '../document/ast.js';
import { decodeDataUrl } from '../assets/dataUrl.js';
import { MAX_ASSET_BYTES } from '../assets/imageContent.js';

interface PreparePdfResourcesOptions {
    signal?: AbortSignal;
    acquire?: (assetId: string, hint: ResourceAcquisitionHint) => Promise<AcquireAssetBytesResult>;
    onFailure?: (assetId: string, reason: string) => void;
}

/** Runtime bytes and failures belong only to PreparedResources, never input facts or AST. */
export async function preparePdfResources(
    domain: DomainConversationDetail,
    imageIds: ReadonlySet<string>,
    acquisitionHints: ResourceAcquisitionHints,
    options: PreparePdfResourcesOptions = {},
): Promise<{ resources: PreparedResources; diagnostics: DocumentDiagnostic[]; aborted: boolean }> {
    const resources = new Map<string, PreparedResource>();
    const diagnostics: DocumentDiagnostic[] = [];
    for (const asset of domain.assets) {
        if (options.signal?.aborted) return { resources, diagnostics, aborted: true };
        const resource: PreparedResource = { name: asset.name, mediaType: asset.mediaType, failureReason: asset.failureReason };
        resources.set(asset.id, resource);
        // PDF only needs bytes for image placements, not metadata-only file cards.
        if (!imageIds.has(asset.id)) continue;
        const uri = asset.source?.uri;
        if (asset.dataBase64 || /^data:/i.test(uri ?? '')) {
            const raw = asset.dataBase64?.replace(/^data:[^,]*,/i, '').replace(/\s+/g, '');
            const source = raw ? `data:${asset.mediaType ?? 'application/octet-stream'};base64,${raw.padEnd(Math.ceil(raw.length / 4) * 4, '=')}` : uri!;
            const decoded = asset.dataBase64 ? decodeDataUrl(source, MAX_ASSET_BYTES) : decodeDataUrl(source);
            if (decoded.ok) {
                resource.bytes = decoded.bytes;
                resource.mediaType = decoded.mimeType;
                resource.failureReason = undefined;
            } else {
                resource.failureReason = decoded.reason;
                diagnostics.push({ severity: 'warning', code: decoded.code, message: decoded.message, path: `asset:${asset.id}` });
            }
            continue;
        }
        const hint = acquisitionHints[asset.id];
        if (!options.acquire || (!hint && !uri)) continue;
        // Clone transport evidence as well: injected transports may be mutable.
        const acquired = await options.acquire(asset.id, {
            ...(uri ? { url: uri } : {}),
            ...(hint ?? { localName: `assets/${asset.name || asset.id}`, fileName: asset.name }),
            ...(hint?.generation ? { generation: { ...hint.generation } } : {}),
            ...(hint?.candidates ? { candidates: [...hint.candidates] } : {}),
        });
        if (options.signal?.aborted || acquired.failReason === 'aborted') return { resources, diagnostics, aborted: true };
        if (acquired.ok && acquired.bytes?.byteLength) {
            resource.bytes = acquired.bytes;
            resource.mediaType = acquired.mimeType || resource.mediaType;
            resource.failureReason = undefined;
        } else {
            resource.failureReason = acquired.failReason || 'image direct download failed';
            options.onFailure?.(asset.id, resource.failureReason);
        }
    }
    return { resources, diagnostics, aborted: false };
}
