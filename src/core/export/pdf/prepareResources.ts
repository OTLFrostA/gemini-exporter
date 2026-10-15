import { missingResource, resourceDiagnostics, type ResourceResult, type ResourceBytes, type PreparedResources } from '../../resources/resourceResult.js';
import type { DomainConversationDetail } from '../../domain/conversationDetail.js';
import type { ResourceAcquisitionHint, ResourceAcquisitionHints } from '../../resources/resourceAcquisition.js';
import type { Diagnostic } from '../../diagnostics/diagnostic.js';
import { decodeDataUrl } from '../assets/dataUrl.js';
import { MAX_ASSET_BYTES } from '../assets/imageContent.js';

interface PreparePdfResourcesOptions {
    signal?: AbortSignal;
    acquire?: (assetId: string, hint: ResourceAcquisitionHint) => Promise<ResourceResult<ResourceBytes>>;
    onFailure?: (assetId: string, reason: string) => void;
}

/** Runtime bytes and failures travel beside Domain/AST through the shared resource contract. */
export async function preparePdfResources(
    domain: DomainConversationDetail,
    imageIds: ReadonlySet<string>,
    acquisitionHints: ResourceAcquisitionHints,
    options: PreparePdfResourcesOptions = {},
): Promise<{ resources: PreparedResources; diagnostics: Diagnostic[]; aborted: boolean }> {
    const resources = new Map<string, ResourceResult<ResourceBytes>>();
    const diagnostics: Diagnostic[] = [];
    for (const asset of domain.assets) {
        if (options.signal?.aborted) return { resources, diagnostics, aborted: true };
        // File cards already have their presentation metadata in AST.
        if (!imageIds.has(asset.id)) continue;
        const uri = asset.sourceUri;
        let outcome: ResourceResult<ResourceBytes>;
        try {
            if (asset.dataBase64 || /^data:/i.test(uri ?? '')) {
                const raw = asset.dataBase64?.replace(/^data:[^,]*,/i, '').replace(/\s+/g, '');
                const source = raw ? `data:${asset.mediaType ?? 'application/octet-stream'};base64,${raw.padEnd(Math.ceil(raw.length / 4) * 4, '=')}` : uri!;
                const decoded = asset.dataBase64 ? decodeDataUrl(source, MAX_ASSET_BYTES) : decodeDataUrl(source);
                outcome = decoded.ok ? { ok: true, resourceId: asset.id, value: { bytes: decoded.bytes, mediaType: decoded.mimeType } }
                    : missingResource(asset.id, decoded.message, decoded.code);
            } else {
                const hint = acquisitionHints[asset.id];
                if (!options.acquire || (!hint && !uri)) throw new Error('Image acquisition is unavailable (no network fetch without an acquisition transport)');
                outcome = await options.acquire(asset.id, {
                    ...(uri ? { url: uri } : {}),
                    ...(hint ?? { localName: `assets/${asset.name || asset.id}`, fileName: asset.name }),
                    ...(hint?.generation ? { generation: { ...hint.generation } } : {}),
                    ...(hint?.candidates ? { candidates: [...hint.candidates] } : {}),
                });
            }
            options.signal?.throwIfAborted();
            if (outcome.ok) {
                const { bytes, mediaType } = outcome.value;
                outcome = bytes.byteLength ? { ok: true, resourceId: asset.id, value: { bytes, name: asset.name, mediaType: mediaType || asset.mediaType } }
                    : missingResource(asset.id, 'Image acquisition returned no bytes', 'ASSET_ZERO_BYTES');
            }
        } catch (error) {
            if (options.signal?.aborted || error instanceof Error && error.name === 'AbortError') return { resources, diagnostics, aborted: true };
            outcome = missingResource(asset.id, error instanceof Error ? error.message : String(error));
        }
        resources.set(asset.id, outcome);
        if (!outcome.ok) {
            diagnostics.push(...resourceDiagnostics([outcome]));
            options.onFailure?.(asset.id, outcome.reason);
        }
    }
    return { resources, diagnostics, aborted: false };
}
