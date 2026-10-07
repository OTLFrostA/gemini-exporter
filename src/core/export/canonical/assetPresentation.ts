import type { Asset } from './assets.js';
import { assetPresentation as presentResource, isHumanMeaningfulFilename } from '../document/resourcePresentation.js';
export { assetCaptionText, isHumanMeaningfulFilename } from '../document/resourcePresentation.js';

/** Compatibility for callers not yet migrated to Domain resources. */
export function assetPresentation(asset?: Asset, explicit?: string, fallback = 'Image'): { label: string; caption?: string } {
    return presentResource(asset && { id: asset.id, kind: asset.kind, name: isHumanMeaningfulFilename(asset.name) ? asset.name : asset.kind === 'file' ? asset.storageRef?.split('/').pop() : asset.name }, explicit, fallback);
}
