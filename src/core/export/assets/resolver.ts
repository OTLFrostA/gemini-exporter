/**
 * src/core/export/assets/resolver.ts
 * Real asset resolution pipeline for the PDF/Typst export route (Phase D-2).
 *
 * Turns canonical Assets into content-addressed virtual paths of the form
 *   assets/sha256/<h0h1>/<h2h3>/<hex-sha256>.<ext>
 * for Typst image() consumption (TypstPayloadOptions.assetPath).
 *
 * Offline iron rule: this stage NEVER performs network fetches. Remote-only
 * assets are reported, never fetched. Every omission produces a diagnostic;
 * nothing is silent and no bytes are invented.
 *
 * Byte-source wiring (done by the follow-up P2 integration PR, not here):
 * - byteStore: the per-run InlineByteStore instance from the normalize
 *   result (createInlineByteStore(); NOT the old module-global functions,
 *   which are being removed). Pass it positionally:
 *       resolveAssets(assets, byteStore, { readLocalFile })
 * - options.readLocalFile: wire to the export storage layer for archive-local
 *   refs in normalizeLocalName form (e.g. 'assets/photo.png').
 *
 * Frozen surface (additive-only evolution): resolveAssets,
 * AssetResolverOptions, InlineByteSource, ResolveAssetsResult,
 * ResolvedAssetEntry, MAX_ASSET_BYTES, buildVirtualAssetPath.
 */

import { classifyAssetAvailability } from '../canonical/assetResolution.js';
import type { Asset, AssetStatus } from '../canonical/assets.js';
import type { RenderDiagnostic } from '../canonical/rendering.js';
import { sha256Hex } from './sha256.js';

/**
 * Size gate: assets larger than this are refused with a diagnostic.
 * Exported as a constant so the threshold is a single source of truth.
 */
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;

/**
 * Structural read subset of the per-run InlineByteStore contract
 * (createInlineByteStore(); put/get/has/clear/entryCount). The resolver only
 * needs has/get, so the full store instance is assignable here. Defined
 * locally (not imported from ./byteStore.js) so this module never depends on
 * module-global byte state.
 */
export interface InlineByteSource {
    has(storageRef: string): boolean;
    get(storageRef: string): Uint8Array | undefined;
}

export interface AssetResolverOptions {
    /**
     * Reads bytes for a normalized local storageRef (e.g. 'assets/photo.png').
     * Wire to the export storage layer in the P2 PR. Absent => local refs
     * resolve as missing with a diagnostic (never silent).
     */
    readLocalFile?: (storageRef: string) => Promise<Uint8Array | undefined | null>;
    /**
     * Hex SHA-256 of bytes. Defaults to the sibling dependency-free
     * implementation (./sha256.js), which works in every extension context
     * (page, content script, service worker). Inject for determinism in tests.
     */
    hashBytes?: (bytes: Uint8Array) => string;
    /** Override for MAX_ASSET_BYTES. Primarily for tests; production uses the constant. */
    maxBytes?: number;
}

export interface ResolvedAssetEntry {
    asset: Asset;
    /** Virtual path for Typst image(), e.g. assets/sha256/ab/cd/<hex>.png */
    path: string;
    sizeBytes: number;
    /** Content type the bytes were validated as. */
    mimeType: string;
}

export interface ResolveAssetsResult {
    /** assetId -> virtual path, only for assets that resolved cleanly. */
    pathMap: Map<string, string>;
    /** Per-asset detail for resolved assets, keyed by asset id. */
    resolved: Map<string, ResolvedAssetEntry>;
    /** Effective status per asset id (canonical classifyAssetAvailability semantics). */
    effectiveStatus: Map<string, AssetStatus>;
    /** Every omission is diagnosed; a clean resolve emits no diagnostic. */
    diagnostics: RenderDiagnostic[];
}

/** Pure helper: build the content-addressed virtual path for a hash + extension. */
export function buildVirtualAssetPath(hashHex: string, ext: string): string {
    const h = hashHex.toLowerCase();
    return `assets/sha256/${h.slice(0, 2)}/${h.slice(2, 4)}/${h}.${ext}`;
}

function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function isUrlRef(ref: string): boolean {
    return /^(https?|data|blob|ftp):/i.test(ref);
}

interface ImageTypeInfo {
    mime: string;
    ext: string;
    magic: (b: Uint8Array) => boolean;
}

function startsWithBytes(b: Uint8Array, prefix: number[]): boolean {
    if (b.length < prefix.length) return false;
    return prefix.every((v, i) => b[i] === v);
}

function startsWithAscii(b: Uint8Array, s: string): boolean {
    if (b.length < s.length) return false;
    for (let i = 0; i < s.length; i++) {
        if (b[i] !== s.charCodeAt(i)) return false;
    }
    return true;
}

