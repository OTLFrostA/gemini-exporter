import type { GeminiStructuredDocument, GeminiStructuredNode, ImageAttachment } from './types.js';
export type { ImageAttachment } from './types.js';
import { isInternalChipUrl as canonicalIsInternalChipUrl } from '../../shared/chipUtils.js';
import { isJsonValue, type JsonValue } from '../../../../shared/utils/jsonTypes.js';
import { GEMINI_NODE_TYPES, isWireArray, isWireRecord } from './jspbSchema.js';
import { deepWalk, GEMINI_JSPB_SCHEMA, userTextContainer } from './extractors.js';
import {
    createDocumentReader,
    extractDocumentsMeta,
    parseDocSections,
    type DeepResearchDocMeta,
    type DocLink,
    type GeminiDocumentReader,
} from './deepResearchDocs.js';

export {
    createDocumentReader,
    extractDocumentsMeta,
    parseDocSections,
    type DeepResearchDocMeta,
    type DocLink,
    type GeminiDocumentReader,
};

interface GeminiResponseImageEvidence {
    images: ImageAttachment[];
    /** Body-local images retain their own order and token deduplication. */
    structuredImages: ImageAttachment[];
}

export interface UserFileAttachment {
    sourceUrl: string;
    fileName: string;
    thumbnailUrl?: string;
}

export interface RawImageCandidate {
    evidenceNode?: JsonValue;
    sourceUrl: string;
    width?: number;
    height?: number;
    size?: number;
    token?: string;
    rawFileName?: string;
    title?: string;
    mimeType?: string;
    detectorKind: string;
}

type ImageNodeDetector = (node: unknown, schema: typeof GEMINI_JSPB_SCHEMA) => RawImageCandidate | null;

