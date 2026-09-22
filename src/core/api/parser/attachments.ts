import { isInternalChipUrl as canonicalIsInternalChipUrl } from "../../utils/chipUtils.js";

export interface ImageAttachment {
    sourceUrl: string;
    width?: number;
    height?: number;
    size?: number;
    token?: string;
    fileName?: string;
    mimeType?: string;
}

export interface UserFileAttachment {
    sourceUrl: string;
    fileName: string;
    id: string;
    thumbnailUrl?: string;
}

export interface DeepResearchDocMeta {
    id: string;
    title: string;
    chipUrl?: string;
    createdAt?: number;
    contentId?: string;
}

export interface DocLink {
    title: string;
    url: string;
}

export interface DocSectionsResult {
    sections: string[];
    links: DocLink[];
    contentMarkdown: string;
}

export interface GeminiParserAttachmentsModule {
    IMAGE_GEN_RE: RegExp;
    highResVariant: (url?: string | null) => string;
    isInternalChipUrl: (u?: string | null) => boolean;
    extractImageSelectionIndex: (sourceUrl?: string | null) => number | undefined;
    getImageDedupKey: (imageObj: Partial<ImageAttachment>) => string;
    filterNewImages: (images: ImageAttachment[], seenSet: Set<string>) => ImageAttachment[];
    extractImages: (obj: unknown, seqRef?: { value: number }) => ImageAttachment[];
    extractUserFiles: (turnUserArr: unknown) => UserFileAttachment[];
    extractDocumentsMeta: (root: unknown) => DeepResearchDocMeta[];
    findDocContentById: (root: unknown, docId: string) => unknown;
    parseDocSections: (docContentArr: unknown) => DocSectionsResult;
    findDocMarkdownByClues: (root: unknown, metaItem?: DeepResearchDocMeta | null) => string;
    itemMatchesFilename: (name?: string | null) => boolean;
    extractFileNameFromUrl: (url: string) => string | null;
}

import { deepWalk, RESEARCH_PROMPT_PREFIX_RE, GEMINI_JSPB_SCHEMA } from "./extractors.js";