/** Image types Typst image() can render. Magic-sniffed, never trusted from metadata alone. */
const SUPPORTED_IMAGE_TYPES: ImageTypeInfo[] = [
    { mime: 'image/png', ext: 'png', magic: (b) => startsWithBytes(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    { mime: 'image/jpeg', ext: 'jpg', magic: (b) => startsWithBytes(b, [0xff, 0xd8, 0xff]) },
    {
        mime: 'image/gif', ext: 'gif',
        magic: (b) => startsWithAscii(b, 'GIF87a') || startsWithAscii(b, 'GIF89a'),
    },
    {
        mime: 'image/svg+xml', ext: 'svg',
        magic: (b) => isSvgDocument(b),
    },
    {
        mime: 'image/webp', ext: 'webp',
        magic: (b) => b.length >= 12 && startsWithAscii(b, 'RIFF') && startsWithAscii(b.slice(8, 12), 'WEBP'),
    },
];

function sniffImage(bytes: Uint8Array): ImageTypeInfo | undefined {
    return SUPPORTED_IMAGE_TYPES.find((t) => t.magic(bytes));
}

/** XML whitespace bytes. */
function isXmlWs(c: number): boolean {
    return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function skipXmlWs(b: Uint8Array, i: number): number {
    while (i < b.length && isXmlWs(b[i])) i++;
    return i;
}

function matchAscii(b: Uint8Array, i: number, s: string): boolean {
    if (i + s.length > b.length) return false;
    for (let k = 0; k < s.length; k++) {
        if (b[i + k] !== s.charCodeAt(k)) return false;
    }
    return true;
}

/** Skip a <!-- ... --> comment starting at i. Returns the index after '-->', or -1 if unterminated. */
function skipXmlComment(b: Uint8Array, i: number): number {
    let j = i + 4; // past '<!--'
    while (j + 2 < b.length) {
        if (b[j] === 0x2d && b[j + 1] === 0x2d && b[j + 2] === 0x3e) return j + 3; // '-->'
        j++;
    }
    return -1;
}

/** Skip a <?...?> processing instruction starting at i. Returns the index after '?>', or -1 if unterminated. */
function skipProcessingInstruction(b: Uint8Array, i: number): number {
    let j = i + 2; // past '<?'
    while (j + 1 < b.length) {
        if (b[j] === 0x3f && b[j + 1] === 0x3e) return j + 2; // '?>'
        j++;
    }
    return -1;
}

/**
 * Skip a <!DOCTYPE ...> declaration starting at i (including an internal
 * subset in [...] and quoted '>' inside it). Returns the index after the
 * closing '>', or -1 if unterminated.
 */
function skipDoctype(b: Uint8Array, i: number): number {
    let j = i + 9; // past '<!DOCTYPE' (caller matches case-insensitively first)
    let subsetDepth = 0;
    let quote = 0;
    while (j < b.length) {
        const c = b[j];
        if (quote !== 0) {
            if (c === quote) quote = 0;
        } else if (c === 0x22 || c === 0x27) { // '"' or "'"
            quote = c;
        } else if (c === 0x5b) { // '['
            subsetDepth++;
        } else if (c === 0x5d) { // ']'
            if (subsetDepth > 0) subsetDepth--;
        } else if (c === 0x3e && subsetDepth === 0) { // '>'
            return j + 1;
        }
        j++;
    }
    return -1;
}

/**
 * True when the bytes are an SVG document: after an optional UTF-8 BOM,
 * whitespace, at most one XML declaration, comments and a DOCTYPE, the root
 * element must be <svg followed by a name terminator (whitespace, '>', '/',
 * or a namespace ':'). A bare '<' (e.g. <html>, <foo>, <script>) is NOT
 * enough — the old check accepted any of those as SVG.
 */
function isSvgDocument(b: Uint8Array): boolean {
    let i = 0;
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3; // UTF-8 BOM
    let sawXmlDecl = false;
    for (let guard = 0; guard < 32; guard++) {
        i = skipXmlWs(b, i);
        if (matchAscii(b, i, '<?xml') || matchAscii(b, i, '<?XML')) {
            if (sawXmlDecl) return false;
            const after = i + 5;
            if (after >= b.length || (!isXmlWs(b[after]) && b[after] !== 0x3f)) return false; // '<?xmlfoo' is not a declaration
            const end = skipProcessingInstruction(b, i);
            if (end < 0) return false;
            sawXmlDecl = true;
            i = end;
            continue;
        }
        if (matchAscii(b, i, '<!--')) {
            const end = skipXmlComment(b, i);
            if (end < 0) return false;
            i = end;
            continue;
        }
        if (matchAscii(b, i, '<!DOCTYPE') || matchAscii(b, i, '<!doctype') || matchAscii(b, i, '<!Doctype')) {
            const after = i + 9;
            if (after >= b.length || (!isXmlWs(b[after]) && b[after] !== 0x3e)) return false;
            const end = skipDoctype(b, i);
            if (end < 0) return false;
            i = end;
            continue;
        }
        break;
    }
    i = skipXmlWs(b, i);
    if (!matchAscii(b, i, '<svg')) return false;
    const t = i + 4;
    if (t >= b.length) return false;
    const c = b[t];
    return isXmlWs(c) || c === 0x3e || c === 0x2f || c === 0x3a; // ws | '>' | '/' | ':'
}

function normalizeMime(mimeType?: string): string | undefined {
    if (!mimeType) return undefined;
    const base = mimeType.split(';')[0].trim().toLowerCase();
    if (!base) return undefined;
    if (base === 'image/jpg' || base === 'image/pjpeg') return 'image/jpeg';
    if (base === 'image/x-png') return 'image/png';
    return base;
}

function extFromName(name?: string): string | undefined {
    if (!name) return undefined;
    const dot = name.lastIndexOf('.');
    if (dot < 0 || dot === name.length - 1) return undefined;
    const ext = name.slice(dot + 1).toLowerCase();
    return /^[a-z0-9]{1,10}$/.test(ext) ? ext : undefined;
}

/** Extension for non-image kinds: from name, else sanitized MIME subtype, else 'bin'. */
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

/**
 * Resolve real bytes for available assets, validate them, and assign
 * content-addressed virtual paths. Content addressing gives collision
 * handling for free: same bytes -> same path (dedup), same name with
 * different bytes -> different paths (no collision).
 *
 * @param byteStore per-run InlineByteStore from the normalize result
 *   (createInlineByteStore()). `undefined` is tolerated: inline refs then
 *   resolve as missing with a diagnostic, never silently.
 */
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
        // ---- status gate: remote / missing / failed / notFetched never resolve bytes ----
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

        // ---- status 'available': resolve real bytes ----
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

        // Canonical pseudo-available classification: available from metadata
        // alone is not enough. Reuses assetResolution.ts, does not reinvent it.
        const classified = classifyAssetAvailability(asset, bytes !== undefined);
        if (classified.pseudoAvailable) {
            effectiveStatus.set(asset.id, 'missing');
            diag(asset.id, 'warning', 'PSEUDO_AVAILABLE',
                `asset ${asset.id} was marked 'available' but no bytes could be resolved` +
                (fetchNote ? ` (${fetchNote})` : '') + '; treating as missing');
            continue;
        }

        const b = bytes as Uint8Array;

        // ---- byte validation: non-empty, size gate ----
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

        // ---- content-type validation ----
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

        // ---- content addressing ----
        let hash: string;
        try {
            hash = hashBytes(b);
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

/**
 * Validate image-kind bytes against supported Typst-renderable types.
 * Sniffed magic wins over declared metadata; garbage bytes are corrupt;
 * unrenderable types are refused. Emits diagnostics, never throws.
 */
function checkImageContent(
    asset: Asset,
    bytes: Uint8Array,
    diag: (assetId: string, severity: RenderDiagnostic['severity'], code: string, message: string) => void,
): { ok: true; ext: string; mime: string } | { ok: false } {
    const declared = normalizeMime(asset.mimeType);
    const sniffed = sniffImage(bytes);
    if (sniffed) {
        if (declared && declared !== sniffed.mime) {
            diag(asset.id, 'warning', 'ASSET_MIME_MISMATCH',
                `asset ${asset.id} declares '${declared}' but bytes sniff as '${sniffed.mime}'; using the sniffed type`);
        }
        const nameExt = extFromName(asset.name);
        if (nameExt && nameExt !== sniffed.ext) {
            diag(asset.id, 'warning', 'ASSET_EXTENSION_MISMATCH',
                `asset ${asset.id} name suggests '.${nameExt}' but validated content is '${sniffed.mime}'; virtual path uses '.${sniffed.ext}'`);
        }
        return { ok: true, ext: sniffed.ext, mime: sniffed.mime };
    }
    const declaredSupported = declared !== undefined
        && SUPPORTED_IMAGE_TYPES.some((t) => t.mime === declared);
    if (declaredSupported) {
        diag(asset.id, 'warning', 'ASSET_CORRUPT',
            `asset ${asset.id} declares '${declared}' but its bytes do not match ${declared} magic; treating as corrupt, no path assigned`);
    } else {
        diag(asset.id, 'warning', 'ASSET_UNSUPPORTED_MIME',
            `asset ${asset.id} has an unsupported or undetectable image type ` +
            `(declared: '${asset.mimeType ?? 'none'}'); Typst image() cannot render it, no path assigned`);
    }
    return { ok: false };
}
