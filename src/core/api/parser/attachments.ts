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
}

import { deepWalk, RESEARCH_PROMPT_PREFIX_RE } from "./extractors.js";

const IMAGE_GEN_RE = /https?:\/\/googleusercontent\.com\/(?:image_generation_content|imagegenerationcontent|generated_image)\/([a-zA-Z0-9_-]+)/i;

    const GOOGLE_MEDIA_HOST_RE = /(^|\.)googleusercontent\.com$|(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$|(^|\.)gstatic\.com$/i;
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

    function extractImages(obj: unknown, seqRef?: { value: number }): ImageAttachment[] {
        let images: ImageAttachment[] = [];
        let seenKeys = new Set<string>();
        let warnedHosts = new Set<string>();
        let counter = seqRef && typeof seqRef.value === "number" ? seqRef : { value: 1 };

        deepWalk(obj, (node) => {
            if (Array.isArray(node)) {
                if (node.length >= 3 && typeof node[0] === "string" && node[0].startsWith("http") && isGoogleMediaHost(node[0]) && typeof node[1] === "number" && typeof node[2] === "number") {
                    let sourceUrl = node[0],
                        width = node[1],
                        height = node[2];
                    if (!isInternalChipUrl(sourceUrl)) {
                        let token = typeof node[3] === "string" ? node[3] : void 0;
                        let ext = inferExt(sourceUrl);
                        let hashFrag = "";
                        try { hashFrag = String(sourceUrl).slice(-8).replace(/[^a-z0-9]/gi, "").slice(0, 4); } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:attachments.ts]", e); }
                        let fileName = `image-${counter.value++}${hashFrag ? "-" + hashFrag : ""}${ext}`;
                        let mimeType = mimeForExt(ext);
                        let key = getImageDedupKey({ sourceUrl, token });
                        if (!seenKeys.has(key)) {
                            seenKeys.add(key);
                            images.push({
                                sourceUrl,
                                width,
                                height,
                                token,
                                fileName,
                                mimeType
                            });
                        }
                    }
                } else if (node.length >= 4 && typeof node[3] === "string" && node[3].startsWith("http") && isGoogleMediaHost(node[3]) && !isInternalChipUrl(node[3]) &&
                    (
                        (typeof node[2] === "string" && (/\.(jpe?g|png|webp|gif)$/i.test(node[2]) || /watermarked_img_/i.test(node[2]))) ||
                        (typeof node[11] === "string" && node[11].startsWith("image/")) ||
                        (Array.isArray(node[15]) && typeof node[15][0] === "number" && typeof node[15][1] === "number")
                    )) {
                    let sourceUrl = node[3];
                    let token = typeof node[5] === "string" ? node[5] : void 0;
                    let ext = inferExt(sourceUrl);
                    let rawFileName = (typeof node[2] === "string" && node[2].trim()) ? node[2].trim() : "";
                    if (rawFileName) {
                        let dotIdx = rawFileName.lastIndexOf(".");
                        if (dotIdx !== -1) ext = rawFileName.slice(dotIdx).toLowerCase();
                    }
                    let width = Array.isArray(node[15]) && typeof node[15][0] === "number" ? node[15][0] : void 0;
                    let height = Array.isArray(node[15]) && typeof node[15][1] === "number" ? node[15][1] : void 0;
                    let size = Array.isArray(node[15]) && typeof node[15][2] === "number" ? node[15][2] : void 0;
                    let mimeType = typeof node[11] === "string" ? node[11] : mimeForExt(ext);

                    let hashFrag = "";
                    try { hashFrag = String(sourceUrl).slice(-8).replace(/[^a-z0-9]/gi, "").slice(0, 4); } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:attachments.ts]", e); }
                    const isGenericRaw = !rawFileName || /^(?:image|img|screenshot|picture|photo|file)(?:\.[a-z0-9]+)?$/i.test(rawFileName);
                    let fileName = isGenericRaw
                        ? `image-${counter.value++}${hashFrag ? "-" + hashFrag : ""}${ext}`
                        : rawFileName;

                    let key = getImageDedupKey({ sourceUrl, token, fileName });
                    if (!seenKeys.has(key)) {
                        seenKeys.add(key);
                        images.push({
                            sourceUrl,
                            width,
                            height,
                            size,
                            token,
                            fileName,
                            mimeType
                        });
                    }
                }
                if (node.length >= 3 && typeof node[0] === "string" && node[0].startsWith("http") && !isGoogleMediaHost(node[0]) && typeof node[1] === "number" && typeof node[2] === "number") {
                    warnWhitelistDropOnce(warnedHosts, node[0], "extractImages [url,w,h]");
                } else if (node.length >= 4 && typeof node[3] === "string" && node[3].startsWith("http") && !isGoogleMediaHost(node[3]) && !isInternalChipUrl(node[3]) &&
                    (
                        (typeof node[2] === "string" && (/\.(jpe?g|png|webp|gif)$/i.test(node[2]) || /watermarked_img_/i.test(node[2]))) ||
                        (typeof node[11] === "string" && node[11].startsWith("image/")) ||
                        (Array.isArray(node[15]) && typeof node[15][0] === "number" && typeof node[15][1] === "number")
                    )) {
                    warnWhitelistDropOnce(warnedHosts, node[3], "extractImages generated-media");
                }
            }
        });
        return images;
    }

    function extractUserFiles(turnUserArr: unknown): UserFileAttachment[] {
        let files: UserFileAttachment[] = [];
        if (!Array.isArray(turnUserArr)) return files;
        let warnedHosts = new Set<string>();

        deepWalk(turnUserArr, (node) => {
            if (Array.isArray(node)) {
                if (node.length >= 3 && typeof node[0] === "string" && node[0].startsWith("http") && isGoogleMediaHost(node[0]) && typeof node[1] === "string" && itemMatchesFilename(node[1])) {
                    if (!isInternalChipUrl(node[0])) {
                        files.push({
                            sourceUrl: node[0],
                            fileName: node[1],
                            id: node[2] || node[1]
                        });
                    }
                } else if (node.length >= 2 && typeof node[0] === "string" && node[0].startsWith("http") && typeof node[1] === "string" && (node[0].includes("googleusercontent") || node[0].includes("drive.google"))) {
                    if (!isInternalChipUrl(node[0])) {
                        files.push({
                            sourceUrl: node[0],
                            fileName: node[1] || "attachment",
                            id: node[0]
                        });
                    }
                }
                if (node.length >= 3 && typeof node[0] === "string" && node[0].startsWith("http") && !isGoogleMediaHost(node[0]) && typeof node[1] === "string" && itemMatchesFilename(node[1])) {
                    warnWhitelistDropOnce(warnedHosts, node[0], "extractUserFiles [url,filename]");
                }
            }
        });
        return files;
    }

    function itemMatchesFilename(name?: string | null): boolean {
        return typeof name === "string" && name.includes(".");
    }

    function extractDocumentsMeta(root: unknown): DeepResearchDocMeta[] {
        let out: DeepResearchDocMeta[] = [];
        let uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        const researchPrefixRe = RESEARCH_PROMPT_PREFIX_RE;

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
                    if (Array.isArray(item) && item.length >= 4 && Array.isArray(item[0]) && item[0].length > 0 && typeof item[0][0] === "string" && item[0][0].includes("immersive_entry_chip") && typeof item[1] === "string" && typeof item[2] === "string" && typeof item[3] === "string") {
                        let chipUrl = item[0][0],
                            id = item[2],
                            rawTitle = item[3];
                        let title = researchPrefixRe.test(rawTitle) ? "" : rawTitle;
                        let createdAt: number | undefined;
                        if (Array.isArray(item[5]) && typeof item[5][0] === "number") createdAt = 1000 * item[5][0];
                        let contentId = typeof item[4] === "string" && item[4].length > 10 ? item[4] : void 0;
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
    findDocMarkdownByClues
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
    findDocMarkdownByClues
};

if (typeof module === 'object' && module.exports) module.exports = GeminiParserAttachments;

export default GeminiParserAttachments;