const GOOGLE_MEDIA_HOST_RE = /(^|\.)googleusercontent\.com$|(^|\.)usercontent\.google\.com$|(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$|(^|\.)gstatic\.com$/i;

function getUrlHost(u: string): string {
    const m = /^https?:\/\/([^/:?#]+)/i.exec(u || '');
    return m ? m[1].toLowerCase() : '';
}

function isGoogleMediaHost(u: string): boolean {
    return GOOGLE_MEDIA_HOST_RE.test(getUrlHost(u));
}

function warnWhitelistDropOnce(warned: Set<string>, url: string, kind: string): void {
    try {
        const host = getUrlHost(url);
        const key = kind + '|' + host;
        if (warned.has(key)) return;
        warned.add(key);
        if (console.warn) {
            console.warn(`[Gemini Exporter] media URL skipped (host not in whitelist, ${kind}): host=${host} url=${String(url).slice(0, 220)}`);
        }
    } catch { /* ignore */ }
}

function getImageDedupKey(imageObj: Partial<ImageAttachment>): string {
    return imageObj.token
        ? `token:${imageObj.token}`
        : (imageObj.sourceUrl || [imageObj.fileName, imageObj.mimeType, imageObj.width, imageObj.height, imageObj.size].filter(x => x != null && x !== '').join(':'));
}

export function filterNewImages(images: ImageAttachment[], seenSet: Set<string>): ImageAttachment[] {
    return images.filter(img => {
        const key = getImageDedupKey(img);
        if (!key) return true;
        if (seenSet.has(key)) return false;
        seenSet.add(key);
        return true;
    });
}

export function isInternalChipUrl(u?: string | null): boolean {
    return canonicalIsInternalChipUrl(u);
}

const detectInlineImageTuple: ImageNodeDetector = (node, schema) => {
    if (!isWireArray(node)) return null;
    const inl = schema.INLINE_IMAGE;
    const url = node[inl.URL];
    const width = node[inl.WIDTH];
    const height = node[inl.HEIGHT];
    if (
        node.length >= 3
        && typeof url === 'string'
        && url.startsWith('http')
        && typeof width === 'number'
        && typeof height === 'number'
    ) {
        const rawToken = node[inl.TOKEN];
        return {
            sourceUrl: url,
            width,
            height,
            token: typeof rawToken === 'string' ? rawToken : undefined,
            detectorKind: 'extractImages [url,w,h]',
        };
    }
    return null;
};

const detectGeneratedMediaNode: ImageNodeDetector = (node, schema) => {
    if (!isWireArray(node)) return null;
    const gen = schema.GENERATED_IMAGE;
    const url = node[gen.URL];
    const filename = node[gen.FILENAME];
    const mimeTypeVal = node[gen.MIME_TYPE];
    const dims = node[gen.DIMENSIONS];
    if (
        node.length >= 4
        && typeof url === 'string'
        && url.startsWith('http')
        && (
            (typeof filename === 'string' && (/\.(jpe?g|png|webp|gif)$/i.test(filename) || /watermarked_img_/i.test(filename)))
            || (typeof mimeTypeVal === 'string' && mimeTypeVal.startsWith('image/'))
            || (isWireArray(dims) && typeof dims[0] === 'number' && typeof dims[1] === 'number')
        )
    ) {
        // Derivative upscale renditions (e.g. 2x with UPSCALE_FACTOR > 1) are secondary variants,
        // not the authoritative source generation.
        const upscaleFactor = node[gen.UPSCALE_FACTOR];
        if (typeof upscaleFactor === 'number' && upscaleFactor > 1) {
            return null;
        }
        const rawFileName = typeof filename === 'string' && filename.trim() ? filename.trim() : '';
        const rawDims = isWireArray(dims) ? dims : null;
        const width = rawDims !== null && typeof rawDims[0] === 'number' ? rawDims[0] : undefined;
        const height = rawDims !== null && typeof rawDims[1] === 'number' ? rawDims[1] : undefined;
        const size = rawDims !== null && typeof rawDims[2] === 'number' ? rawDims[2] : undefined;
        const mimeType = typeof mimeTypeVal === 'string' ? mimeTypeVal : undefined;
        const rawToken = node[gen.TOKEN];
        const token = typeof rawToken === 'string' ? rawToken : undefined;
        return {
            sourceUrl: url,
            width,
            height,
            size,
            token,
            rawFileName,
            mimeType,
            detectorKind: 'extractImages generated-media',
        };
    }
    return null;
};

const detectAttachmentType36: ImageNodeDetector = node => {
    if (isWireRecord(node)) {
        if (node.attachmentType !== 36) return null;
        const kc = typeof node.Kc === 'string' ? node.Kc : undefined;
        const ze = typeof node.Ze === 'string' ? node.Ze : (typeof node.NHc === 'string' ? node.NHc : undefined);
        const imgUrl = typeof node.imageUrl === 'string' ? node.imageUrl : undefined;
        const title = typeof node.title === 'string' ? node.title.trim() : undefined;
        const width = typeof node.imageWidth === 'number' ? node.imageWidth : undefined;
        const height = typeof node.imageHeight === 'number' ? node.imageHeight : undefined;

        const sourceUrl = (kc && isGoogleMediaHost(kc))
            ? kc
            : ((ze && isGoogleMediaHost(ze))
                ? ze
                : ((imgUrl && isGoogleMediaHost(imgUrl))
                    ? imgUrl
                    : (kc || ze || imgUrl || '')));

        if (!sourceUrl || !sourceUrl.startsWith('http')) return null;

        return {
            sourceUrl,
            width,
            height,
            title,
            detectorKind: 'extractImages attachmentType:36',
        };
    }

    if (isWireArray(node) && node.length >= 8) {
        const slot0 = node[0];
        const slot3 = node[3];
        const slot7 = node[7];
        const gstaticTuple = isWireArray(slot3) && slot3.length >= 4
            ? slot3
            : (isWireArray(slot0) && slot0.length >= 4 ? slot0 : null);
        const rawImageTuple = gstaticTuple?.[0];
        const imageTuple = isWireArray(rawImageTuple) ? rawImageTuple : null;
        const rawUrl = imageTuple?.[0];
        if (typeof rawUrl === 'string') {
            const rawWidth = gstaticTuple?.[2];
            const rawHeight = gstaticTuple?.[3];
            const width = typeof rawWidth === 'number' ? rawWidth : undefined;
            const height = typeof rawHeight === 'number' ? rawHeight : undefined;

            let title: string | undefined;
            let fallbackGoogleUrl: string | undefined;
            const fallbackTuple = isWireArray(slot7) ? slot7 : null;
            const fallbackUrl = fallbackTuple?.[0];
            if (typeof fallbackUrl === 'string') {
                fallbackGoogleUrl = fallbackUrl;
                const fallbackTitle = fallbackTuple?.[2];
                if (typeof fallbackTitle === 'string' && fallbackTitle.trim()) {
                    title = fallbackTitle.trim();
                }
            }

            const sourceUrl = isGoogleMediaHost(rawUrl)
                ? rawUrl
                : (fallbackGoogleUrl && isGoogleMediaHost(fallbackGoogleUrl) ? fallbackGoogleUrl : rawUrl);

            if (!sourceUrl || !sourceUrl.startsWith('http')) return null;

            return {
                sourceUrl,
                width,
                height,
                title,
                detectorKind: 'extractImages attachmentType:36',
            };
        }
    }
    return null;
};

const IMAGE_DETECTORS: readonly ImageNodeDetector[] = [
    detectGeneratedMediaNode,
    detectInlineImageTuple,
    detectAttachmentType36,
];

function sourceImage(raw: RawImageCandidate): ImageAttachment {
    return {
        sourceUrl: raw.sourceUrl,
        sourceEvidence: { detectorKind: raw.detectorKind, node: raw.evidenceNode ?? null },
        width: raw.width,
        height: raw.height,
        size: raw.size,
        token: raw.token,
        ...(raw.rawFileName ? { fileName: raw.rawFileName } : {}),
        ...(raw.title ? { title: raw.title } : {}),
        ...(raw.mimeType ? { mimeType: raw.mimeType } : {}),
        ...(raw.detectorKind === 'extractImages generated-media' ? { isGenerated: true } : {}),
    };
}

/** One response may expose the same wire tuple through body and metadata
 * roots. Reuse its decoded evidence while each list keeps its own order,
 * token preference and visibility rules. The reader lives for one extraction. */
function createImageEvidenceReader(normalize: (raw: RawImageCandidate) => ImageAttachment = sourceImage): (node: object) => ImageAttachment | null {
    const evidence = new WeakMap<object, ImageAttachment | null>();
    const warnedHosts = new Set<string>();
    return node => {
        if (evidence.has(node)) return evidence.get(node) ?? null;
        evidence.set(node, null);
        for (const detector of IMAGE_DETECTORS) {
            const raw = detector(node, GEMINI_JSPB_SCHEMA);
            if (!raw) continue;
            if (isInternalChipUrl(raw.sourceUrl)) return null;
            if (!isGoogleMediaHost(raw.sourceUrl)) {
                warnWhitelistDropOnce(warnedHosts, raw.sourceUrl, raw.detectorKind);
                return null;
            }
            const evidenceJson = JSON.stringify(node);
            const snapshot: unknown = evidenceJson.length <= 12000
                ? JSON.parse(evidenceJson) : { truncated: true, preview: evidenceJson.slice(0, 12000) };
            if (isJsonValue(snapshot)) raw.evidenceNode = snapshot;
            const image = normalize(raw);
            evidence.set(node, image);
            return image;
        }
        return null;
    };
}

export function collectImages(
    obj: unknown,
    normalize: (raw: RawImageCandidate) => ImageAttachment = sourceImage,
    readEvidence = createImageEvidenceReader(normalize),
    decoded: Iterable<ImageAttachment> = [],
): ImageAttachment[] {
    const images: ImageAttachment[] = [];
    const seenKeys = new Set<string>();

    const addImage = (img: ImageAttachment): void => {
        if (img.token) {
            const existingIdx = images.findIndex(existing => existing.token === img.token);
            if (existingIdx !== -1) {
                if (img.isGenerated && !images[existingIdx].isGenerated) {
                    seenKeys.delete(getImageDedupKey(images[existingIdx]));
                    seenKeys.add(getImageDedupKey(img));
                    images[existingIdx] = img;
                }
                return;
            }
        }

        const key = getImageDedupKey(img);
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            images.push(img);
        }
    };

    deepWalk(obj, node => {
        const image = readEvidence(node);
        if (image) addImage(image);
    });
    for (const image of decoded) addImage(image);
    return images;
}

export function extractImageEvidence(obj: unknown): ImageAttachment[] {
    return collectImages(obj);
}

function* structuredImageEvidence(nodes: readonly GeminiStructuredNode[]): Generator<ImageAttachment> {
    for (const node of nodes) {
        switch (node.nodeType) {
            case GEMINI_NODE_TYPES.ATTACHMENT:
                yield* node.images ?? [];
                break;
            case 'paragraph':
            case 'fragment':
            case GEMINI_NODE_TYPES.BLOCKQUOTE:
                yield* structuredImageEvidence(node.children);
                break;
            case GEMINI_NODE_TYPES.ORDERED_LIST:
            case GEMINI_NODE_TYPES.UNORDERED_LIST:
                for (const item of node.items) yield* structuredImageEvidence(item.children);
                break;
            case GEMINI_NODE_TYPES.TABLE:
                for (const row of node.rows) for (const cell of row.cells) yield* structuredImageEvidence(cell.children);
                break;
        }
    }
}

export function extractResponseImageEvidence(
    candidate: readonly unknown[],
    visibleMedia: readonly unknown[],
    text: string,
    structuredContent?: GeminiStructuredDocument,
): GeminiResponseImageEvidence {
    const readEvidence = createImageEvidenceReader();
    const structuredImages = collectImages(undefined, sourceImage, readEvidence, structuredImageEvidence(structuredContent?.children ?? []));
    const visibleImages = collectImages(visibleMedia, sourceImage, readEvidence, structuredImages);
    const visibleKeys = new Set(visibleImages.map(getImageDedupKey));
    const inlineUrls = new Set<string>();
    for (const match of text.matchAll(/!\[[^\]]*\]\(<?(https?:\/\/[^\s)>]+)>?(?:\s+[^)]*)?\)|<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/gi)) {
        inlineUrls.add(match[1] || match[2]);
    }
    // Reuse already collected `visibleImages` instead of re-walking `visibleMedia` a second time.
    const images = collectImages(candidate, sourceImage, readEvidence, visibleImages).filter(image => {
        if (image.sourceEvidence?.detectorKind !== 'extractImages attachmentType:36') return true;
        return visibleKeys.has(getImageDedupKey(image)) || inlineUrls.has(image.sourceUrl);
    });
    return { images, structuredImages };
}