const IMAGE_GEN_RE = /https?:\/\/googleusercontent\.com\/(?:image_generation_content|imagegenerationcontent|generated_image)\/([a-zA-Z0-9_-]+)/i;

    const GOOGLE_MEDIA_HOST_RE = /(^|\.)googleusercontent\.com$|(^|\.)usercontent\.google\.com$|(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$|(^|\.)gstatic\.com$/i;
    function getUrlHost(u: string): string {
        const m = /^https?:\/\/([^/:?#]+)/i.exec(u || "");
        return m ? m[1].toLowerCase() : "";
    }
    function isGoogleMediaHost(u: string): boolean {
        return GOOGLE_MEDIA_HOST_RE.test(getUrlHost(u));
    }

    function warnWhitelistDropOnce(warned: Set<string>, url: string, kind: string): void {
        try {
            let host = getUrlHost(url);
            let key = kind + "|" + host;
            if (warned.has(key)) return;
            warned.add(key);
            if (typeof console !== "undefined" && console.warn) {
                console.warn(`[Gemini Exporter] media URL skipped (host not in whitelist, ${kind}): host=${host} url=${String(url).slice(0, 220)}`);
            }
        } catch (e) { /* ignore */ }
    }

    function extractImageSelectionIndex(sourceUrl?: string | null): number | undefined {
        if (!sourceUrl || typeof sourceUrl !== "string") return undefined;
        let match = sourceUrl.match(IMAGE_GEN_RE);
        if (!match) return undefined;
        if (!/^\d+$/.test(match[1])) return void 0;
        return parseInt(match[1], 10);
    }

    function getImageDedupKey(imageObj: Partial<ImageAttachment>): string {
        return imageObj.sourceUrl || imageObj.token || [imageObj.fileName, imageObj.mimeType, imageObj.width, imageObj.height, imageObj.size].filter(x => x != null && x !== "").join(":");
    }

    function filterNewImages(images: ImageAttachment[], seenSet: Set<string>): ImageAttachment[] {
        return images.filter(img => {
            let key = getImageDedupKey(img);
            if (!key) return true;
            if (seenSet.has(key)) return false;
            seenSet.add(key);
            return true;
        });
    }

    function highResVariant(url?: string | null): string {
        if (!url || typeof url !== "string") return url || "";
        if (url.includes("googleusercontent.com/p/") || url.includes("/places/v1/media")) {
            return url;
        }
        const qIdx = url.indexOf("?");
        const base = qIdx === -1 ? url : url.slice(0, qIdx);
        const query = qIdx === -1 ? "" : url.slice(qIdx);
        const resized = base.replace(/=w\d+(-h\d+)?(-p|-k|-no)?$/i, "=s0").replace(/=s\d+(-p|-k|-no)?$/i, "=s0");
        return resized + query;
    }

    function isInternalChipUrl(u?: string | null): boolean {
        return canonicalIsInternalChipUrl(u);
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

    interface RawImageCandidate {
        sourceUrl: string;
        width?: number;
        height?: number;
        size?: number;
        token?: string;
        rawFileName?: string;
        mimeType?: string;
        detectorKind: string;
    }

    type ImageNodeDetector = (node: any[], schema: typeof GEMINI_JSPB_SCHEMA) => RawImageCandidate | null;

    const detectInlineImageTuple: ImageNodeDetector = (node, schema) => {
        const inl = schema.INLINE_IMAGE;
        const url = node[inl.URL];
        const width = node[inl.WIDTH];
        const height = node[inl.HEIGHT];
        if (
            node.length >= 3 &&
            typeof url === "string" &&
            url.startsWith("http") &&
            typeof width === "number" &&
            typeof height === "number"
        ) {
            return {
                sourceUrl: url,
                width,
                height,
                token: typeof node[inl.TOKEN] === "string" ? node[inl.TOKEN] : void 0,
                detectorKind: "extractImages [url,w,h]"
            };
        }
        return null;
    };

    const detectGeneratedMediaNode: ImageNodeDetector = (node, schema) => {
        const gen = schema.GENERATED_IMAGE;
        const url = node[gen.URL];
        const filename = node[gen.FILENAME];
        const mimeTypeVal = node[gen.MIME_TYPE];
        const dims = node[gen.DIMENSIONS];
        if (
            node.length >= 4 &&
            typeof url === "string" &&
            url.startsWith("http") &&
            (
                (typeof filename === "string" && (/\.(jpe?g|png|webp|gif)$/i.test(filename) || /watermarked_img_/i.test(filename))) ||
                (typeof mimeTypeVal === "string" && mimeTypeVal.startsWith("image/")) ||
                (Array.isArray(dims) && typeof dims[0] === "number" && typeof dims[1] === "number")
            )
        ) {
            const rawFileName = (typeof filename === "string" && filename.trim()) ? filename.trim() : "";
            const width = Array.isArray(dims) && typeof dims[0] === "number" ? dims[0] : void 0;
            const height = Array.isArray(dims) && typeof dims[1] === "number" ? dims[1] : void 0;
            const size = Array.isArray(dims) && typeof dims[2] === "number" ? dims[2] : void 0;
            const mimeType = typeof mimeTypeVal === "string" ? mimeTypeVal : void 0;
            const token = typeof node[gen.TOKEN] === "string" ? node[gen.TOKEN] : void 0;
            return {
                sourceUrl: url,
                width,
                height,
                size,
                token,
                rawFileName,
                mimeType,
                detectorKind: "extractImages generated-media"
            };
        }
        return null;
    };

    const IMAGE_DETECTORS: ImageNodeDetector[] = [
        detectInlineImageTuple,
        detectGeneratedMediaNode
    ];

    function normalizeRawImage(
        raw: RawImageCandidate,
        counter: { value: number }
    ): ImageAttachment {
        let ext = inferExt(raw.sourceUrl);
        const rawFileName = raw.rawFileName || "";
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
            width: raw.width,
            height: raw.height,
            size: raw.size,
            token: raw.token,
            fileName,
            mimeType
        };
    }

    function extractImages(obj: unknown, seqRef?: { value: number }): ImageAttachment[] {
        const images: ImageAttachment[] = [];
        const seenKeys = new Set<string>();
        const warnedHosts = new Set<string>();
        const counter = seqRef && typeof seqRef.value === "number" ? seqRef : { value: 1 };

        deepWalk(obj, (node) => {
            if (!Array.isArray(node)) return;

            for (const detector of IMAGE_DETECTORS) {
                const raw = detector(node, GEMINI_JSPB_SCHEMA);
                if (!raw) continue;

                if (isInternalChipUrl(raw.sourceUrl)) {
                    return;
                }

                if (!isGoogleMediaHost(raw.sourceUrl)) {
                    warnWhitelistDropOnce(warnedHosts, raw.sourceUrl, raw.detectorKind);
                    return;
                }

                const img = normalizeRawImage(raw, counter);
                const key = getImageDedupKey(img);
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    images.push(img);
                }
                return;
            }
        });
        return images;
    }

    function itemMatchesFilename(name?: string | null): boolean {
        if (typeof name !== "string") return false;
        const trimmed = name.trim();
        if (!trimmed) return false;
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return false;
        if (trimmed.startsWith("//") || trimmed.includes("://")) return false;
        if (trimmed.includes("?") || trimmed.includes("&") || trimmed.includes("=")) return false;
        if (trimmed.includes("/") || trimmed.includes("\\")) return false;
        return /\.[a-zA-Z0-9_-]{1,20}$/.test(trimmed);
    }

    function extractFileNameFromUrl(url: string): string | null {
        if (!url || typeof url !== "string") return null;
        try {
            const qIdx = url.indexOf("?");
            if (qIdx !== -1) {
                const query = url.slice(qIdx);
                const m = query.match(/[?&](?:file_?name|name|title)=([^&#]+)/i);
                if (m && m[1]) {
                    try {
                        const decoded = decodeURIComponent(m[1]).trim();
                        if (decoded && !decoded.includes("://") && !decoded.includes("/") && !decoded.includes("\\")) {
                            return decoded;
                        }
                    } catch {
                        const raw = m[1].trim();
                        if (raw && !raw.includes("://") && !raw.includes("/")) return raw;
                    }
                }
            }
            const cleanPath = url.split("?")[0].split("#")[0];
            const lastSlash = cleanPath.lastIndexOf("/");
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
            // 3. Fallback: check any query parameter value ending with a filename
            if (qIdx !== -1) {
                const query = url.slice(qIdx);
                const segments = query.split(/[&;]/);
                for (const seg of segments) {
                    const eqIdx = seg.indexOf("=");
                    if (eqIdx !== -1) {
                        const val = seg.slice(eqIdx + 1);
                        const parts = val.split(/[/\\]/);
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

    function extractUserFiles(turnUserArr: unknown): UserFileAttachment[] {
        let files: UserFileAttachment[] = [];
        if (!Array.isArray(turnUserArr)) return files;
        let warnedHosts = new Set<string>();
        let seenUrls = new Set<string>();

        deepWalk(turnUserArr, (node) => {
            if (!Array.isArray(node)) return;

            // Collect URLs and possible filenames within this node
            const googleUrls: string[] = [];
            const filenames: string[] = [];
            let fallbackId = "";

            for (let i = 0; i < node.length; i++) {
                const item = node[i];
                if (typeof item === "string") {
                    const trimmed = item.trim();
                    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                        if (isGoogleMediaHost(trimmed) && !isInternalChipUrl(trimmed)) {
                            googleUrls.push(trimmed);
                        } else if (!isGoogleMediaHost(trimmed) && !isInternalChipUrl(trimmed)) {
                            warnWhitelistDropOnce(warnedHosts, trimmed, "extractUserFiles [url]");
                        }
                    } else if (itemMatchesFilename(trimmed)) {
                        filenames.push(trimmed);
                    } else if (trimmed && !fallbackId && trimmed.length < 100) {
                        fallbackId = trimmed;
                    }
                }
            }

            if (!googleUrls.length) return;

            // Separate real download URLs from viewer thumbnails
            const downloadUrls = googleUrls.filter(u =>
                u.includes("/download") ||
                u.includes("c=bard_storage") ||
                /[?&](?:file_?name|name)=/i.test(u) ||
                u.includes("contribution.usercontent")
            );
            const thumbUrls = googleUrls.filter(u =>
                u.includes("/viewer/thumb") ||
                u.includes("drive.google.com/viewer")
            );

            // Primary source URL prefers explicit download URL over thumbnail
            let sourceUrl = downloadUrls[0] || googleUrls.find(u => !thumbUrls.includes(u)) || googleUrls[0];
            let thumbnailUrl = thumbUrls[0] || (sourceUrl !== googleUrls[0] ? googleUrls[0] : undefined);

            // Avoid duplicate registrations
            if (seenUrls.has(sourceUrl)) return;
            seenUrls.add(sourceUrl);

            // Determine file name: clean filename from node, or extracted from download URL query param, or fallback
            let fileName = filenames[0] || extractFileNameFromUrl(sourceUrl) || (thumbnailUrl ? extractFileNameFromUrl(thumbnailUrl) : null);
            if (!fileName) {
                // Check if any URL in googleUrls has a filename param
                for (const u of googleUrls) {
                    const fn = extractFileNameFromUrl(u);
                    if (fn) { fileName = fn; break; }
                }
            }
            if (!fileName) {
                fileName = "attachment";
            }

            const id = fallbackId || fileName || sourceUrl;
            files.push({
                sourceUrl,
                fileName,
                id,
                thumbnailUrl
            });
        });
        return files;
    }

    function extractDocumentsMeta(root: unknown): DeepResearchDocMeta[] {
        let out: DeepResearchDocMeta[] = [];
        let uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        const researchPrefixRe = RESEARCH_PROMPT_PREFIX_RE;
        const doc = GEMINI_JSPB_SCHEMA.DEEP_RESEARCH_DOC;

        function pushMeta(metaObj: DeepResearchDocMeta) {
            if (metaObj.id && metaObj.title) {
                let cleanTitle = metaObj.title;
                if (researchPrefixRe.test(cleanTitle)) {
                    cleanTitle = "";
                }
                out.push({
                    id: metaObj.id,
                    title: cleanTitle,
                    chipUrl: metaObj.chipUrl,
                    createdAt: metaObj.createdAt,
                    contentId: metaObj.contentId
                });
            }
        }

        deepWalk([root], (node) => {
            if (Array.isArray(node)) {
                for (let i = 0; i < node.length; i++) {
                    let item = node[i];
                    if (Array.isArray(item) && item.length >= 4 && Array.isArray(item[doc.CHIP_URL]) && item[doc.CHIP_URL].length > 0 && typeof item[doc.CHIP_URL][0] === "string" && item[doc.CHIP_URL][0].includes("immersive_entry_chip") && typeof item[doc.ID] === "string" && typeof item[doc.TITLE] === "string") {
                        let chipUrl = item[doc.CHIP_URL][0],
                            id = item[doc.ID],
                            rawTitle = item[doc.TITLE];
                        let title = researchPrefixRe.test(rawTitle) ? "" : rawTitle;
                        let createdAt: number | undefined;
                        if (Array.isArray(item[doc.TIMESTAMP]) && typeof item[doc.TIMESTAMP][0] === "number") createdAt = 1000 * item[doc.TIMESTAMP][0];
                        let contentId = typeof item[doc.CONTENT_ID] === "string" && item[doc.CONTENT_ID].length > 10 ? item[doc.CONTENT_ID] : void 0;
                        pushMeta({
                            id,
                            title,
                            chipUrl,
                            createdAt,
                            contentId
                        });
                    } else if (Array.isArray(item)) {
                        try {
                            let flat = item.flat(Infinity).filter(x => typeof x === "string");
                            let chip = flat.find(x => x.includes("immersive_entry_chip"));
                            if (chip) {
                                let uuid = flat.find(x => uuidRe.test(x));
                                let title = flat.find(x => !x.includes("http") && !uuidRe.test(x) && x.length > 3 && !x.includes("c_") && !x.includes(".html") && !researchPrefixRe.test(x));
                                pushMeta({
                                    id: uuid || flat.find(x => x.includes("rc_")) || chip,
                                    title: title || "",
                                    chipUrl: chip
                                });
                            }
                        } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:attachments.ts]", e); }
                    }
                }
            }
        });
        return out;
    }

    function findDocContentById(root: unknown, docId: string): unknown {
        if (!docId) return null;
        let targetId = String(docId).replace(/^c_/, "");
        let matched: any = null;

        deepWalk(root, (node) => {
            if (matched) return false;
            if (Array.isArray(node)) {
                let idMatch = false;
                for (let elem of node) {
                    if (typeof elem === "string" && (elem === docId || elem === targetId ||
                        (elem.length < 200 && (elem.includes(docId) || elem.includes(targetId))))) {
                        idMatch = true;
                        break;
                    }
                }
                if (idMatch) {
                    let hasSections = node.some(x => Array.isArray(x) && x.some(y => Array.isArray(y) && typeof y[0] === "string" && y[0].length > 50));
                    let hasLongStr = node.some(x => typeof x === "string" && x.length > 200 && (x.includes("#") || x.includes("\n\n")));
                    if (hasSections || hasLongStr) {
                        matched = node;
                        return false;
                    }
                }
            }
        });
        return matched;
    }

    function parseDocSections(docContentArr: unknown): DocSectionsResult {
        let sections: string[] = [];
        let links: DocLink[] = [];
        let contentMarkdown = "";
        if (!Array.isArray(docContentArr)) return { sections, links, contentMarkdown };

        deepWalk(docContentArr, (node) => {
            if (Array.isArray(node)) {
                if (node.length >= 2 && typeof node[0] === "string" && typeof node[1] === "string" && node[1].startsWith("http")) {
                    links.push({
                        title: node[0],
                        url: node[1]
                    });
                }
                if (node.length >= 1 && typeof node[0] === "string" && node[0].length > 50) {
                    let text = node[0];
                    if (!sections.includes(text)) sections.push(text);
                }
            }
        });
        if (sections.length) {
            contentMarkdown = sections.join("\n\n");
        }
        return {
            sections,
            links,
            contentMarkdown
        };
    }

    function findDocMarkdownByClues(root: unknown, metaItem?: DeepResearchDocMeta | null): string {
        if (!metaItem) return "";
        let candidates: string[] = [];

        deepWalk(root, (node) => {
            if (Array.isArray(node)) {
                for (let elem of node) {
                    if (typeof elem === "string" && elem.length > 200 && (elem.includes("# ") || elem.includes("## ") || elem.includes("\n\n"))) {
                        if (!elem.includes("immersive_entry_chip") && !elem.includes("BardErrorInfo")) {
                            candidates.push(elem);
                        }
                    }
                }
            }
        });
        if (!candidates.length) return "";
        if (metaItem.title) {
            let match = candidates.find(c => c.includes(metaItem.title));
            if (match) return match;
        }
        candidates.sort((a, b) => b.length - a.length);
        return candidates[0] || "";
    }

export {
    IMAGE_GEN_RE,
    highResVariant,
    isInternalChipUrl,
    extractImageSelectionIndex,
    getImageDedupKey,
    filterNewImages,
    extractImages,
    extractUserFiles,
    extractDocumentsMeta,
    findDocContentById,
    parseDocSections,
    findDocMarkdownByClues,
    itemMatchesFilename,
    extractFileNameFromUrl
};

export const GeminiParserAttachments: GeminiParserAttachmentsModule = {
    IMAGE_GEN_RE,
    highResVariant,
    isInternalChipUrl,
    extractImageSelectionIndex,
    getImageDedupKey,
    filterNewImages,
    extractImages,
    extractUserFiles,
    extractDocumentsMeta,
    findDocContentById,
    parseDocSections,
    findDocMarkdownByClues,
    itemMatchesFilename,
    extractFileNameFromUrl
};

if (typeof module === 'object' && module.exports) module.exports = GeminiParserAttachments;

export default GeminiParserAttachments;

