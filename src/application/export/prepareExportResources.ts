import type { DomainAsset } from '../../l2/conversationDetail.js';
import { attemptResource, missingResource, ResourceProcessingError, type PreparedResources, type ResourceBytes,
    type ResourceResult } from '../../shared/resources/resourceResult.js';

export async function prepareExportResources(
    assets: readonly DomainAsset[],
    requiredIds: ReadonlySet<string>,
    acquire: (asset: DomainAsset, signal?: AbortSignal) => Promise<ResourceBytes>,
    signal?: AbortSignal,
): Promise<PreparedResources> {
    const prepared = new Map<string, ResourceResult>();
    for (const id of requiredIds) {
        signal?.throwIfAborted();
        const asset = assets.find(asset => asset.id === id);
        const result = asset ? await attemptResource(id, async () => {
            const value = await acquire(asset, signal);
            if (!value.bytes.byteLength) throw new ResourceProcessingError('Empty resource');
            return { ...value, mediaType: value.mediaType ?? asset.mediaType, name: value.name ?? asset.name };
        }, signal) : missingResource(id, 'Asset metadata unavailable', 'RESOURCE_METADATA_UNAVAILABLE');
        const sourceUri = asset?.sourceUri;
        prepared.set(id, !result.ok && sourceUri && /^https:\/\//i.test(sourceUri)
            ? { ...result, sourceUrl: sourceUri } : result);
    }
    return prepared;
}