export function itemMatchesFilename(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return false;
    if (trimmed.startsWith('//') || trimmed.includes('://')) return false;
    if (trimmed.includes('?') || trimmed.includes('&') || trimmed.includes('=')) return false;
    if (trimmed.includes('/') || trimmed.includes('\\')) return false;
    return /\.[a-zA-Z0-9_-]{1,20}$/.test(trimmed);
}

export function extractFileNameFromUrl(url: string): string | null {
    if (!url) return null;
    try {
        const qIdx = url.indexOf('?');
        if (qIdx !== -1) {
            const query = url.slice(qIdx);
            const m = query.match(/[?&](?:file_?name|name|title)=([^&#]+)/i);
            if (m && m[1]) {
                try {
                    const decoded = decodeURIComponent(m[1]).trim();
                    if (decoded && !decoded.includes('://') && !decoded.includes('/') && !decoded.includes('\\')) {
                        return decoded;
                    }
                } catch {
                    const raw = m[1].trim();
                    if (raw && !raw.includes('://') && !raw.includes('/')) return raw;
                }
            }
        }
        const cleanPath = url.split('?')[0].split('#')[0];
        const lastSlash = cleanPath.lastIndexOf('/');
        if (lastSlash !== -1) {
            const candidate = cleanPath.slice(lastSlash + 1);
            if (candidate && itemMatchesFilename(candidate)) {
                try {
                    return decodeURIComponent(candidate);
                } catch {
                    return candidate;
                }
            }
        }
        if (qIdx !== -1) {
            const segments = url.slice(qIdx).split(/[&;]/);
            for (const seg of segments) {
                const eqIdx = seg.indexOf('=');
                if (eqIdx !== -1) {
                    const parts = seg.slice(eqIdx + 1).split(/[/\\]/);
                    const lastPart = parts[parts.length - 1];
                    try {
                        const dec = decodeURIComponent(lastPart).trim();
                        if (dec && itemMatchesFilename(dec)) return dec;
                    } catch {
                        if (lastPart && itemMatchesFilename(lastPart)) return lastPart;
                    }
                }
            }
        }
    } catch { /* ignore */ }
    return null;
}

export function extractUserFiles(turnUserArr: unknown): UserFileAttachment[] {
    const files: UserFileAttachment[] = [];
    if (!isWireArray(turnUserArr)) return files;
    const warnedHosts = new Set<string>();
    const seenUrls = new Set<string>();
    const prompt = userTextContainer(turnUserArr);

    deepWalk(turnUserArr, node => {
        if (!isWireArray(node)) return;
        // Valid inline or generated image tuples belong to `extractImageEvidence` and must
        // not duplicate into phantom `attachment` file records.
        if (detectInlineImageTuple(node, GEMINI_JSPB_SCHEMA) !== null
            || detectGeneratedMediaNode(node, GEMINI_JSPB_SCHEMA) !== null) {
            return;
        }

        const googleUrls: string[] = [];
        const filenames: string[] = [];

        // A URL in the prompt text slot is not upload evidence.
        for (let i = node === prompt ? 1 : 0; i < node.length; i++) {
            const item = node[i];
            if (typeof item !== 'string') continue;
            const trimmed = item.trim();
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                if (/\s/.test(trimmed) || /^https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\//i.test(trimmed)) continue;
                if (isGoogleMediaHost(trimmed) && !isInternalChipUrl(trimmed)) {
                    googleUrls.push(trimmed);
                } else if (!isGoogleMediaHost(trimmed) && !isInternalChipUrl(trimmed)) {
                    warnWhitelistDropOnce(warnedHosts, trimmed, 'extractUserFiles [url]');
                }
            } else if (itemMatchesFilename(trimmed)) {
                filenames.push(trimmed);
            }
        }

        if (!googleUrls.length) return;

        const downloadUrls = googleUrls.filter(u =>
            u.includes('/download')
            || u.includes('c=bard_storage')
            || /[?&](?:file_?name|name)=/i.test(u)
            || u.includes('contribution.usercontent'));
        const thumbUrls = googleUrls.filter(u =>
            u.includes('/viewer/thumb')
            || u.includes('drive.google.com/viewer'));

        const sourceUrl = downloadUrls[0] || googleUrls.find(u => !thumbUrls.includes(u)) || googleUrls[0];
        const thumbnailUrl = thumbUrls[0] || (sourceUrl !== googleUrls[0] ? googleUrls[0] : undefined);

        if (seenUrls.has(sourceUrl)) return;
        seenUrls.add(sourceUrl);

        let fileName = filenames[0] || extractFileNameFromUrl(sourceUrl) || (thumbnailUrl ? extractFileNameFromUrl(thumbnailUrl) : null);
        if (!fileName) {
            for (const u of googleUrls) {
                const fn = extractFileNameFromUrl(u);
                if (fn) { fileName = fn; break; }
            }
        }
        if (!fileName) fileName = 'attachment';

        files.push({
            sourceUrl,
            fileName,
            thumbnailUrl,
        });
    });
    return files;
}
