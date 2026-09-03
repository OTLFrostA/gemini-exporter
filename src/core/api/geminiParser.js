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
        root.GEMINI_JSPB_SCHEMA = exports.GEMINI_JSPB_SCHEMA;
        root.detectTurnSchemaDrift = exports.detectTurnSchemaDrift;
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    /**
     * Declarative Schema Specification for Google Gemini JSPB (JavaScript Protocol Buffers)
     * Maps conceptual protobuf message fields directly to array index offsets.
     */
    const GEMINI_JSPB_SCHEMA = Object.freeze({
        TURN: {
            ID_META: 0,        // ["c_xxx", "r_xxx"]
            TIMESTAMP: 1,      // [seconds, nanos]
            USER_PAYLOAD: 2,   // User input block
            MODEL_PAYLOAD: 3   // Model payload container
        },
        MODEL_PAYLOAD: {
            CANDIDATES: 0,      // repeated Candidate: AI answer drafts
            SEARCH_QUERIES: 1,  // repeated SearchQuery: Grounding search keywords
            PROVIDER: 2,        // string: Grounding provider name ("google")
            TELEMETRY_START: 3  // Internal routing/status codes ("c", "S", 6, 6, ".")
        },
        CANDIDATE: {
            ID: 0,             // "rc_xxxx"
            BODY: 1,           // Candidate content structure
            LANGUAGE_CODE: 2   // e.g. "zh", "en"
        },
        CANDIDATE_BODY: {
            PARTS: 0           // Array of content parts: [ [textChunk, ...], null, ... ]
        }
    });

    /**
     * Validates turn structure against GEMINI_JSPB_SCHEMA and flags protocol drifts
     * @param {Array} turn - Raw turn array from batchexecute response
     * @param {string} [convId] - Optional conversation id for diagnostic logging
     * @returns {{ isDrifted: boolean, warnings: string[] }}
     */
    function detectTurnSchemaDrift(turn, convId) {
        const warnings = [];
        if (!Array.isArray(turn)) {
            warnings.push("Turn is not an array");
            return { isDrifted: true, warnings };
        }
        if (turn.length < 3) {
            warnings.push(`Turn array length (${turn.length}) is less than expected minimum 3`);
        }
        const head = turn[GEMINI_JSPB_SCHEMA.TURN.ID_META];
        let idStr = '';
        if (typeof head === 'string') idStr = head;
        else if (Array.isArray(head) && head.length) {
            idStr = typeof head[0] === 'string' ? head[0] : (Array.isArray(head[0]) && typeof head[0][0] === 'string' ? head[0][0] : '');
        }
        if (!idStr || (!idStr.startsWith('c_') && !idStr.startsWith('r_'))) {
            warnings.push(`Turn ID meta at index 0 does not match expected pattern: ${JSON.stringify(head)?.slice(0, 30)}`);
        }

        const modelPayload = turn[GEMINI_JSPB_SCHEMA.TURN.MODEL_PAYLOAD];
        if (modelPayload !== undefined) {
            if (!Array.isArray(modelPayload)) {
                warnings.push(`ModelPayload at index 3 is not an array (type: ${typeof modelPayload})`);
            } else if (modelPayload.length > 0) {
                const candBlock = modelPayload[GEMINI_JSPB_SCHEMA.MODEL_PAYLOAD.CANDIDATES];
                if (!Array.isArray(candBlock)) {
                    warnings.push(`Candidates at index 3[0] is not an array (type: ${typeof candBlock})`);
                } else if (candBlock.length > 0) {
                    const firstCand = candBlock[0];
                    if (Array.isArray(firstCand)) {
                        const candId = firstCand[GEMINI_JSPB_SCHEMA.CANDIDATE.ID];
                        if (typeof candId !== 'string' || (!candId.startsWith('rc_') && !candId.startsWith('c_'))) {
                            warnings.push(`First candidate ID at 3[0][0][0] does not match 'rc_' prefix: ${JSON.stringify(candId)}`);
                        }
                    }
                }
            }
        }

        if (warnings.length > 0) {
            const isDev = (typeof globalThis !== 'undefined' && (globalThis.__gemExporterDevMode || globalThis.__gemExporterVerboseLog))
                || (typeof window !== 'undefined' && (window.__gemExporterDevMode || window.__gemExporterVerboseLog));
            if (isDev) {
                console.warn(`[Gemini Exporter][Schema Drift Warning] Detected ${warnings.length} schema drift(s) in conv ${convId || 'unknown'}:`, warnings);
            }
        }

        return {
            isDrifted: warnings.length > 0,
            warnings
        };
    }

    /**
     * Safely extracts candidates array from turn according to schema
     * @param {Array} turn
     * @returns {Array} List of candidate arrays
     */
    function extractModelCandidates(turn) {
        if (!turn || !Array.isArray(turn)) return [];
        const modelPayload = turn[GEMINI_JSPB_SCHEMA.TURN.MODEL_PAYLOAD];
        if (!modelPayload || !Array.isArray(modelPayload) || modelPayload.length === 0) return [];

        const candidateBlock = modelPayload[GEMINI_JSPB_SCHEMA.MODEL_PAYLOAD.CANDIDATES];
        if (Array.isArray(candidateBlock)) {
            // Case 1 (Standard Protobuf): modelPayload[0] is array of candidates [cand0, cand1, ...]
            if (candidateBlock.length > 0 && Array.isArray(candidateBlock[0])) {
                return candidateBlock;
            }
            // Case 2 (Single candidate wrapped directly):
            if (typeof candidateBlock[0] === 'string') {
                return [candidateBlock];
            }
        }
        // Fallback: If turn[3] was a flat candidates array directly (legacy test compatibility)
        if (Array.isArray(modelPayload[0]) && typeof modelPayload[0][0] === 'string' && modelPayload[0][0].startsWith('rc_')) {
            return modelPayload;
        }
        return [];
    }

    /**
     * Cleanly extracts candidate response text without language tag (e.g. "zh") pollution
     * @param {Array} cand
     * @returns {string}
     */
    function extractCandidateText(cand) {
        if (!cand) return "";
        const body = cand?.[GEMINI_JSPB_SCHEMA.CANDIDATE.BODY] !== undefined
            ? cand[GEMINI_JSPB_SCHEMA.CANDIDATE.BODY]
            : (Array.isArray(cand) && cand.length === 1 ? cand[0] : cand);

        if (typeof body === "string") return body;
        if (!Array.isArray(body)) return "";

        // Candidate body: typically [ partsArray, languageCode, ... ]
        const parts = body[GEMINI_JSPB_SCHEMA.CANDIDATE_BODY.PARTS];
        if (typeof parts === "string") return parts;
        if (Array.isArray(parts)) {
            let textChunks = [];
            for (let part of parts) {
                if (typeof part === "string") {
                    textChunks.push(part);
                } else if (Array.isArray(part) && typeof part[0] === "string") {
                    textChunks.push(part[0]);
                }
            }
            if (textChunks.length) return textChunks.join("");
        }

        // Fallback: if body itself is an array of strings [ "text chunk 1", ... ]
        if (typeof body[0] === "string" && body[0].length > 3) {
            return body[0];
        }

        return "";
    }

    const IMAGE_GEN_RE = /https?:\/\/googleusercontent\.com\/(?:image_generation_content|imagegenerationcontent)\/(\d+)/i;
    const RESEARCH_PROMPT_PREFIX_RE = /^(?:我已经完成了研究|我拟定了一个研究方案|I've completed your research|Here is a research plan)/i;

    function isRealTitle(t, fallbackId) {
        try {
            if (typeof GeminiUtils !== 'undefined' && GeminiUtils.isRealTitle) return GeminiUtils.isRealTitle(t, fallbackId);
            if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.isRealTitle) return globalThis.GeminiUtils.isRealTitle(t, fallbackId);
            if (typeof require !== 'undefined') {
                const u = require('./utils.js');
                if (u && u.isRealTitle) return u.isRealTitle(t, fallbackId);
            }
        } catch {}
        if (!t || typeof t !== 'string') return false;
        const s = t.trim();
        if (!s || s.length < 2 || s === 'Untitled' || s === '未命名' || s === 'New chat' || s === '新对话') return false;
        if (/^(Google\s+)?(Gemini|Bard|Google\s+AI|Google\s+Account)$/i.test(s)) return false;
        if (fallbackId && (s === fallbackId || s === 'c_' + fallbackId || fallbackId === 'c_' + s)) return false;
        if (/^[0-9a-f]{16}$/i.test(s) || /^c_[0-9a-f]{16}$/i.test(s) || /^[a-f0-9_-]{8,64}$/i.test(s)) return false;
        if (/^(未命名对话|Untitled conversation|Document|Gemini|Google Gemini|Bard|Google Bard|Google AI)$/i.test(s)) return false;
        if (RESEARCH_PROMPT_PREFIX_RE.test(s)) return false;
        return true;
    }

    function cleanTitle(rawTitle) {
        try {
            if (typeof GeminiUtils !== 'undefined' && GeminiUtils.cleanTitle) return GeminiUtils.cleanTitle(rawTitle);
            if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.cleanTitle) return globalThis.GeminiUtils.cleanTitle(rawTitle);
            if (typeof require !== 'undefined') {
                const u = require('./utils.js');
                if (u && u.cleanTitle) return u.cleanTitle(rawTitle);
            }
        } catch {}
        if (!rawTitle || typeof rawTitle !== 'string') return '';
        let t = rawTitle.replace(/\u00a0/g, ' ').replace(/[\r\n\t]+/g, ' ').trim();
        if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(t)) return '';
        t = t.replace(/\s*[-–—|·•]\s*(Google\s+)?(Gemini|Bard|Google\s+AI).*$/i, '');
        t = t.replace(/^(Google\s+)?(Gemini|Bard|Google\s+AI)\s*[-–—|·•]\s*/i, '');
        t = t.trim();
        if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(t)) return '';
        return t;
    }

    function robustFirstPayload(text) {
        if (!text || typeof text !== "string") return null;
        let lines = text.split("\n");
        let allTop = [];
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (!line.includes("[")) continue;
            let startIdx = line.indexOf("[");
            let candidate = line.slice(startIdx);
            try {
                let cleaned = candidate.replace(/[\x00-\x1F\x7F]/g, "").trim();
                let parsed = JSON.parse(cleaned);
                if (Array.isArray(parsed)) {
                    allTop.push(...parsed);
                }
            } catch {
                let acc = candidate;
                for (let j = i + 1; j < lines.length; j++) {
                    acc += lines[j];
                    try {
                        let c2 = acc.replace(/[\x00-\x1F\x7F]/g, "").replace(/,\s*null\s*,/g, ",null,").replace(/,\s*\[/g, ",[").replace(/\]\s*,/g, "],").trim();
                        let p2 = JSON.parse(c2);
                        if (Array.isArray(p2)) {
                            allTop.push(...p2);
                            i = j;
                            break;
                        }
                    } catch {}
                }
            }
        }
        return allTop.length ? allTop : null;
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
                    const cleanT = cleanTitle(title || cleanId);
                    const isReal = isRealTitle(cleanT, cleanId);
                    convs.push({
                        id: cleanId,
                        title: cleanT,
                        titleSource: isReal ? 'rpc' : 'default',
                        titles: { rpc: cleanT },
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

    function extractImages(obj, seqRef) {
        let images = [],
            seenKeys = new Set();
        // seqRef: { value: number } 全局递增，避免跨 turn 同名覆盖（P0）
        let counter = seqRef && typeof seqRef.value === 'number' ? seqRef : { value: 1 };

        function inferExt(url) {
            try {
                let u = String(url).split('?')[0].split('#')[0];
                let m = u.match(/\.([a-z0-9]{3,4})$/i);
                if (m && /^(jpg|jpeg|png|webp|gif|bmp)$/i.test(m[1])) return '.' + m[1].toLowerCase().replace('jpeg','jpg');
            } catch {}
            return '.jpg';
        }

        function walk(node) {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) {
                if (node.length >= 3 && typeof node[0] === "string" && node[0].startsWith("http") && typeof node[1] === "number" && typeof node[2] === "number") {
                    let sourceUrl = node[0],
                        width = node[1],
                        height = node[2];
                    if (!isInternalChipUrl(sourceUrl)) {
                        let token = typeof node[3] === "string" ? node[3] : void 0;
                        // 使用全局序号 + URL hash 片段保证跨 turn 唯一
                        let ext = inferExt(sourceUrl);
                        let hashFrag = '';
                        try { hashFrag = String(sourceUrl).slice(-8).replace(/[^a-z0-9]/gi,'').slice(0,4); } catch {}
                        let fileName = `image-${counter.value++}${hashFrag ? '-'+hashFrag : ''}${ext}`;
                        let mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
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
        let flat = JSON.stringify(inner).match(/"c_[a-zA-Z0-9_-]{8,64}"/);
        if (flat) return flat[0].replace(/"/g, "");
        return "c_unknown";
    }

    function smartSummarizePrompt(rawText) {
        if (!rawText) return '';
        let s = cleanTitle(rawText).trim();
        s = s.replace(/^(请问一下|请问|我想问一下|我想问|你能帮我|帮我|你能|请教一下|请教|都说|那么|那个|如果说|如果|我发现|为什么)\s*[,，:：]?\s*/i, '');
        const breakMatch = s.match(/^([^，。？！\n\r\t,?!]{4,35})/);
        if (breakMatch && breakMatch[1]) {
            s = breakMatch[1].trim();
        } else {
            s = s.slice(0, 30).trim();
        }
        return s;
    }

    function extractConversationTitle(inner, turns) {
        if (Array.isArray(inner)) {
            if (typeof inner[2] === "string" && inner[2].length > 0 && !inner[2].startsWith("c_") && !inner[2].startsWith("tC") && !inner[2].startsWith("rc_")) {
                const clean = cleanTitle(inner[2]);
                if (isRealTitle(clean)) return { title: clean, source: 'rpc' };
            }
            if (typeof inner[1] === "string" && inner[1].length > 0 && !inner[1].startsWith("c_") && !inner[1].startsWith("tC") && !inner[1].startsWith("rc_")) {
                const clean = cleanTitle(inner[1]);
                if (isRealTitle(clean)) return { title: clean, source: 'rpc' };
            }
            if (Array.isArray(inner[0]) && typeof inner[0][1] === "string") {
                const clean = cleanTitle(inner[0][1]);
                if (isRealTitle(clean)) return { title: clean, source: 'rpc' };
            }
            for (let i = 0; i < Math.min(inner.length, 6); i++) {
                if (typeof inner[i] === "string" && inner[i].length >= 2 && !inner[i].startsWith("c_") && !inner[i].startsWith("tC") && !inner[i].startsWith("rc_")) {
                    const clean = cleanTitle(inner[i]);
                    if (isRealTitle(clean)) return { title: clean, source: 'rpc' };
                }
            }
        }
        if (Array.isArray(turns)) {
            for (let t of turns) {
                let uText = t?.[2]?.[0]?.[0];
                if (typeof uText === "string" && uText.trim() && !RESEARCH_PROMPT_PREFIX_RE.test(uText)) {
                    const concise = smartSummarizePrompt(uText);
                    if (isRealTitle(concise)) return { title: concise, source: 'sniff' };
                    const rawClean = cleanTitle(uText.slice(0, 40).trim());
                    if (isRealTitle(rawClean)) return { title: rawClean, source: 'sniff' };
                }
            }
        }
        return { title: "未命名对话", source: 'default' };
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

    function extractMetaTitleFromTop(top, targetConvId) {
        if (!Array.isArray(top)) return null;
        const normId = id => String(id || '').replace(/^c_/, '').trim();
        const targetNid = normId(targetConvId);
        for (let item of top) {
            if (Array.isArray(item) && item[0] === "wrb.fr" && (item[1] === "MaZiqc" || item[1] === "b7Lged") && typeof item[2] === "string") {
                try {
                    let metaInner = JSON.parse(item[2]);
                    let list = Array.isArray(metaInner[1]) ? metaInner[1] : (Array.isArray(metaInner[2]) ? metaInner[2] : []);
                    for (let entry of list) {
                        if (Array.isArray(entry)) {
                            let id = entry[0];
                            let rawTitle = entry[1];
                            let nid = normId(id);
                            if (!targetNid || !nid || nid === targetNid) {
                                let cleanT = cleanTitle(rawTitle);
                                if (isRealTitle(cleanT, nid || targetNid)) {
                                    return cleanT;
                                }
                            }
                        }
                    }
                } catch {}
            }
        }
        return null;
    }

    function parseDetail(text, targetConvId) {
        try {
            let top = robustFirstPayload(text);
            // 全量埋点：记录所有潜在数据源，供通用 parser 提炼（Dev 模式或空结果时必打）
            // NOTE: parseDetail runs in the Gemini page content-script context; the 'dev-mode'
            // CSS class is applied to the *options* page document.body — a different document.
            // content.js reads gemini_dev_mode from storage and sets window.__gemExporterDevMode
            // so we check that global flag instead of document.body.classList.
            const isDevMode = (typeof globalThis !== 'undefined' && (globalThis.__gemExporterDevMode || globalThis.__gemExporterVerboseLog || globalThis.__gemExporterLogAll))
                || (typeof window !== 'undefined' && (window.__gemExporterDevMode || window.__gemExporterVerboseLog));
            const shouldVerbose = isDevMode || !text || text.length < 500;
            if (shouldVerbose) {
                try {
                    const summary = Array.isArray(top) ? top.map((it,i) => {
                        const rpc = Array.isArray(it) ? it[1] : String(it).slice(0,20);
                        const innerLen = Array.isArray(it) && typeof it[2]==='string' ? it[2].length : (typeof it==='string'?it.length:0);
                        const preview = Array.isArray(it) && typeof it[2]==='string' ? it[2].slice(0,300).replace(/\n/g,' ') : '';
                        return { idx:i, rpc, innerLen, preview };
                    }) : { topType: typeof top, len: text?.length };
                    if (!top || !Array.isArray(top)) console.log('[Parser Verbose] top candidates', summary);
                    if (!top || (Array.isArray(top) && !top.some(it=>Array.isArray(it)&&it[1]==='hNvQHb'&&typeof it[2]==='string'&&it[2].includes('rc_')))) {
                        console.warn('[Parser Verbose] no hNvQHb with rc_ found, top summary', summary);
                    }
                } catch {}
            }
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
            // 稳健的 turns 定位：不再依赖固定下标，全量深搜匹配 turn 结构
            function isTurn(turn) {
                if (!Array.isArray(turn) || turn.length < 3) return false;
                const head = turn[0];
                let idStr = '';
                if (typeof head === 'string') idStr = head;
                else if (Array.isArray(head) && head.length) {
                    idStr = typeof head[0] === 'string' ? head[0] : (Array.isArray(head[0]) && typeof head[0][0] === 'string' ? head[0][0] : '');
                }
                if (!idStr || !idStr.startsWith('c_')) return false;
                // 需含 user 文本或 candidate rc_
                try { const s = JSON.stringify(turn); return s.includes('rc_') || s.includes('c_d') || s.includes('r_') || Array.isArray(turn[2]); } catch { return false; }
            }
            function isTurnsArray(arr) {
                if (!Array.isArray(arr) || arr.length === 0) return false;
                let cnt = 0;
                for (const t of arr) if (isTurn(t)) cnt++;
                return cnt >= 1 && cnt / arr.length >= 0.5;
            }
            function findTurnsDeep(root, depth = 0) {
                if (!root || depth > 6) return null;
                if (isTurnsArray(root)) return root;
                if (Array.isArray(root)) {
                    for (const el of root) {
                        const found = findTurnsDeep(el, depth + 1);
                        if (found) return found;
                    }
                } else if (root && typeof root === 'object') {
                    for (const k in root) {
                        const found = findTurnsDeep(root[k], depth + 1);
                        if (found) return found;
                    }
                }
                return null;
            }
            let turns = null;
            // 优先按原协议 inner[0] 快速路径
            if (isTurnsArray(inner?.[0])) turns = inner[0];
            // 全量深搜 inner
            if (!turns) turns = findTurnsDeep(inner);
            // 再搜 top 的其他条目（hNvQHb 为 list 形态时，turns 在 MaZiqc 的 inner 中）
            if (!turns && Array.isArray(top)) {
                for (const item of top) {
                    if (!Array.isArray(item) || typeof item[2] !== 'string') continue;
                    if (item[2] === innerStr) continue;
                    try {
                        const altInner = JSON.parse(item[2]);
                        const altTurns = findTurnsDeep(altInner);
                        if (altTurns) { turns = altTurns; inner = altInner; break; }
                    } catch {}
                }
                if (!turns) {
                    const topTurns = findTurnsDeep(top);
                    if (topTurns) turns = topTurns;
                }
            }
            if (!turns) turns = [];
            // Detect "metadata-only" response: inner = [null, null, [[conv_id_str, title, ...]]]
            // This is a known pattern where hNvQHb returns list-style metadata instead of turns.
            const isMetadataOnly = !turns.length
                && inner[0] === null && inner[1] === null
                && Array.isArray(inner[2]) && inner[2].length > 0
                && typeof inner[2][0]?.[0] === 'string' && inner[2][0][0].startsWith('c_');
            if (isMetadataOnly && isDevMode) {
                console.warn('[Parser] hNvQHb returned metadata-only payload (no turns). ' +
                    'inner[2][0] looks like a list-format row, not a turns array. ' +
                    'conv:', inner[2][0]?.[0], 'title:', inner[2][0]?.[1],
                    'rc_count:', inner[2][0]?.filter(x => typeof x === 'string' && x.startsWith('rc_')).length);
            }
            let convId = extractConversationId(inner, turns);
            if (convId === "c_unknown" && targetConvId) convId = targetConvId;
            let shortScope = convId ? String(convId).replace(/^c_/, '').slice(-6) + '_' : '';
            let msgs = [];
            let dedupSet = new Set();
            let docDedupSet = new Set();
            let imageSeq = { value: 1 };
            let schemaDriftWarnings = [];
            let rev = [...turns].reverse();
            for (let turn of rev) {
                let drift = detectTurnSchemaDrift(turn, convId);
                if (drift.isDrifted) {
                    schemaDriftWarnings.push(...drift.warnings);
                }
                let ts = extractTurnTimestamp(turn) || Date.now();
                let uText = turn?.[GEMINI_JSPB_SCHEMA.TURN.USER_PAYLOAD]?.[0]?.[0] || "";
                let uImgs = filterNewImages(extractImages(turn?.[GEMINI_JSPB_SCHEMA.TURN.USER_PAYLOAD], imageSeq), dedupSet);
                let uFiles = extractUserFiles(turn?.[GEMINI_JSPB_SCHEMA.TURN.USER_PAYLOAD]).filter(f => {
                    let key = f.id || f.sourceUrl || f.fileName;
                    if (!key || docDedupSet.has(key)) return false;
                    docDedupSet.add(key);
                    return true;
                });
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
                            createdAt: ts,
                            chipUrl: "",
                            sections: [],
                            links: [],
                            contentMarkdown: void 0,
                            url: f.sourceUrl,
                            localName: `files/${shortScope}${(f.fileName || 'doc.md').replace(/[\\/:*?"<>|]/g, '_')}`,
                            type: "file"
                        })) : void 0
                    });
                }
                let candList = extractModelCandidates(turn);
                if (Array.isArray(candList)) {
                    for (let cand of candList) {
                        let candidateId = cand?.[GEMINI_JSPB_SCHEMA.CANDIDATE.ID] || "";
                        let candidateBlock = cand?.[GEMINI_JSPB_SCHEMA.CANDIDATE.BODY] || cand;
                        let responseText = extractCandidateText(cand);
                        if (!responseText) {
                            let textArr = [];
                            let textWalk = function(node) {
                                if (!node || typeof node !== "object") return;
                                if (Array.isArray(node)) {
                                    if (node.length >= 1 && typeof node[0] === "string" && node[0].length > 0 && !node[0].startsWith("http") && !node[0].startsWith("rc_") && !node[0].startsWith("c_")) {
                                        if (node[0].trim().length > 2 && !textArr.includes(node[0])) {
                                            textArr.push(node[0]);
                                        }
                                    }
                                    for (let item of node) textWalk(item);
                                } else {
                                    for (let k in node)
                                        if (Object.prototype.hasOwnProperty.call(node, k)) textWalk(node[k]);
                                }
                            };
                            textWalk(cand);
                            responseText = textArr.join("\n\n");
                        }
                        let candImages = extractImages(candidateBlock, imageSeq);
                        let filteredImages = filterNewImages(candImages, dedupSet);
                        let docsMeta = extractDocumentsMeta(candidateBlock);
                        if (!docsMeta.length && !docDedupSet.size) {
                            docsMeta = extractDocumentsMeta(inner);
                        }
                        let docs = docsMeta.filter(docItem => {
                            let key = docItem.id || docItem.chipUrl;
                            if (!key || docDedupSet.has(key)) return false;
                            let isRc = /^rc_/.test(docItem.id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docItem.id);
                            let isHttp = docItem.id.includes("immersive_entry_chip") || docItem.id.startsWith("http");
                            if (!isRc && isHttp) return false;
                            docDedupSet.add(key);
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
                            responseText = responseText.replace(/^rc_[a-z0-9_]{10,}\s*/i, '');
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
            if (convId === "c_unknown" && targetConvId) convId = targetConvId;
            let metaTitle = extractMetaTitleFromTop(top, convId || targetConvId);
            let titleObj = extractConversationTitle(inner, turns);
            let nextToken = null;
            if (typeof inner[1] === "string" && inner[1].startsWith("tC")) nextToken = inner[1];
            let url = `https://gemini.google.com/app/${String(convId).replace(/^c_/, '')}`;
            let times = turns.map(t => extractTurnTimestamp(t)).filter(x => Number.isFinite(x));
            let minTs = times.length ? Math.min(...times) : null;
            let maxTs = times.length ? Math.max(...times) : null;
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
            let cleanT = metaTitle || cleanTitle(titleObj.title || convId);
            let isReal = isRealTitle(cleanT, convId);
            let finalSource = metaTitle ? 'rpc' : (isReal ? titleObj.source : 'default');
            if (!isReal && !metaTitle) {
                let firstUser = allMsgs.find(m => m.role === 'user' && m.content && m.content.trim());
                if (firstUser) {
                    let candidate = cleanTitle(firstUser.content.trim().slice(0, 60).replace(/\n+/g, ' '));
                    if (isRealTitle(candidate, convId)) {
                        cleanT = candidate;
                        finalSource = 'sniff';
                    }
                }
            }
            const titlesMap = {};
            if (finalSource !== 'default' && cleanT) {
                titlesMap[finalSource] = cleanT;
            }
            if (metaTitle) {
                titlesMap.rpc = metaTitle;
            }
            let _debug = null;
            if (!allMsgs.length) {
                try {
                    _debug = { turnsLen: turns?.length || 0, innerKeys: inner ? Object.keys(inner) : null, innerPreview: JSON.stringify(inner).slice(0, 1500), topPreview: top ? JSON.stringify(top).slice(0, 800) : null };
                } catch {}
            }
            if (schemaDriftWarnings.length) {
                if (!_debug) _debug = {};
                _debug.schemaDriftWarnings = schemaDriftWarnings;
            }
            return {
                id: convId,
                title: cleanT,
                titleSource: finalSource,
                titles: titlesMap,
                messages: allMsgs,
                createdAt: minTs,
                chatTime: maxTs || minTs,
                timestamp: maxTs || minTs,
                updatedAt: maxTs,
                url,
                nextPageToken: nextToken,
                attachmentCount: allMsgs.reduce((a, m) => a + (m.attachmentCount || 0), 0),
                schemaDrift: schemaDriftWarnings.length ? schemaDriftWarnings : void 0,
                _raw: inner,
                _debug
            };
        } catch (e) {
            throw new Error("detail parse fail: " + e.message);
        }
    }

    const GeminiResponseParserClass = {
        GEMINI_JSPB_SCHEMA,
        detectTurnSchemaDrift,
        extractModelCandidates,
        extractCandidateText,
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
        isRealTitle,
        GEMINI_JSPB_SCHEMA,
        detectTurnSchemaDrift
    };
}));
