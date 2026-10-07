import * as source from '../../parsers/gemini/rpc/sourceAttachments.js';
import type { RawImageCandidate, ImageAttachment, UserFileAttachment, DeepResearchDocMeta, DocSectionsResult } from '../../parsers/gemini/rpc/sourceAttachments.js';
export * from '../../parsers/gemini/rpc/sourceAttachments.js';
export interface GeminiParserAttachmentsModule {
    IMAGE_GEN_RE: RegExp;
    highResVariant: (url?: string | null) => string;
    isInternalChipUrl: (u?: string | null) => boolean;
    extractImageSelectionIndex: (sourceUrl?: string | null) => number | undefined;
    getImageDedupKey: (imageObj: Partial<ImageAttachment>) => string;
    filterNewImages: (images: ImageAttachment[], seenSet: Set<string>) => ImageAttachment[];
    extractImageEvidence: (obj: unknown, seqRef?: { value: number }) => ImageAttachment[];
    extractResponseImageEvidence: (candidate: unknown, visibleMedia: unknown, text: string, seqRef?: { value: number }) => ImageAttachment[];
    extractImages: (obj: unknown, seqRef?: { value: number }) => ImageAttachment[];
    extractResponseImages: (candidate: unknown, visibleMedia: unknown, text: string, seqRef?: { value: number }) => ImageAttachment[];
    extractUserFiles: (turnUserArr: unknown) => UserFileAttachment[];
    extractDocumentsMeta: (root: unknown) => DeepResearchDocMeta[];
    findDocContentById: (root: unknown, docId: string) => unknown;
    parseDocSections: (docContentArr: unknown) => DocSectionsResult;
    findDocMarkdownByClues: (root: unknown, metaItem?: DeepResearchDocMeta | null) => string;
    itemMatchesFilename: (name?: string | null) => boolean;
    extractFileNameFromUrl: (url: string) => string | null;
}

    function highResVariant(url?: string | null): string {
        if (!url || typeof url !== "string") return url || "";
        if (url.includes("googleusercontent.com/p/") || url.includes("/places/v1/media")) {
            return url;
        }
        const qIdx = url.indexOf("?");
        const base = qIdx === -1 ? url : url.slice(0, qIdx);
        const query = qIdx === -1 ? "" : url.slice(qIdx);
        let resized = base.replace(/=[sw]\d+(?:-[a-z0-9]+)*$/i, "=s0");
        if ((base.includes("/gg/") || base.includes("/rd-gg/")) && !/=[sw]\d+/i.test(base) && !base.endsWith("=s0")) {
            resized = base + "=s0";
        }
        return resized + query;
    }

    const IMAGE_EXT_MIME: Record<string, string> = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
        ".bmp": "image/bmp", ".svg": "image/svg+xml", ".avif": "image/avif",
        ".tif": "image/tiff", ".tiff": "image/tiff", ".ico": "image/x-icon",
        ".heic": "image/heic", ".heif": "image/heif"
    };
    function mimeForExt(ext: string): string {
        return IMAGE_EXT_MIME[ext] || "image/jpeg";
    }

    function inferExt(url: string): string {
        try {
            let u = String(url).split("?")[0].split("#")[0];
            let m = u.match(/\.([a-z0-9]{2,5})$/i);
            if (m) {
                let ext = "." + m[1].toLowerCase();
                if (ext === ".jpeg") ext = ".jpg";
                if (IMAGE_EXT_MIME[ext]) return ext;
            }
        } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:attachments.ts]", e); }
        return ".jpg";
    }

    function normalizeRawImage(
        raw: RawImageCandidate,
        counter: { value: number }
    ): ImageAttachment {
        let ext = inferExt(raw.sourceUrl);
        const rawFileName = raw.rawFileName || (raw.title ? `${raw.title}.png` : "");
        if (rawFileName) {
            const dotIdx = rawFileName.lastIndexOf(".");
            if (dotIdx !== -1) ext = rawFileName.slice(dotIdx).toLowerCase();
        }
        const mimeType = raw.mimeType || mimeForExt(ext);
        let hashFrag = "";
        try {
            hashFrag = String(raw.sourceUrl).slice(-8).replace(/[^a-z0-9]/gi, "").slice(0, 4);
        } catch (e) {
            if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:attachments.ts]", e);
        }
        const isGenericRaw = !rawFileName || /^(?:image|img|screenshot|picture|photo|file)(?:\.[a-z0-9]+)?$/i.test(rawFileName);
        const fileName = isGenericRaw
            ? `image-${counter.value++}${hashFrag ? "-" + hashFrag : ""}${ext}`
            : rawFileName;

        return {
            sourceUrl: raw.sourceUrl,
            sourceEvidence: { detectorKind: raw.detectorKind, node: raw.evidenceNode ?? null },
            width: raw.width,
            height: raw.height,
            size: raw.size,
            token: raw.token,
            fileName,
            mimeType,
            ...(raw.detectorKind === "extractImages generated-media" ? { isGenerated: true } : {})
        };
    }


export function extractImages(obj: unknown, seqRef?: { value: number }): ImageAttachment[] {
    return source.collectImages(obj, seqRef, normalizeRawImage);
}
export function extractResponseImages(candidate: unknown, visibleMedia: unknown, text: string, seqRef?: { value: number }): ImageAttachment[] {
    return source.responseImages(candidate, visibleMedia, text, seqRef, extractImages);
}
export { highResVariant };
export const GeminiParserAttachments: GeminiParserAttachmentsModule = { ...source, highResVariant, extractImages, extractResponseImages };
if (typeof module === 'object' && module.exports) module.exports = GeminiParserAttachments;
export default GeminiParserAttachments;
