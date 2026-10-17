import type { DomainAsset } from '../domain/conversationDetail.js';
import type { ResourceBytes } from '../resources/resourceResult.js';

/** Bytes remain acquisition output, never a second Detail field. */
export async function acquireSourceResource(asset: DomainAsset, signal?: AbortSignal): Promise<ResourceBytes> {
    signal?.throwIfAborted();
    if (!asset.sourceUri || !/^https:\/\//i.test(asset.sourceUri)) throw new Error('No supported source locator');
    const response = await fetch(asset.sourceUri, { credentials: 'include', signal });
    if (!response.ok) throw new Error(`Resource request failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    signal?.throwIfAborted();
    if (!bytes.byteLength) throw new Error('Empty source resource');
    return { bytes, ...(asset.mediaType ? { mediaType: asset.mediaType } : {}), ...(asset.name ? { name: asset.name } : {}) };
}
