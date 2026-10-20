import type { DomainAsset } from '../../l2/conversationDetail.js';
import { attemptResource, missingResource, type PreparedResources, type ResourceBytes,
    type ResourceResult } from '../../shared/resources/resourceResult.js';

export async function prepareExportResources(
    assets: readonly DomainAsset[],
    requiredIds: ReadonlySet<string>,
    acquire: (asset: DomainAsset, signal?: AbortSignal) => Promise<ResourceBytes>,
    signal?: AbortSignal,
): Promise<PreparedResources> {
    const prepared = new Map<string, ResourceResult<ResourceBytes>>();
    for (const id of requiredIds) {
        signal?.throwIfAborted();
        const asset = assets.find(asset => asset.id === id);
        prepared.set(id, asset ? await attemptResource(id, async () => {
            const value = await acquire(asset, signal);
            if (!value.bytes.byteLength) throw new Error('Empty resource');
            return { ...value, mediaType: value.mediaType ?? asset.mediaType, name: value.name ?? asset.name };
        }, signal) : missingResource(id, 'Asset metadata unavailable'));
    }
    return prepared;
}
