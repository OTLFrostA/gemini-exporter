// gemini_parser.js - Pure parsing engine for Gemini batchexecute RPC responses
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const exports = factory();
        root.GeminiResponseParserClass = exports.GeminiResponseParserClass;
        root.isRealTitle = exports.isRealTitle;
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    const IMAGE_GEN_RE = /https?:\/\/googleusercontent\.com\/(?:image_generation_content|imagegenerationcontent)\/(\d+)/i;
    const RESEARCH_PROMPT_PREFIX_RE = /^(?:我已经完成了研究|我拟定了一个研究方案|I've completed your research|Here is a research plan)/i;

    function isRealTitle(t, fallbackId) {
        if (!t || typeof t !== 'string') return false;
        const s = t.trim();
        if (!s || s === 'Untitled' || s === '未命名' || s === 'New chat' || s === '新对话') return false;
        if (fallbackId && (s === fallbackId || s === 'c_' + fallbackId || fallbackId === 'c_' + s)) return false;
        if (/^[0-9a-f]{16}$/i.test(s) || /^c_[0-9a-f]{16}$/i.test(s)) return false;
        if (RESEARCH_PROMPT_PREFIX_RE.test(s)) return false;
        return true;
    }

    function robustFirstPayload(text) {
        if (!text || typeof text !== "string") return null;
        let lines = text.split("\n");
        let fallback = null;
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (!line.includes("[")) continue;
            let startIdx = line.indexOf("[");
            let candidate = line.slice(startIdx);
            try {
                let cleaned = candidate.replace(/[\x00-\x1F\x7F]/g, "").trim();
                let parsed = JSON.parse(cleaned);
                if (Array.isArray(parsed)) {
                    if (candidate.includes("MaZiqc") || candidate.includes("hNvQHb") || candidate.includes("wrb.fr") || candidate.includes("CNgdBe")) {
                        return parsed;
                    }
                    if (!fallback) fallback = parsed;
                }
            } catch {
                let acc = candidate;
                for (let j = i + 1; j < lines.length; j++) {
                    acc += lines[j];
                    try {
                        let c2 = acc.replace(/[\x00-\x1F\x7F]/g, "").replace(/,\s*null\s*,/g, ",null,").replace(/,\s*\[/g, ",[").replace(/\]\s*,/g, "],").trim();
                        let p2 = JSON.parse(c2);
                        if (Array.isArray(p2)) {
                            if (acc.includes("MaZiqc") || acc.includes("hNvQHb") || acc.includes("wrb.fr") || candidate.includes("CNgdBe")) {
                                return p2;
                            }
                            if (!fallback) fallback = p2;
                        }
                    } catch {}
                }
            }
        }
        return fallback;
    }

    function parseList(text) {
        try {
            let top = robustFirstPayload(text);
            let innerStr = null;
            if (Array.isArray(top)) {
                for (let item of top) {
                    if (Array.isArray(item) && item[0] === "wrb.fr" && item[1] === "MaZiqc" && typeof item[2] === "string") {
                        innerStr = item[2];
                        break;
                    }
                }
                if (!innerStr) {
                    for (let item of top) {
                        if (Array.isArray(item) && typeof item[2] === "string" && (item[2].startsWith("[") || item[2].startsWith('"[') || item[2].includes("c_"))) {
                            innerStr = item[2];
                            break;
                        }
                    }
                }
            }
            if (!innerStr) {
                let bardError = null;
                if (Array.isArray(top)) {
                    for (let item of top) {
                        if (Array.isArray(item) && item[5]) {
                            let str5 = JSON.stringify(item[5]);
                            if (str5.includes("BardErrorInfo")) {
                                bardError = str5;
                                break;
                            }
                        }
                    }
                }
                if (bardError) {
                    console.log("[Gemini Exporter] Google 服务端翻页到达极限 (BardErrorInfo):", bardError);
                } else {
                    console.warn("[Gemini Exporter] parseList: no inner JSON string found. Raw text len:", text?.length);
                }
                return {
                    conversations: [],
                    nextPageToken: null,
                    _debug: {
                        error: bardError ? "BARD_ERROR_INFO" : "NO_INNER_STR",
                        bardError: bardError,
                        textLen: text?.length,
                        rawPreview: text?.slice(0, 500),
                        topParsed: top ? JSON.stringify(top).slice(0, 500) : null
                    }
                };
            }
            let inner = JSON.parse(innerStr);
            let list = Array.isArray(inner[1]) ? inner[1] : (Array.isArray(inner[2]) ? inner[2] : []);
            let convs = [];
            for (let item of list) {
                if (!Array.isArray(item)) continue;
                let id = item[0] || "",
                    title = item[1] || "",
                    createTs = null,
                    updateTs = null,
                    count = 0;
                let createArr = item[3],
                    updateArr = item[2];
                if (Array.isArray(createArr) && typeof createArr[0] === "number") createTs = 1000 * createArr[0] + Math.floor((createArr[1] || 0) / 1e6);
                if (Array.isArray(updateArr) && typeof updateArr[0] === "number") updateTs = 1000 * updateArr[0] + Math.floor((updateArr[1] || 0) / 1e6);
                let fallbackTime = updateTs || createTs || Date.now();
                if (typeof item[4] === "number") count = item[4];
                else if (typeof item[5] === "number") count = item[5];
                if (id) {
                    let cleanId = String(id).replace(/^c_/, '').trim();
                    convs.push({
                        id: cleanId,
                        title: title || cleanId,
                        createdAt: createTs || fallbackTime,
                        updatedAt: updateTs || fallbackTime,
                        chatTime: fallbackTime,
                        timestamp: fallbackTime,
                        messageCount: count,
                        url: `https://gemini.google.com/app/${cleanId}`
                    });
                }
            }
            let nextToken = null;
            if (typeof inner[1] === "string" && inner[1].startsWith("tC")) nextToken = inner[1];
            if (!nextToken && typeof inner[2] === "string" && inner[2].startsWith("tC")) nextToken = inner[2];
            if (!nextToken && typeof inner[3] === "string" && inner[3].startsWith("tC")) nextToken = inner[3];
            if (!nextToken && Array.isArray(inner)) {
                for (let elem of inner) {
                    if (typeof elem === "string" && elem.startsWith("tC")) {
                        nextToken = elem;
                        break;
                    }
                }
            }
            return {
                conversations: convs,
                nextPageToken: nextToken,
                _raw: inner
            };
        } catch (e) {
            console.error("[Gemini Exporter] parseList exception:", e.message, "raw text snippet:", text ? text.slice(0, 300) : "empty");
            throw new Error("列表解析失败: " + e.message);
        }
    }

    function extractTurnTimestamp(turnData) {
        if (!turnData) return null;
        let candidates = [turnData?.[4], turnData?.[5], turnData?.[turnData.length - 1]];
        for (let candidate of candidates) {
            if (Array.isArray(candidate) && typeof candidate[0] === "number" && candidate[0] > 1e9) {
                let val = candidate[0];
                if (val > 1e11) return Math.round(val);
                let timestampSec = val;
                let timestampNano = typeof candidate[1] === "number" ? candidate[1] : 0;
                return 1000 * timestampSec + Math.floor(timestampNano / 1e6);
            }
        }
        return null;
    }

    function extractImageSelectionIndex(sourceUrl) {
        if (!sourceUrl || typeof sourceUrl !== 'string') return;
        let match = sourceUrl.match(IMAGE_GEN_RE);
        if (!match) return;
        let index = parseInt(match[1], 10);
        return isNaN(index) ? void 0 : index;
    }

    function getImageDedupKey(imageObj) {
        return imageObj.sourceUrl || imageObj.token || [imageObj.fileName, imageObj.mimeType, imageObj.width, imageObj.height, imageObj.size].filter(x => x != null && x !== "").join(":");
    }

    function filterNewImages(images, seenSet) {
        return images.filter(img => {
            let key = getImageDedupKey(img);
            if (!key) return true;
            if (seenSet.has(key)) return false;
            seenSet.add(key);
            return true;
        });
    }

    function highResVariant(url) {
        if (!url || typeof url !== "string") return url;
        if (url.includes('googleusercontent.com/p/') || url.includes('/places/v1/media')) {
            return url;
        }
        return url.replace(/=w\d+(-h\d+)?(-p|-k|-no)?.*$/i, "=s0").replace(/=s\d+(-p|-k|-no)?.*$/i, "=s0");
    }

    function isInternalChipUrl(u) {
        if (!u || typeof u !== 'string') return false;
        return /googleusercontent\.com\/(immersive_entry_chip|deep_research|map_content|map_location|grounding_content|web_search|youtube_content|flights_content|hotels_content|workspace_content)/i.test(u);
    }

    function extractImages(obj) {
        let images = [],
            seenKeys = new Set(),
            fallbackCounter = 1;

        function walk(node) {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) {
                if (node.length >= 3 && typeof node[0] === "string" && node[0].startsWith("http") && typeof node[1] === "number" && typeof node[2] === "number") {
                    let sourceUrl = node[0],
                        width = node[1],
                        height = node[2];
                    if (!isInternalChipUrl(sourceUrl)) {
                        let token = typeof node[3] === "string" ? node[3] : void 0;
                        let fileName = `image-${fallbackCounter++}.jpg`;
                        let mimeType = "image/jpeg";
                        let key = getImageDedupKey({
                            sourceUrl,
                            token
                        });
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
                }
                for (let item of node) walk(item);
            } else {
                for (let k in node)
                    if (Object.prototype.hasOwnProperty.call(node, k)) walk(node[k]);
            }
        }
        walk(obj);
        return images;
    }

    function extractUserFiles(turnUserArr) {
        let files = [];
        if (!Array.isArray(turnUserArr)) return files;

        function walk(node) {
            if (!Array.isArray(node)) return;
            for (let item of node) {
                if (Array.isArray(item)) {
                    if (item.length >= 3 && typeof item[0] === 'string' && item[0].startsWith('http') && typeof item[1] === 'string' && item[1].includes('.')) {
                        if (!isInternalChipUrl(item[0])) {
                            files.push({
                                sourceUrl: item[0],
                                fileName: item[1],
                                id: item[2] || item[1]
                            });
                        }
                    } else if (item.length >= 2 && typeof item[0] === 'string' && item[0].startsWith('http') && typeof item[1] === 'string' && (item[0].includes('googleusercontent') || item[0].includes('drive.google'))) {
                        if (!isInternalChipUrl(item[0])) {
                            files.push({
                                sourceUrl: item[0],
                                fileName: item[1] || 'attachment',
                                id: item[0]
                            });
                        }
                    }
                    walk(item);
                }
            }
        }
        walk(turnUserArr);
        return files;
    }

    function extractDocumentsMeta(root) {
        let out = [];
        let uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

        function pushMeta(metaObj) {
            if (metaObj.id && metaObj.title) {
                let cleanTitle = metaObj.title;
                if (RESEARCH_PROMPT_PREFIX_RE.test(cleanTitle)) {
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

        function walk(node) {
            if (!Array.isArray(node)) return;
            for (let i = 0; i < node.length; i++) {
                let item = node[i];
                if (Array.isArray(item) && item.length >= 4 && Array.isArray(item[0]) && item[0].length > 0 && typeof item[0][0] === "string" && item[0][0].includes("immersive_entry_chip") && typeof item[1] === "string" && typeof item[2] === "string" && typeof item[3] === "string") {
                    let chipUrl = item[0][0],
                        id = item[2],
                        rawTitle = item[3];
                    let title = RESEARCH_PROMPT_PREFIX_RE.test(rawTitle) ? "" : rawTitle;
                    let createdAt;
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
                            let title = flat.find(x => !x.includes("http") && !uuidRe.test(x) && x.length > 3 && !x.includes("c_") && !x.includes(".html") && !RESEARCH_PROMPT_PREFIX_RE.test(x));
                            pushMeta({
                                id: uuid || flat.find(x => x.includes("rc_")) || chip,
                                title: title || "",
                                chipUrl: chip
                            });
                        }
                    } catch {}
                    walk(item);
                }
            }
        }
        walk([root]);
        return out;
    }

    function extractConversationId(inner, turns) {
        if (typeof inner[0] === "string" && inner[0].startsWith("c_")) return inner[0];
        if (typeof inner[1] === "string" && inner[1].startsWith("c_")) return inner[1];
        if (Array.isArray(turns)) {
            for (let t of turns) {
                if (Array.isArray(t?.[0]) && typeof t[0][0] === "string" && t[0][0].startsWith("c_")) return t[0][0];
                if (typeof t?.[0] === "string" && t[0].startsWith("c_")) return t[0];
            }
        }
        let flat = JSON.stringify(inner).match(/"c_[0-9a-f]{16}"/);
        if (flat) return flat[0].replace(/"/g, "");
        return "c_unknown";
    }

    function extractConversationTitle(inner, turns) {
        if (typeof inner[2] === "string" && inner[2].length > 0 && inner[2] !== "c_" && !inner[2].startsWith("tC")) return inner[2];
        if (typeof inner[1] === "string" && inner[1].length > 0 && !inner[1].startsWith("c_") && !inner[1].startsWith("tC")) return inner[1];
        if (Array.isArray(turns) && turns[0]) {
            let uText = turns[0]?.[2]?.[0]?.[0];
            if (typeof uText === "string" && uText.trim()) return uText.slice(0, 30).trim();
        }
        return "Untitled Conversation";
    }

    function findDocContentById(root, docId) {
        if (!docId) return null;
        let targetId = String(docId).replace(/^c_/, '');
        let matched = null;

        function walk(node) {
            if (matched || !node || typeof node !== "object") return;
            if (Array.isArray(node)) {
                let idMatch = false;
                for (let elem of node) {
                    if (typeof elem === "string" && (elem === docId || elem === targetId || elem.includes(targetId))) {
                        idMatch = true;
                        break;
                    }
                }
                if (idMatch) {
                    let hasSections = node.some(x => Array.isArray(x) && x.some(y => Array.isArray(y) && typeof y[0] === "string" && y[0].length > 50));
                    let hasLongStr = node.some(x => typeof x === "string" && x.length > 200 && (x.includes("#") || x.includes("\n\n")));
                    if (hasSections || hasLongStr) {
                        matched = node;
                        return;
                    }
                }
                for (let item of node) walk(item);
            }
        }
        walk(root);
        return matched;
    }

    function parseDocSections(docContentArr) {
        let sections = [];
        let links = [];
        let contentMarkdown = "";
        if (!Array.isArray(docContentArr)) return {
            sections,
            links,
            contentMarkdown
        };

        function walk(node) {
            if (!node || typeof node !== "object") return;
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
                for (let item of node) walk(item);
            }
        }
        walk(docContentArr);
        if (sections.length) {
            contentMarkdown = sections.join("\n\n");
        }
        return {
            sections,
            links,
            contentMarkdown
        };
    }

    function findDocMarkdownByClues(root, metaItem) {
        if (!metaItem) return "";
        let candidates = [];

        function walk(node) {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) {
                for (let elem of node) {
                    if (typeof elem === "string" && elem.length > 200 && (elem.includes("# ") || elem.includes("## ") || elem.includes("\n\n"))) {
                        if (!elem.includes("immersive_entry_chip") && !elem.includes("BardErrorInfo")) {
                            candidates.push(elem);
                        }
                    }
                }
                for (let item of node) walk(item);
            }
        }
        walk(root);
        if (!candidates.length) return "";
        if (metaItem.title) {
            let match = candidates.find(c => c.includes(metaItem.title));
            if (match) return match;
        }
        candidates.sort((a, b) => b.length - a.length);
        return candidates[0] || "";
    }

    function extractThoughts(candidateBlock) {
        if (!Array.isArray(candidateBlock)) return null;
        let thoughts = [];

        function walk(node) {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) {
                if (node.length >= 2 && typeof node[0] === "string" && node[0] === "THOUGHT" && typeof node[1] === "string") {
                    thoughts.push(node[1]);
                }
                if (node.length >= 3 && typeof node[1] === "string" && node[1].includes("thought") && typeof node[2] === "string") {
                    thoughts.push(node[2]);
                }
                for (let item of node) walk(item);
            }
        }
        walk(candidateBlock);
        return thoughts.length ? thoughts.join("\n\n") : null;
    }

    function extractCitations(candidateBlock) {
        let citations = [];
        if (!Array.isArray(candidateBlock)) return citations;
        let seenUrls = new Set();

        function walk(node) {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) {
                if (node.length >= 2 && typeof node[0] === "string" && (node[0].startsWith("http://") || node[0].startsWith("https://")) && typeof node[1] === "string") {
                    let url = node[0],
                        title = node[1];
                    if (!seenUrls.has(url) && !url.includes("googleusercontent.com/immersive_entry_chip")) {
                        seenUrls.add(url);
                        citations.push({
                            url,
                            title
                        });
                    }
                }
                for (let item of node) walk(item);
            }
        }
        walk(candidateBlock);
        return citations;
    }

    function parseDetail(text, targetConvId) {
        try {
            let top = robustFirstPayload(text);
            let innerStr = null;
            if (Array.isArray(top)) {
                for (let item of top) {
                    if (Array.isArray(item) && item[0] === "wrb.fr" && item[1] === "hNvQHb" && typeof item[2] === "string") {
                        innerStr = item[2];
                        break;
                    }
                }
                if (!innerStr) {
                    for (let item of top) {
                        if (Array.isArray(item) && typeof item[2] === "string" && (item[2].includes("c_") || item[2].includes("rc_") || item[2].startsWith("[["))) {
                            innerStr = item[2];
                            break;
                        }
                    }
                }
            }
            let inner = null;
            if (innerStr) {
                try {
                    inner = JSON.parse(innerStr);
                } catch {}
            }
            if (!inner && Array.isArray(top)) {
                for (let item of top) {
                    if (typeof item === "string" && item.startsWith("[[")) {
                        try {
                            inner = JSON.parse(item);
                        } catch {}
                    }
                    if (inner) break;
                }
            }
            if (!inner) throw new Error("invalid");
            let turns = inner?.[0] || [];
            let convId = extractConversationId(inner, turns);
            if (convId === "c_unknown" && targetConvId) convId = targetConvId;
            let shortScope = convId ? String(convId).replace(/^c_/, '').slice(-6) + '_' : '';
            let msgs = [];
            let dedupSet = new Set();
            let rev = [...turns].reverse();
            for (let turn of rev) {
                let ts = extractTurnTimestamp(turn) || Date.now();
                let uText = turn?.[2]?.[0]?.[0] || "";
                let uImgs = filterNewImages(extractImages(turn?.[2]), dedupSet);
                let uFiles = extractUserFiles(turn?.[2]);
                if (uText || uImgs.length || uFiles.length) {
                    msgs.push({
                        id: turn?.[0]?.[0] || "",
                        role: "user",
                        content: uText,
                        timestamp: ts,
                        images: uImgs.length ? uImgs.map(i => ({
                            ...i,
                            resolvedUrl: highResVariant(i.sourceUrl),
                            localName: `assets/${shortScope}${(i.fileName || 'img.jpg').replace(/[\\/:*?"<>|]/g, '_')}`,
                            type: "image",
                            isImage: true
                        })) : void 0,
                        documents: uFiles.length ? uFiles.map(f => ({
                            id: f.id,
                            title: f.fileName,
                            fileName: f.fileName,
                            sourceUrl: f.sourceUrl,
                            url: f.sourceUrl,
                            localName: `files/${shortScope}${f.fileName.replace(/[\\/:*?"<>|]/g, '_')}`,
                            type: "file"
                        })) : void 0
                    });
                }
                let assistantBlock = turn?.[3]?.[0];
                if (Array.isArray(assistantBlock) && assistantBlock.length > 0) {
                    let candidateBlock = assistantBlock[0];
                    if (Array.isArray(candidateBlock) && candidateBlock.length > 1) {
                        let candidateId = candidateBlock[0] || "",
                            responseText = candidateBlock[1]?.[0] || "",
                            selectionIndex = extractImageSelectionIndex(responseText),
                            allImages = extractImages(candidateBlock),
                            chosenImages = typeof selectionIndex === "number" && allImages[selectionIndex] ? [allImages[selectionIndex]] : allImages,
                            filteredImages = filterNewImages(chosenImages, dedupSet);
                        let docsMeta = extractDocumentsMeta(candidateBlock);
                        if (!docsMeta.length) docsMeta = extractDocumentsMeta(inner);
                        let seenChip = new Set();
                        let docs = docsMeta.filter(docItem => {
                            let key = docItem.chipUrl || docItem.id;
                            if (seenChip.has(key)) return false;
                            let isRc = /^rc_/.test(docItem.id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docItem.id);
                            let isHttp = docItem.id.includes("immersive_entry_chip") || docItem.id.startsWith("http");
                            if (!isRc && isHttp) return false;
                            seenChip.add(key);
                            return true;
                        });
                        let docDetails = [];
                        if (docs.length) {
                            try {
                                docDetails = docs.map(metaItem => {
                                    let primary = findDocContentById(inner, metaItem.id);
                                    let alt = metaItem.contentId ? findDocContentById(inner, metaItem.contentId) : null;
                                    let parsedPrimary = parseDocSections(primary);
                                    let parsedAlt = alt ? parseDocSections(alt) : {
                                        sections: [],
                                        links: [],
                                        contentMarkdown: void 0
                                    };
                                    let md = parsedPrimary.contentMarkdown || parsedAlt.contentMarkdown || findDocMarkdownByClues(inner, metaItem);

                                    let docTitle = metaItem.title || "";
                                    if (!docTitle || RESEARCH_PROMPT_PREFIX_RE.test(docTitle) || docTitle === "Document") {
                                        if (md) {
                                            let hMatch = md.match(/^#\s+(.+)$/m);
                                            if (hMatch && hMatch[1].trim()) {
                                                docTitle = hMatch[1].trim();
                                            }
                                        }
                                    }
                                    if (!docTitle || RESEARCH_PROMPT_PREFIX_RE.test(docTitle)) {
                                        docTitle = `深度研究报告_${String(metaItem.id || 'doc').replace(/[^a-zA-Z0-9_-]/g, '').slice(-6)}`;
                                    }

                                    if (!md) return null;

                                    return {
                                        id: metaItem.id,
                                        title: docTitle,
                                        createdAt: metaItem.createdAt,
                                        chipUrl: "",
                                        sections: [...parsedPrimary.sections, ...parsedAlt.sections],
                                        links: [...parsedPrimary.links, ...parsedAlt.links],
                                        contentMarkdown: md,
                                        url: "",
                                        localName: `files/${shortScope}${docTitle.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.md`,
                                        type: "file"
                                    };
                                }).filter(Boolean);
                            } catch (er) {
                                console.warn("doc parse err", er);
                            }
                        }
                        let thoughts = extractThoughts(candidateBlock);
                        let citations = extractCitations(candidateBlock);
                        if (responseText) {
                            responseText = responseText.replace(/(?:^|\n)\s*https?:\/\/googleusercontent\.com\/(?:immersive_entry_chip|deep_research_confirmation_content|map_content|map_location_reference|grounding_content|web_search_content|youtube_content|flights_content|hotels_content|workspace_content)(?:\/[^\s\n]*)?\s*(?=\n|$)/gi, '\n');
                            responseText = responseText.replace(/\[([^\]]+)\]\(https?:\/\/googleusercontent\.com\/(?:immersive_entry_chip|deep_research_confirmation_content|map_content|map_location_reference|grounding_content|web_search_content|youtube_content|flights_content|hotels_content|workspace_content)[^\)]*\)/gi, '$1');
                            responseText = responseText.replace(/https?:\/\/googleusercontent\.com\/(?:immersive_entry_chip|deep_research_confirmation_content|map_content|map_location_reference|grounding_content|web_search_content|youtube_content|flights_content|hotels_content|workspace_content)(?:\/[^\s\n\)]*)?/gi, '').trim();
                        }
                        if (responseText || thoughts || filteredImages.length || docDetails.length) {
                            msgs.push({
                                id: candidateId || turn?.[0]?.[0] || "",
                                role: "model",
                                content: responseText || "",
                                thoughts: thoughts || void 0,
                                citations: citations.length ? citations : void 0,
                                timestamp: ts,
                                images: filteredImages.length ? filteredImages.map(img => ({
                                    ...img,
                                    resolvedUrl: highResVariant(img.sourceUrl),
                                    localName: `assets/${shortScope}${(img.fileName || 'img.jpg').replace(/[\\/:*?"<>|]/g, '_')}`,
                                    type: "image"
                                })) : void 0,
                                documents: docDetails.length ? docDetails : void 0
                            });
                        }
                    }
                }
            }
            if (!convId) convId = extractConversationId(inner, turns);
            let title = extractConversationTitle(inner, turns);
            let nextToken = null;
            if (typeof inner[1] === "string" && inner[1].startsWith("tC")) nextToken = inner[1];
            let url = `https://gemini.google.com/app/${String(convId).replace(/^c_/, '')}`;
            let times = turns.map(t => extractTurnTimestamp(t)).filter(x => Number.isFinite(x));
            let minTs = times.length ? Math.min(...times) : Date.now();
            let allMsgs = msgs.map(m => {
                let atts = [];
                if (m.images) {
                    for (let im of m.images) {
                        if (im.resolvedUrl || im.sourceUrl) {
                            atts.push({
                                type: "image",
                                src: im.resolvedUrl || im.sourceUrl,
                                localName: im.localName || `assets/${shortScope}${im.fileName}`,
                                alt: im.fileName,
                                isBlob: false,
                                isImage: true,
                                originalUrl: im.sourceUrl
                            });
                        }
                    }
                }
                if (m.documents) {
                    for (let d of m.documents) {
                        if (d.contentMarkdown || (d.url && !isInternalChipUrl(d.url))) {
                            atts.push({
                                type: "file",
                                name: d.title || d.id,
                                title: d.title,
                                url: d.url || d.sourceUrl,
                                localName: d.localName,
                                contentMarkdown: d.contentMarkdown
                            });
                        }
                    }
                }
                return {
                    ...m,
                    attachments: atts.length ? atts : void 0,
                    attachmentCount: atts.length,
                    messageCount: 1
                };
            });
            return {
                id: convId,
                title,
                messages: allMsgs,
                createdAt: minTs,
                chatTime: minTs,
                timestamp: minTs,
                url,
                nextPageToken: nextToken,
                attachmentCount: allMsgs.reduce((a, m) => a + (m.attachmentCount || 0), 0),
                _raw: inner
            };
        } catch (e) {
            throw new Error("detail parse fail: " + e.message);
        }
    }

    const GeminiResponseParserClass = {
        robustFirstPayload,
        extractTurnTimestamp,
        extractImageSelectionIndex,
        getImageDedupKey,
        filterNewImages,
        highResVariant,
        extractImages,
        extractUserFiles,
        extractDocumentsMeta,
        findDocContentById,
        parseDocSections,
        findDocMarkdownByClues,
        extractThoughts,
        extractCitations,
        extractConversationId,
        extractConversationTitle,
        isRealTitle,
        parseList,
        parseDetail
    };

    return {
        GeminiResponseParserClass,
        isRealTitle
    };
}));
