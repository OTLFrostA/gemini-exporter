/**
 * src/core/export/assets/index.ts
 * Barrel for the inline-asset byte pipeline (decode -> hash -> store -> resolve).
 */

export { createInlineByteStore } from './byteStore.js';
export type { InlineByteStore } from './byteStore.js';
export { sha256Hex } from './sha256.js';
export { decodeDataUrlAsset, INLINE_DATA_URL_MAX_BYTES } from './dataUrl.js';
export type {
    DecodedDataUrlAsset,
    DataUrlDecodeError,
    DataUrlDecodeErrorCode,
    DataUrlDecodeResult,
} from './dataUrl.js';
export { resolveAssets, buildVirtualAssetPath, MAX_ASSET_BYTES } from './resolver.js';
export type {
    AssetResolverOptions,
    InlineByteSource,
    ResolveAssetsResult,
    ResolvedAssetEntry,
} from './resolver.js';
