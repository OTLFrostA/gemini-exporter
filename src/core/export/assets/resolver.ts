import { classifyAssetAvailability } from '../canonical/assetResolution.js';
import type { Asset, AssetStatus } from '../canonical/assets.js';
import type { RenderDiagnostic } from '../canonical/rendering.js';
import { sha256Hex } from './sha256.js';

import { checkImageContent, normalizeMime, extFromName, MAX_ASSET_BYTES, buildVirtualAssetPath } from './imageContent.js';
export { MAX_ASSET_BYTES, buildVirtualAssetPath } from './imageContent.js';

export interface InlineByteSource {
    has(storageRef: string): boolean;
    get(storageRef: string): Uint8Array | undefined;
}

export interface AssetResolverOptions {
    readLocalFile?: (storageRef: string) => Promise<Uint8Array | undefined | null>;
    hashBytes?: (bytes: Uint8Array) => Promise<string>;
    maxBytes?: number;
}

export interface ResolvedAssetEntry {
    asset: Asset;
    path: string;
    sizeBytes: number;
    mimeType: string;
}

export interface ResolveAssetsResult {
    pathMap: Map<string, string>;
    resolved: Map<string, ResolvedAssetEntry>;
    effectiveStatus: Map<string, AssetStatus>;
    diagnostics: RenderDiagnostic[];
}

function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function isUrlRef(ref: string): boolean {
    return /^(https?|data|blob|ftp):/i.test(ref);
}

function extForGenericAsset(asset: Asset): string {
    const fromName = extFromName(asset.name);
    if (fromName) return fromName;
    const mime = normalizeMime(asset.mimeType);
    if (mime) {
        const subtype = mime.split('/')[1]?.replace(/[^a-z0-9]/g, '');
        if (subtype) return subtype.slice(0, 10);
    }
    return 'bin';
}

export async function resolveAssets(
    assets: readonly Asset[],
    byteStore: InlineByteSource | undefined,
    options: AssetResolverOptions = {},
): Promise<ResolveAssetsResult> {
    const maxBytes = options.maxBytes ?? MAX_ASSET_BYTES;
    const hashBytes = options.hashBytes ?? sha256Hex;
    const pathMap = new Map<string, string>();
    const resolved = new Map<string, ResolvedAssetEntry>();
    const effectiveStatus = new Map<string, AssetStatus>();
    const diagnostics: RenderDiagnostic[] = [];

    const diag = (
        assetId: string,
        severity: RenderDiagnostic['severity'],
        code: string,
        message: string,
    ): void => {
        diagnostics.push({ severity, code, message, path: `asset:${assetId}` });
    };

    for (const asset of assets) {
        if (asset.status === 'remote') {
            effectiveStatus.set(asset.id, 'remote');
            diag(asset.id, 'info', 'ASSET_REMOTE_ONLY',
                `asset ${asset.id} is remote-only (sourceUrl: ${asset.sourceUrl ?? 'unknown'}); ` +
                `resolver performs no network fetch (offline rule) — handle at export time or skip`);
            continue;
        }
        if (asset.status === 'missing' || asset.status === 'failed' || asset.status === 'notFetched') {
            effectiveStatus.set(asset.id, asset.status);
            const reason = asset.failureReason ? ` reason: ${asset.failureReason}` : '';
            diag(asset.id, asset.status === 'notFetched' ? 'info' : 'warning', 'ASSET_UNAVAILABLE',
                `asset ${asset.id} has status '${asset.status}' — no bytes resolved, no path assigned.${reason}`);
            continue;
        }

        let bytes: Uint8Array | undefined;
        let fetchNote: string | undefined;
        const ref = asset.storageRef;
        if (!ref) {
            fetchNote = 'marked available but has no storageRef';
        } else if (byteStore?.has(ref)) {
            const b = byteStore.get(ref);
            if (b !== undefined) bytes = b;
            else fetchNote = `inline byte source has no bytes for storageRef '${ref}'`;
        } else if (isUrlRef(ref)) {
            fetchNote = `storageRef '${ref}' is a remote URL, not a resolvable local ref`;
        } else if (options.readLocalFile) {
            try {
                const b = await options.readLocalFile(ref);
                if (b !== undefined && b !== null) bytes = b;
                else fetchNote = `local file not found for storageRef '${ref}'`;
            } catch (err) {
                diag(asset.id, 'warning', 'ASSET_LOCAL_READ_ERROR',
                    `failed reading local file for asset ${asset.id} (storageRef: '${ref}'): ${errMsg(err)}`);
                fetchNote = `local file read failed for storageRef '${ref}'`;
            }
        } else {
            fetchNote = `no bytes for storageRef '${ref}' (no inline bytes; no local file reader wired)`;
        }

        const classified = classifyAssetAvailability(asset, bytes !== undefined);
        if (classified.pseudoAvailable) {
            effectiveStatus.set(asset.id, 'missing');
            diag(asset.id, 'warning', 'PSEUDO_AVAILABLE',
                `asset ${asset.id} was marked 'available' but no bytes could be resolved` +
                (fetchNote ? ` (${fetchNote})` : '') + '; treating as missing');
            continue;
        }

        const b = bytes as Uint8Array;

        if (b.length === 0) {
            effectiveStatus.set(asset.id, 'failed');
            diag(asset.id, 'warning', 'ASSET_ZERO_BYTES',
                `asset ${asset.id} resolved to zero bytes; no path assigned`);
            continue;
        }
        if (b.length > maxBytes) {
            effectiveStatus.set(asset.id, 'failed');
            diag(asset.id, 'warning', 'ASSET_TOO_LARGE',
                `asset ${asset.id} is ${b.length} bytes, exceeding the ${maxBytes}-byte limit; refused, no path assigned`);
            continue;
        }

        let ext: string;
        let mime: string;
        if (asset.kind === 'image') {
            const verdict = checkImageContent(asset, b, diag);
            if (!verdict.ok) {
                effectiveStatus.set(asset.id, 'failed');
                continue;
            }
            ext = verdict.ext;
            mime = verdict.mime;
        } else {
            ext = extForGenericAsset(asset);
            mime = normalizeMime(asset.mimeType) ?? 'application/octet-stream';
        }

        let hash: string;
        try {
            hash = await hashBytes(b);
        } catch (err) {
            effectiveStatus.set(asset.id, 'failed');
            diag(asset.id, 'error', 'ASSET_HASH_FAILED',
                `failed hashing bytes for asset ${asset.id}: ${errMsg(err)}; no path assigned`);
            continue;
        }
        const path = buildVirtualAssetPath(hash, ext);
        pathMap.set(asset.id, path);
        resolved.set(asset.id, { asset, path, sizeBytes: b.length, mimeType: mime });
        effectiveStatus.set(asset.id, 'available');
    }

    return { pathMap, resolved, effectiveStatus, diagnostics };
}
