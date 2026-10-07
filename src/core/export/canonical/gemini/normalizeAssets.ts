import { extractAttachmentInlineBytes } from '../../assets/attachmentBytes.js';
import { normalizeArchiveResourceName } from '../../assets/archivePath.js';
import type { AssetNormalizationInput } from '../assetInput.js';
import type { Asset, AssetKind, AssetStatus } from '../assets.js';
import { decodeDataUrl, buildDataUrlStorageRef, sha256Hex } from '../../assets/index.js';
import type { InlineByteStore } from '../../assets/index.js';
import { classifyAssetAvailability } from '../assetResolution.js';
import type { Diagnostic } from '../../../content/diagnostics.js';
import type { ImageInline } from '../../../content/inline.js';
import type { JsonValue } from '../../../utils/jsonTypes.js';
import type { SourceRef } from '../../../content/sourceRef.js';

export interface AssetLinkIndex {
    byRef: Map<string, string>;
    byBasename: Map<string, Set<string>>;
}

export function newAssetLinkIndex(): AssetLinkIndex {
    return { byRef: new Map(), byBasename: new Map() };
}

export function assetRefKeys(ref: string): string[] {
    const keys = [ref];
    const noPrefix = ref.replace(/^assets\//, '');
    if (noPrefix !== ref) keys.push(noPrefix);
    try {
        const decoded = decodeURIComponent(noPrefix);
        if (decoded !== noPrefix) keys.push(decoded);
    } catch {
    }
    return keys;
}

export function assetBasename(ref: string): string | undefined {
    const noPrefix = ref.replace(/^assets\//, '');
    const base = noPrefix.split('/').pop() ?? '';
    return base && base !== noPrefix ? base : undefined;
}

export function indexAssetRef(index: AssetLinkIndex, ref: string, assetId: string): void {
    for (const key of assetRefKeys(ref)) index.byRef.set(key, assetId);
    const base = assetBasename(ref);
    if (base) {
        let set = index.byBasename.get(base);
        if (!set) {
            set = new Set();
            index.byBasename.set(base, set);
        }
        set.add(assetId);
    }
}

export function dataUrlPreview(url: string): string {
    const head = url.slice(0, 64);
    return url.length > 64 ? `${head}…(${url.length} chars total)` : head;
}

const PENDING_INLINE_REF_PREFIX = 'assets/pending-inline/';

function pendingInlineRef(assetId: string): string {
    return `${PENDING_INLINE_REF_PREFIX}${assetId}`;
}

/**
 * Web Crypto digest step for inline data: URL assets. The synchronous
 * inline-parsing path only decodes bytes; this async pass — owned by the
 * async normalization entry point — computes the SHA-256 digests and swaps
 * the provisional byte-store refs for content-addressed storageRefs.
 */
export async function finalizeInlineAssetDigests(
    assets: readonly Asset[],
    byteStore: InlineByteStore,
): Promise<void> {
    for (const asset of assets) {
        const ref = asset.storageRef;
        if (!ref || !ref.startsWith(PENDING_INLINE_REF_PREFIX)) continue;
        const bytes = byteStore.get(ref);
        if (!bytes) continue;
        const digest = await sha256Hex(bytes);
        const storageRef = buildDataUrlStorageRef(digest, asset.mimeType ?? 'application/octet-stream');
        byteStore.put(storageRef, bytes);
        byteStore.remove(ref);
        asset.sha256 = digest;
        asset.storageRef = storageRef;
    }
}

export interface AssetParserContext {
    diagnostics: Diagnostic[];
    sourceRef: SourceRef;
    assetIndex: AssetLinkIndex;
    inlineAssets: Asset[];
    idPrefix: string;
    byteStore: InlineByteStore;
}

export function makeImageInline(assetId: string, alt: string, title: string | undefined): ImageInline {
    const cleanAlt = alt.trim();
    return {
        type: 'image',
        assetId,
        ...(cleanAlt ? { alt: cleanAlt } : {}),
        ...(title ? { title } : {}),
    };
}

export function linkInlineImage(src: string, alt: string, title: string | undefined, st: AssetParserContext, semanticSource?: string): ImageInline {
    const trimmedSrc = (semanticSource ?? src).trim();
    for (const key of semanticSource !== undefined ? [src] : assetRefKeys(trimmedSrc)) {
        const hit = st.assetIndex.byRef.get(key);
        if (hit) {
            return makeImageInline(hit, alt, title);
        }
    }
    let ambiguous = false;
    const base = assetBasename(trimmedSrc) ?? trimmedSrc;
    if (base && semanticSource === undefined) {
        const candidates = st.assetIndex.byBasename.get(base);
        if (candidates && candidates.size === 1) {
            return makeImageInline([...candidates][0], alt, title);
        }
        if (candidates && candidates.size > 1) {
            ambiguous = true;
            const ids = [...candidates].sort();
            st.diagnostics.push({
                id: `inline-image-ambiguous:${ids.join(',')}`,
                severity: 'warning',
                code: 'AMBIGUOUS_INLINE_IMAGE_ASSET',
                message: `inline image '${trimmedSrc.slice(0, 120)}' basename '${base}' matches ${ids.length} attachments; refusing to bind an arbitrary one`,
                sourceRef: st.sourceRef,
                details: { src: trimmedSrc.slice(0, 200), assetIds: ids } as JsonValue,
            });
        }
    }
    const assetId = `${st.idPrefix}-img${st.inlineAssets.length}`;
    const fileBase = (trimmedSrc.split('/').pop() ?? '').split('?')[0];
    const altName = alt.trim();
    let name = altName || fileBase || 'image';
    let status: AssetStatus;
    let sourceUrl: string | undefined;
    let storageRef: string | undefined;
    let mimeType: string | undefined;
    let sizeBytes: number | undefined;
    let failureReason: string | undefined;
    let dataUrlDiag: { code: 'DATA_URL_TOO_LARGE' | 'DATA_URL_MALFORMED'; message: string } | undefined;
    if (/^data:/i.test(trimmedSrc)) {
        // Omit sourceUrl so the raw data: URI payload is not duplicated in the serialized bundle.
        // Decoding stays synchronous here; the Web Crypto digest is computed by
        // finalizeInlineAssetDigests() once parsing reaches the async normalization layer.
        const decoded = decodeDataUrl(trimmedSrc);
        if (decoded.ok) {
            status = 'available';
            storageRef = pendingInlineRef(assetId);
            mimeType = decoded.mimeType;
            sizeBytes = decoded.sizeBytes;
            name = altName || decoded.suggestedName;
            st.byteStore.put(storageRef, decoded.bytes);
        } else {
            status = 'missing';
            failureReason = decoded.reason;
            dataUrlDiag = { code: decoded.code, message: decoded.message };
            // fileBase contains the base64 payload after 'image/<subType>'; avoid leaking it into name.
            if (!altName) name = 'image';
        }
    } else if (/^https?:\/\//i.test(trimmedSrc)) {
        status = 'remote';
        sourceUrl = trimmedSrc;
    } else if (/^blob:/i.test(trimmedSrc)) {
        status = 'missing';
        failureReason = 'blob: URL is not resolvable outside the originating page';
    } else {
        status = 'missing';
        failureReason = `inline image '${trimmedSrc.slice(0, 120)}' has no matching attachment or resolvable URL`;
    }
    st.inlineAssets.push({
        id: assetId,
        kind: 'image',
        name,
        ...(mimeType ? { mimeType } : {}),
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(storageRef ? { storageRef } : {}),
        status,
        ...(failureReason ? { failureReason } : {}),
    });
    indexAssetRef(st.assetIndex, semanticSource !== undefined ? src : trimmedSrc, assetId);
    if (status === 'missing' && !ambiguous) {
        if (dataUrlDiag) {
            st.diagnostics.push({
                id: `inline-image-dataurl:${assetId}`,
                severity: 'warning',
                code: dataUrlDiag.code,
                message: dataUrlDiag.message,
                sourceRef: st.sourceRef,
                details: { src: dataUrlPreview(trimmedSrc) } as JsonValue,
            });
        } else {
            st.diagnostics.push({
                id: `inline-image-missing:${assetId}`,
                severity: 'warning',
                code: 'INLINE_IMAGE_ASSET_MISSING',
                message: `inline image '${name}' has no resolvable asset; renderers fall back to alt text`,
                sourceRef: st.sourceRef,
                details: { src: trimmedSrc.slice(0, 200) } as JsonValue,
            });
        }
    }
    return makeImageInline(assetId, alt, title);
}

export function attachmentDisplayName(a: AssetNormalizationInput, isImage: boolean): string {
    return a.title || a.name || a.fileName || a.localName?.split('/').pop() || (isImage ? 'image.jpg' : 'file');
}

export function classifyAttachmentKind(a: AssetNormalizationInput): { kind: AssetKind; isImage: boolean; diag?: string } {
    const mime = (a.mimeType || a.mime || '').toLowerCase();
    const name = attachmentDisplayName(a, false);
    const isImage = a.type === 'image' || a.isImage === true ||
        mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i.test(name);
    if (isImage) return { kind: 'image', isImage: true };
    if (a.type === 'audio' || mime.startsWith('audio/')) return { kind: 'audio', isImage: false };
    if (a.type === 'video' || mime.startsWith('video/')) return { kind: 'video', isImage: false };
    if (a.type === 'file' || a.type === 'doc' || a.type === 'code' || mime) return { kind: 'file', isImage: false };
    return {
        kind: 'other',
        isImage: false,
        diag: `unrecognized attachment type '${String(a.type)}'; mapped to kind 'other'`,
    };
}

export function normalizeLocalName(localName: string): string {
    return normalizeArchiveResourceName(localName);
}

export { extractAttachmentInlineBytes } from '../../assets/attachmentBytes.js';

export interface AssetBuild {
    asset: Asset;
    diagnostics: Diagnostic[];
    isImage: boolean;
}

export function buildAsset(
    a: AssetNormalizationInput,
    id: string,
    sourceRef: SourceRef,
    byteStore?: InlineByteStore,
): AssetBuild {
    const diagnostics: Diagnostic[] = [];
    const { kind, isImage, diag } = classifyAttachmentKind(a);
    if (diag) {
        diagnostics.push({
            id: `asset-kind:${id}`,
            severity: 'info',
            code: 'ASSET_KIND_FALLBACK',
            message: diag,
            sourceRef,
            details: { rawType: String(a.type ?? null) } as JsonValue,
        });
    }
    const rawLocal = a.localName || '';
    const localIsUrl = /^https?:\/\//i.test(rawLocal);
    const inlineBytes = extractAttachmentInlineBytes(a);
    const hasInlineBytes = inlineBytes !== null && inlineBytes.byteLength > 0;
    const hasLocalFile = !!rawLocal && !localIsUrl;
    const url = a.resolvedUrl || a.sourceUrl || a.url || a.src || (localIsUrl ? rawLocal : undefined);
    const explicitFailureReason = typeof a.failureReason === 'string' && a.failureReason.trim()
        ? a.failureReason.trim()
        : undefined;

    let status: AssetStatus;
    let storageRef: string | undefined;
    let sourceUrl: string | undefined;
    let failureReason: string | undefined;
    if (hasInlineBytes) {
        status = 'available';
        storageRef = hasLocalFile
            ? normalizeLocalName(rawLocal)
            : (byteStore ? pendingInlineRef(id) : normalizeLocalName(attachmentDisplayName(a, isImage)));
        if (byteStore && storageRef && inlineBytes) {
            byteStore.put(storageRef, inlineBytes);
        }
        if (url) sourceUrl = url;
    } else if (explicitFailureReason) {
        status = 'failed';
        failureReason = explicitFailureReason;
        if (url) sourceUrl = url;
    } else if (hasLocalFile) {
        status = 'available';
        storageRef = normalizeLocalName(rawLocal);
        if (url) sourceUrl = url;
    } else if (url) {
        status = 'remote';
        sourceUrl = url;
        if (localIsUrl) {
            diagnostics.push({
                id: `asset-pseudo-local:${id}`,
                severity: 'info',
                code: 'PSEUDO_LOCAL_URL',
                message: `attachment localName is a remote URL; treating as remote, not local`,
                sourceRef,
                details: { localName: rawLocal } as JsonValue,
            });
        }
    } else {
        status = 'missing';
        failureReason = 'no usable bytes, local file or URL in attachment record';
        diagnostics.push({
            id: `asset-no-source:${id}`,
            severity: 'warning',
            code: 'ATTACHMENT_NO_SOURCE',
            message: `attachment has no usable bytes, local file or URL; marked missing`,
            sourceRef,
            details: { rawType: String(a.type ?? null) } as JsonValue,
        });
    }

    const mimeType = a.mimeType || a.mime || undefined;
    const sizeBytes = typeof a.size === 'number' ? a.size : (inlineBytes ? inlineBytes.byteLength : undefined);
    const asset: Asset = {
        id,
        kind,
        name: attachmentDisplayName(a, isImage),
        ...(mimeType ? { mimeType } : {}),
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        ...(typeof a.width === 'number' && typeof a.height === 'number'
            ? { dimensions: { widthPx: a.width, heightPx: a.height } }
            : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(storageRef ? { storageRef } : {}),
        status,
        ...(failureReason ? { failureReason } : {}),
    };
    const classified = classifyAssetAvailability(asset, hasInlineBytes || (hasLocalFile && !explicitFailureReason));
    if (classified.diagnostic) diagnostics.push(classified.diagnostic);
    return { asset, diagnostics, isImage };
}
