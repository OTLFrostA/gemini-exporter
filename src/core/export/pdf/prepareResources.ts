import { attemptResource, missingResource, resourceDiagnostics, type ResourceResult } from '../../resources/resourceResult.js';
import type { DomainConversationDetail } from '../../domain/conversationDetail.js';
import type { AcquireAssetBytesResult } from '../../engine/assetPipeline.js';
import type { ResourceAcquisitionHint, ResourceAcquisitionHints } from '../../parsers/shared/resources/resourceAcquisitionHints.js';
import type { PreparedResource, PreparedResources } from '../assets/preparedResources.js';
import type { DocumentDiagnostic } from '../../diagnostics/documentDiagnostic.js';
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
        let decodeFailureCode: string | undefined;
        let outcome: ResourceResult<{ bytes: Uint8Array; mediaType?: string }>;
        try {
            outcome = await attemptResource(asset.id, async () => {
                if (asset.dataBase64 || /^data:/i.test(uri ?? '')) {
                    const raw = asset.dataBase64?.replace(/^data:[^,]*,/i, '').replace(/\s+/g, '');
                    const source = raw ? `data:${asset.mediaType ?? 'application/octet-stream'};base64,${raw.padEnd(Math.ceil(raw.length / 4) * 4, '=')}` : uri!;
                    const decoded = asset.dataBase64 ? decodeDataUrl(source, MAX_ASSET_BYTES) : decodeDataUrl(source);
                    if (!decoded.ok) { decodeFailureCode = decoded.code; throw new Error(decoded.message); }
                    return { bytes: decoded.bytes, mediaType: decoded.mimeType };
                }
                const hint = acquisitionHints[asset.id];
                if (!options.acquire || (!hint && !uri)) throw new Error(asset.failureReason || 'Image acquisition is unavailable (no network fetch without an acquisition transport)');
                const acquired = await options.acquire(asset.id, {
                    ...(uri ? { url: uri } : {}),
                    ...(hint ?? { localName: `assets/${asset.name || asset.id}`, fileName: asset.name }),
                    ...(hint?.generation ? { generation: { ...hint.generation } } : {}),
                    ...(hint?.candidates ? { candidates: [...hint.candidates] } : {}),
                });
                if (acquired.failReason === 'aborted') throw new DOMException('Image acquisition aborted', 'AbortError');
                if (!acquired.ok || !acquired.bytes?.byteLength) throw new Error(acquired.failReason || 'Image acquisition returned no bytes');
                return { bytes: acquired.bytes, mediaType: acquired.mimeType };
            }, options.signal);
        } catch (error) {
            if (options.signal?.aborted || error instanceof Error && error.name === 'AbortError') return { resources, diagnostics, aborted: true };
            outcome = missingResource(asset.id, error instanceof Error ? error.message : String(error));
        }
        if (outcome.ok) {
            resource.bytes = outcome.value.bytes;
            resource.mediaType = outcome.value.mediaType || resource.mediaType;
            resource.failureReason = undefined;
        } else {
            if (decodeFailureCode) outcome = { ...outcome, code: decodeFailureCode };
            resource.failureReason = outcome.reason;
            diagnostics.push(...resourceDiagnostics([outcome]));
            options.onFailure?.(asset.id, outcome.reason);
        }
    }
    return { resources, diagnostics, aborted: false };
}
