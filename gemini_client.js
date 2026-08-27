// gemini_client.js - Gemini internal batchexecute API client with images and attachments support
(function(global) {
    const GEMINI_API_URL = "https://gemini.google.com/_/BardChatUi/data/batchexecute";
    const RPCS = {
        LIST: "MaZiqc",
        DETAIL: "hNvQHb",
        GEMS: "CNgdBe"
    };
    const BL_FALLBACK = "boq_assistant-bard-web-server_20260802.09_p1";
    const generateFallbackSid = () => String(Math.floor(Math.random() * 1e19));
    const IMAGE_GEN_RE = /https?:\/\/googleusercontent\.com\/(?:image_generation_content|imagegenerationcontent)\/(\d+)/i;

    function getApiUrl(slot) {
        if (slot && slot !== "default") {
            let t = slot.replace(/^u/, "/u/");
            return `https://gemini.google.com${t}/_/BardChatUi/data/batchexecute`;
        }
        return GEMINI_API_URL;
    }

    function getBlFromPage() {
        try {
            let html = (global.document && global.document.documentElement && global.document.documentElement.innerHTML) || "";
            let m = html.match(/"cfb2h"\s*:\s*"([^"]+)"/) || html.match(/"bl"\s*:\s*"(boq_assistant[^"]+)"/);
            if (m) return m[1];
            if (global.__gemExporterBl) return global.__gemExporterBl;
        } catch {}
        return null;
    }

    function getAtFromPage() {
        try {
            if (global.__gemExporterExtractAt) {
                let a = global.__gemExporterExtractAt();
                if (a) return a;
            }
            let scripts = global.document ? global.document.querySelectorAll('script') : [];
            for (let s of scripts) {
                let txt = s.textContent || "";
                let m = txt.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
                if (m) return m[1];
            }
            if (global._WIZ_global_data && global._WIZ_global_data.SNlM0e) return global._WIZ_global_data.SNlM0e;
            if (global.WIZ_global_data && global.WIZ_global_data.SNlM0e) return global.WIZ_global_data.SNlM0e;
        } catch {}
        return "";
    }

    function detectSlot() {
        try {
            let m = (global.location && global.location.pathname || "").match(/\/u\/(\d+)/);
            if (m) return `u${m[1]}`;
        } catch {}
        return "default";
    }
    async function loadCredMap() {
        try {
            let s = await chrome.storage.local.get(["gemini_credentials_map", "gemini_credentials"]);
            let map = s.gemini_credentials_map || {};
            if (s.gemini_credentials && s.gemini_credentials.sid && !map[s.gemini_credentials.sid]) {
                map[s.gemini_credentials.sid] = {
                    at: s.gemini_credentials.at || "",
                    sid: s.gemini_credentials.sid,
                    accountSlot: "default",
                    lastUsed: Date.now()
                };
            }
            return map;
        } catch {
            return {};
        }
    }
    async function resolveCred(targetSid) {
        let map = await loadCredMap();
        let vals = Object.values(map);
        let pageAt = getAtFromPage();
        let pageBl = getBlFromPage();
        if ((!vals.length || !vals[0].at) && pageAt) {
            let slot = detectSlot();
            let sid = vals[0]?.sid || ("page_" + Date.now());
            let entry = {
                sid,
                at: pageAt,
                bl: pageBl || BL_FALLBACK,
                accountSlot: slot,
                lastUsed: Date.now()
            };
            vals = [entry];
            try {
                await chrome.storage.local.set({
                    gemini_credentials_map: {
                        [sid]: entry
                    },
                    gemini_credentials: {
                        at: pageAt,
                        sid
                    }
                });
            } catch {}
        } else if (pageBl && vals[0] && !vals[0].bl) {
            vals[0].bl = pageBl;
        }
        if (targetSid && map[targetSid]) return {
            ...map[targetSid],
            bl: map[targetSid].bl || pageBl || BL_FALLBACK,
            at: map[targetSid].at || pageAt || ""
        };
        let cur = detectSlot();
        let f = vals.filter(v => (v.accountSlot || "default") === cur);
        let arr = f.length ? f : vals;
        arr.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
        if (arr[0]) return {
            ...arr[0],
            bl: arr[0].bl || pageBl || BL_FALLBACK,
            at: arr[0].at || pageAt || ""
        };
        return {
            sid: generateFallbackSid(),
            at: pageAt || "",
            accountSlot: "default",
            bl: pageBl || BL_FALLBACK
        };
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
                    if (candidate.includes("MaZiqc") || candidate.includes("wrb.fr")) {
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
                            if (acc.includes("MaZiqc") || acc.includes("wrb.fr")) {
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
                    if (Array.isArray(item) && (item[1] === RPCS.LIST || item[1] === "MaZiqc" || item[0] === "wrb.fr") && item[2]) {
                        innerStr = item[2];
                        break;
                    }
                }
                if (!innerStr && top[0] && top[0][2]) {
                    innerStr = top[0][2];
                }
            }
            if (!innerStr) {
                console.warn("[Gemini Exporter] parseList: no inner JSON string found. Raw text len:", text?.length);
                return {
                    conversations: [],
                    nextPageToken: null,
                    _debug: {
                        error: "NO_INNER_STR",
                        textLen: text?.length,
                        rawPreview: text?.slice(0, 500),
                        topParsed: top ? JSON.stringify(top).slice(0, 500) : null
                    }
                };
            }
            let inner = JSON.parse(innerStr);
            let list = Array.isArray(inner[1]) ? inner[1] : (Array.isArray(inner[2]) ? inner[2] : []);
            let convs = [];
            for (let r of list) {
                if (!r || !Array.isArray(r) || r.length < 2) continue;
                let id = String(r[0] || "").replace(/^c_/, ""),
                    title = (r[1] || "").replace(/\\n/g, "");
                if (title.endsWith("-")) title = title.slice(0, -1);
                if (/^Google Account/i.test(title)) continue;
                let ts = Date.now();
                if (Array.isArray(r[5]) && r[5].length >= 2) ts = Math.round(r[5][0] * 1000);
                if (!id) continue;
                convs.push({
                    id,
                    title: title.slice(0, 120) || "Untitled",
                    timestamp: ts,
                    url: `https://gemini.google.com/app/${String(id).replace(/^c_/,'')}`,
                    gemId: r[7] || null
                });
            }
            let token = null;
            function checkToken(s) {
                if (typeof s !== 'string') return null;
                s = s.trim();
                if (s.length >= 25 && !s.includes(' ') && !s.includes('\n') && !s.startsWith('http') && !s.startsWith('c_') && !s.startsWith('boq_') && !s.startsWith('Google Account')) {
                    return s;
                }
                return null;
            }
            if (Array.isArray(inner)) {
                for (let v of inner) {
                    let found = checkToken(v);
                    if (found) { token = found; break; }
                    if (Array.isArray(v)) {
                        for (let item of v) {
                            let f2 = checkToken(item);
                            if (f2) { token = f2; break; }
                        }
                        if (token) break;
                    }
                }
            }
            return {
                conversations: convs,
                nextPageToken: token || null,
                _debug: {
                    innerTypes: Array.isArray(inner) ? inner.map((x, idx) => `${idx}:${typeof x}${Array.isArray(x) ? `[${x.length}]` : (typeof x === 'string' ? `(len:${x.length})` : '')}`) : typeof inner,
                    stringsFound: Array.isArray(inner) ? inner.filter(x => typeof x === 'string').map(s => ({ len: s.length, preview: s.slice(0, 40) })) : [],
                    hasToken: !!token
                }
            };
        } catch (e) {
            console.warn("parseList fail", e);
            return {
                conversations: [],
                nextPageToken: null,
                _debug: { error: e.message }
            };
        }
    }
    // --- Data extraction and normalization helpers ---
    function extractTurnTimestamp(turnData) {
        if (!turnData) return null;
        let candidates = [turnData?.[4], turnData?.[5], turnData?.[turnData.length - 1]];
        for (let candidate of candidates) {
            if (Array.isArray(candidate) && typeof candidate[0] === "number" && candidate[0] > 1e9) {
                let timestampSec = candidate[0];
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

    function extractImages(root) {
        let extractedImages = [];
        let seenUrls = new Set();
        let variantOf = url => {
            let m = url.match(/=(s\d+(?:-[a-z0-9]+)*)/i);
            return m?.[1] || void 0;
        };

        function walk(node) {
            if (Array.isArray(node)) {
                let sourceUrl = typeof node[3] === "string" ? node[3] : "";
                let fileName = typeof node[2] === "string" ? node[2] : "";
                let mime = typeof node[11] === "string" ? node[11] : void 0;
                let token = typeof node[5] === "string" && node[5].startsWith("$AQ") ? node[5] : void 0;
                let sizeArr = node.find(x => Array.isArray(x) && x.length >= 3 && typeof x[0] === "number" && typeof x[1] === "number" && typeof x[2] === "number" && x[0] > 100 && x[1] > 100 && x[2] > 1e3);
                let isGoogleHost = sourceUrl.includes("googleusercontent.com") || sourceUrl.includes("lh3.google.com") || sourceUrl.includes("ggpht");
                let isExt = /\.(png|jpe?g|webp|gif)$/i.test(fileName);
                let isMimeImg = typeof mime === "string" && mime.startsWith("image/");
                let isGenUrl = /googleusercontent\.com\/.*(?:image|photo|s\d)/i.test(sourceUrl);
                if (isGoogleHost && (isExt || isMimeImg || isGenUrl) && !seenUrls.has(sourceUrl)) {
                    seenUrls.add(sourceUrl);
                    extractedImages.push({
                        id: `img:${extractedImages.length}:${fileName || sourceUrl}`,
                        fileName: fileName || `image-${extractedImages.length + 1}.jpg`,
                        sourceUrl,
                        mimeType: mime,
                        width: sizeArr?.[0],
                        height: sizeArr?.[1],
                        size: sizeArr?.[2],
                        token,
                        variant: variantOf(sourceUrl)
                    });
                }
                for (let child of node) walk(child);
            } else if (node && typeof node === "object") {
                for (let v of Object.values(node)) walk(v);
            }
        }
        walk(root);
        return extractedImages;
    }

    function extractUserFiles(root) {
        // 通用文件提取：Gemini 上传的 zip/pdf/docx 通常在 turn[2] 结构里，带 filename 和 URL，非 lh3，而是 drive/usercontent 或 blob
        let files = [];
        let seen = new Set();

        function walk(node) {
            if (Array.isArray(node)) {
                // 猜测结构: [?, blobId?, fileName, url?, mime?, size?]
                // fileName 常见检测
                let name = (typeof node[2] === "string" && node[2].length > 2) ? node[2] : (typeof node[1] === "string" && node[1].includes('.') ? node[1] : "");
                let url = "";
                for (let v of node) {
                    if (typeof v === "string" && (v.startsWith('https://') && (v.includes('googleusercontent.com') || v.includes('drive.google.com') || v.includes('lh3.google')))) {
                        url = v;
                        break;
                    }
                }
                // mime
                let mime = typeof node[11] === "string" ? node[11] : (typeof node[4] === "string" && node[4].includes('/') ? node[4] : "");
                let isFile = /\.(zip|pdf|docx?|xlsx?|csv|txt|md|json|png|jpe?g|webp)$/i.test(name) && name.length < 120;
                let isBlob = url.includes('blob:') || url.includes('drive.google');
                // zip 特殊：mime application/zip 或 octet-stream
                if (isFile && !seen.has(url + '|' + name)) {
                    // 排除已识别为 image 的（image 走 image 通道）
                    let ext = name.split('.').pop().toLowerCase();
                    let isImgExt = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);
                    if (!isImgExt || !url.includes('lh3.googleusercontent.com')) {
                        // 去重
                        // 仅当有 url 或 name 是 zip 等二进制时收
                        if (url || /\.(zip|pdf|docx?|xlsx)$/i.test(name)) {
                            seen.add(url + '|' + name);
                            files.push({
                                id: `file:${files.length}:${name}`,
                                fileName: name,
                                sourceUrl: url,
                                mimeType: mime || ('application/' + ext),
                                size: typeof node[3] === 'number' ? node[3] : void 0
                            });
                        }
                    }
                }
                for (let child of node) walk(child);
            } else if (node && typeof node === "object") {
                for (let v of Object.values(node)) walk(v);
            }
        }
        walk(root);
        return files;
    }

    function extractDocumentsMeta(root) {
        let out = [];
        let uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

        function pushMeta(metaObj) {
            if (metaObj.id && metaObj.title) out.push({
                id: metaObj.id,
                title: metaObj.title,
                chipUrl: metaObj.chipUrl,
                createdAt: metaObj.createdAt,
                contentId: metaObj.contentId
            });
        }

        function walk(node) {
            if (!Array.isArray(node)) return;
            for (let i = 0; i < node.length; i++) {
                let item = node[i];
                if (Array.isArray(item) && item.length >= 4 && Array.isArray(item[0]) && item[0].length > 0 && typeof item[0][0] === "string" && item[0][0].includes("immersive_entry_chip") && typeof item[1] === "string" && typeof item[2] === "string" && typeof item[3] === "string") {
                    let chipUrl = item[0][0],
                        id = item[2],
                        title = item[3];
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
                            let title = flat.find(x => !x.includes("http") && !uuidRe.test(x) && x.length > 3 && !x.includes("c_") && !x.includes(".html"));
                            pushMeta({
                                id: uuid || flat.find(x => x.includes("rc_")) || chip,
                                title: title || "Document",
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
        if (inner?.[1] && typeof inner[1] === "string" && /^c_/.test(inner[1])) return inner[1];
        let stack = [inner];
        let found = "";
        while (stack.length && !found) {
            let cur = stack.pop();
            if (Array.isArray(cur)) {
                for (let item of cur) {
                    if (typeof item === "string" && /^c_[A-Za-z0-9_-]+$/.test(item)) {
                        found = item;
                        break;
                    }
                    if (Array.isArray(item)) stack.push(item);
                }
            }
        }
        if (found) return found;
        if (turns?.[0]?.[0]?.[0]) return turns[0][0][0];
        return "";
    }

    function findDocContentById(inner, id) {
        let res = null;
        function search(node) {
            if (res) return;
            if (Array.isArray(node)) {
                if (node.includes(id)) {
                    res = node;
                    return;
                }
                for (let child of node) search(child);
            }
        }
        search(inner);
        return res;
    }

    function parseDocSections(node) {
        if (!node) return {
            sections: [],
            links: [],
            contentMarkdown: void 0
        };
        let sections = [],
            links = [],
            markdownContent;

        function findMarkdown(element) {
            if (markdownContent) return;
            if (typeof element === "string") {
                let trimmed = element.trim();
                if ((trimmed.startsWith("# ") || trimmed.startsWith("## ") || (trimmed.includes("\n") && trimmed.length > 80))) {
                    markdownContent = trimmed;
                    return;
                }
            } else if (Array.isArray(element)) {
                for (let child of element) findMarkdown(child);
            }
        }
        findMarkdown(node);
        return {
            sections,
            links,
            contentMarkdown: markdownContent
        };
    }

    function findDocMarkdownByClues(inner, meta) {
        let result;
        function searchTree(node) {
            if (result) return;
            if (Array.isArray(node)) {
                let flat = node.flat ? node.flat(1) : node;
                let hasId = flat.some(item => item === meta.id);
                let hasTitle = flat.some(item => item === meta.title);
                if (hasId && hasTitle) {
                    function searchString(element) {
                        if (result) return;
                        if (typeof element === "string") {
                            let trimmed = element.trim();
                            if (trimmed.startsWith("# ") || trimmed.startsWith("## ") || (trimmed.includes("\n") && trimmed.length > 120)) {
                                result = trimmed;
                                return;
                            }
                        } else if (Array.isArray(element)) {
                            for (let child of element) searchString(child);
                        }
                    }
                    searchString(node);
                    if (result) return;
                }
                for (let child of node) searchTree(child);
            }
        }
        searchTree(inner);
        return result;
    }

    function highResVariant(url) {
        try {
            let [base, q = ""] = url.split("?");
            let stripped = base.replace(/=s\d+(?:-[a-z0-9]+)*/i, "");
            let suffix = q ? `${q}&alr=yes` : "alr=yes";
            return `${stripped}=s1024-rj?${suffix}`;
        } catch {
            return url;
        }
    }

    function parseDetail(text) {
        try {
            let top = robustFirstPayload(text);
            if (!top) throw new Error("invalid");
            // 更容忍：Gemini 最近改了序号，不一定在 [0][2]，遍历找第一个能解析成对话的 JSON 串
            let inner = null;
            if (top[0] && top[0][2]) {
                try {
                    inner = JSON.parse(top[0][2]);
                } catch {}
            }
            if (!inner) {
                for (let row of top) {
                    if (!Array.isArray(row)) continue;
                    for (let cell of row) {
                        if (typeof cell !== 'string' || cell.length < 10) continue;
                        if (!cell.trim().startsWith('[')) continue;
                        try {
                            let cand = JSON.parse(cell);
                            if (Array.isArray(cand) && cand.length && (Array.isArray(cand[0]) || typeof cand[0] === 'string')) {
                                // 粗略判断像对话：第一个元素是 turns 数组或包含用户文本
                                if (Array.isArray(cand[0]) || cand[0] === null) {
                                    inner = cand;
                                    break;
                                }
                            }
                        } catch {}
                    }
                    if (inner) break;
                }
            }
            if (!inner) throw new Error("invalid");
            let turns = inner?.[0] || [];
            let msgs = [];
            let dedupSet = new Set();
            let rev = [...turns].reverse();
            for (let turn of rev) {
                let ts = extractTurnTimestamp(turn) || Date.now();
                let uText = turn?.[2]?.[0]?.[0] || "";
                let uImgs = filterNewImages(extractImages(turn?.[2]), dedupSet);
                let uFiles = extractUserFiles(turn?.[2]); // zip/pdf 等
                if (uText || uImgs.length || uFiles.length) {
                    msgs.push({
                        id: turn?.[0]?.[0] || "",
                        role: "user",
                        content: uText,
                        timestamp: ts,
                        images: uImgs.length ? uImgs.map(i => ({
                            ...i,
                            resolvedUrl: highResVariant(i.sourceUrl),
                            localName: `assets/${(i.fileName||'img.jpg').replace(/[\\/:*?"<>|]/g,'_')}`,
                            type: "image",
                            isImage: true
                        })) : void 0,
                        documents: uFiles.length ? uFiles.map(f => ({
                            id: f.id,
                            title: f.fileName,
                            fileName: f.fileName,
                            sourceUrl: f.sourceUrl,
                            url: f.sourceUrl,
                            localName: `files/${f.fileName.replace(/[\\/:*?"<>|]/g,'_')}`,
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
                        // dedup docs by chipUrl/id
                        let seenChip = new Set();
                        let docs = docsMeta.filter(docItem => {
                            let key = docItem.chipUrl || docItem.id;
                            if (seenChip.has(key)) return false;
                            let isRc = /^rc_/.test(docItem.id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docItem.id);
                            let isHttp = docItem.id.includes("immersive_entry_chip") || docItem.id.startsWith("http");
                            if (seenChip.has(key)) return false;
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
                                    return {
                                        id: metaItem.id,
                                        title: metaItem.title,
                                        createdAt: metaItem.createdAt,
                                        chipUrl: metaItem.chipUrl,
                                        sections: [...parsedPrimary.sections, ...parsedAlt.sections],
                                        links: [...parsedPrimary.links, ...parsedAlt.links],
                                        contentMarkdown: md,
                                        url: metaItem.chipUrl || "",
                                        localName: `files/${(metaItem.title || metaItem.id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.md`,
                                        type: "file"
                                    };
                                }).filter(Boolean);
                            } catch (er) {
                                console.warn("doc parse err", er);
                            }
                        }
                        if (responseText || filteredImages.length || docDetails.length) {
                            msgs.push({
                                id: candidateId || turn?.[0]?.[0] || "",
                                role: "model",
                                content: responseText || "",
                                timestamp: ts,
                                images: filteredImages.length ? filteredImages.map(img => ({
                                    ...img,
                                    resolvedUrl: highResVariant(img.sourceUrl),
                                    localName: `assets/${(img.fileName || 'img.jpg').replace(/[\\/:*?"<>|]/g, '_')}`,
                                    type: "image"
                                })) : void 0,
                                documents: docDetails.length ? docDetails : void 0
                            });
                        }
                    }
                }
            }
            let convId = extractConversationId(inner, turns);
            let title = turns?.[0]?.[2]?.[0]?.[0] || "Untitled conversation";
            if (typeof title !== "string") title = "Untitled conversation";
            let nextToken = null;
            if (typeof inner[1] === "string" && inner[1].startsWith("tC")) nextToken = inner[1];
            let url = `https://gemini.google.com/app/${String(convId).replace(/^c_/,'')}`;
            let times = turns.map(t => extractTurnTimestamp(t)).filter(x => Number.isFinite(x));
            let minTs = times.length ? Math.min(...times) : Date.now();
            // convert images/docs to unified attachments for UI compatibility
            let allMsgs = msgs.map(m => {
                let atts = [];
                if (m.images)
                    for (let im of m.images) atts.push({
                        type: "image",
                        src: im.resolvedUrl || im.sourceUrl,
                        localName: im.localName || `assets/${im.fileName}`,
                        alt: im.fileName,
                        isBlob: false,
                        isImage: true,
                        originalUrl: im.sourceUrl
                    });
                if (m.documents)
                    for (let d of m.documents) atts.push({
                        type: "file",
                        name: d.title || d.id,
                        title: d.title,
                        url: d.url || d.chipUrl,
                        localName: d.localName,
                        contentMarkdown: d.contentMarkdown
                    });
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

    class GeminiAPIClient {
        getApiUrl(s) {
            return getApiUrl(s);
        }
        async getConversationList(pageToken, targetSid) {
            let cred = await resolveCred(targetSid);
            let api = getApiUrl(cred.accountSlot || "default");
            let params = new URLSearchParams({
                rpcids: RPCS.LIST,
                "source-path": "/app",
                bl: cred.bl || BL_FALLBACK,
                "f.sid": cred.sid || generateFallbackSid(),
                _reqid: Math.floor(1e5 * Math.random()).toString(),
                rt: "c"
            });
            let body = new URLSearchParams();
            let req = pageToken ? JSON.stringify([
                    [
                        [RPCS.LIST, JSON.stringify([20, pageToken, [0, null, 1]]), null, "generic"]
                    ]
                ]) :
                JSON.stringify([
                    [
                        [RPCS.LIST, JSON.stringify([13, null, [0, null, 1]]), null, "generic"]
                    ]
                ]);
            body.append("f.req", req);
            if (cred.at) body.append("at", cred.at);
            let resp = await fetch(`${api}?${params}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1"
                },
                body: body.toString(),
                credentials: "include"
            });
            if (!resp.ok) {
                let snippet = "";
                try {
                    snippet = (await resp.text()).slice(0, 320);
                } catch {}
                throw new Error(`HTTP ${resp.status} :: ${snippet} sid:${cred.sid?.slice(0,6)} atLen:${cred.at?.length} bl:${cred.bl?.slice(0,12)}`);
            }
            let txt = await resp.text();
            return parseList(txt);
        }
        async getAllConversations(maxPages = 2000, onProgress, targetSid, opts) {
            if (!maxPages || typeof maxPages !== "number") maxPages = 2000;
            opts = opts || {};
            const existingMap = opts.existingMap || null;
            const incremental = !!opts.incremental;
            const unchangedThreshold = opts.unchangedThreshold || 5;
            let all = [],
                seen = new Set(),
                token = null;
            let unchangedStreak = 0;
            const diagLog = {
                startTime: new Date().toISOString(),
                maxPages,
                incremental,
                totalPagesFetched: 0,
                totalConversations: 0,
                stopReason: '已达到最大页数限制',
                pageHistory: []
            };
            for (let i = 0; i < maxPages; i++) {
                let res;
                try {
                    res = await this.getConversationList(token, targetSid);
                } catch (err) {
                    console.warn(`[Gemini Exporter] getAllConversations page ${i + 1} stopped:`, err.message || err);
                    diagLog.stopReason = `网络或服务异常: ${err.message || err}`;
                    if (all.length > 0) {
                        // 网络异常或翻页到底时，保留已获取的全部会话，绝不抛出导致整盘丢弃
                        break;
                    }
                    throw err;
                }
                diagLog.totalPagesFetched = i + 1;
                diagLog.pageHistory.push({
                    page: i + 1,
                    requestedToken: token ? { len: token.length, preview: token.slice(0, 20) + '...' } : null,
                    count: res?.conversations?.length || 0,
                    hasNextPageToken: !!res?.nextPageToken,
                    nextTokenPreview: res?.nextPageToken ? { len: res.nextPageToken.length, preview: res.nextPageToken.slice(0, 20) + '...' } : null,
                    debugInfo: res?._debug || null
                });
                let added = 0;
                for (let c of res.conversations) {
                    if (!seen.has(c.id)) {
                        seen.add(c.id);
                        all.push(c);
                        added++;
                        if (incremental && existingMap) {
                            const stored = existingMap.get(c.id);
                            if (stored && stored.timestamp && c.timestamp) {
                                const sameTime = Math.abs(stored.timestamp - c.timestamp) < 60000;
                                const sameTitle = !stored.title || !c.title || stored.title === c.title;
                                if (sameTime && sameTitle) {
                                    unchangedStreak++;
                                } else {
                                    unchangedStreak = 0;
                                }
                            } else if (!stored) {
                                unchangedStreak = 0;
                            } else {
                                unchangedStreak = 0;
                            }
                            if (unchangedStreak >= unchangedThreshold) {
                                diagLog.stopReason = `增量同步命中连续 ${unchangedStreak} 条已存在历史，早退终止`;
                                diagLog.totalConversations = all.length;
                                diagLog.endTime = new Date().toISOString();
                                if (onProgress) onProgress({
                                    page: i + 1,
                                    added,
                                    total: all.length,
                                    hasMore: false,
                                    stoppedEarly: true,
                                    reason: '增量同步完成'
                                });
                                return {
                                    conversations: all,
                                    total: all.length,
                                    stoppedEarly: true,
                                    unchangedStreak,
                                    diagnostics: diagLog
                                };
                            }
                        }
                    }
                }
                if (!res.conversations || res.conversations.length === 0) {
                    diagLog.stopReason = `第 ${i + 1} 页返回 0 条数据，Google 服务端已无更早历史`;
                    console.log(`[Gemini Exporter] getAllConversations reached empty page ${i + 1}, total: ${all.length}`);
                    break;
                }
                if (onProgress) onProgress({
                    page: i + 1,
                    added,
                    total: all.length,
                    hasMore: !!res.nextPageToken
                });
                if (!res.nextPageToken) {
                    diagLog.stopReason = `第 ${i + 1} 页未返回下页游标 nextPageToken，Google 服务端游标已到底`;
                    console.log(`[Gemini Exporter] getAllConversations finished at page ${i + 1}, total: ${all.length}, no nextPageToken in response`);
                    break;
                }
                token = res.nextPageToken;
                // 适度节流（120ms），防止触发 Google 429 限流
                const pageDelay = incremental ? 50 : 120;
                await new Promise(r => setTimeout(r, pageDelay));
            }
            diagLog.totalConversations = all.length;
            diagLog.endTime = new Date().toISOString();
            return {
                conversations: all,
                total: all.length,
                diagnostics: diagLog
            };
        }
        async fetchConversationPage(conversationId, pageToken, targetSid) {
            let id = conversationId.startsWith("c_") ? conversationId : `c_${conversationId}`;
            let cred = await resolveCred(targetSid);
            let api = getApiUrl(cred.accountSlot || "default");
            let params = new URLSearchParams({
                rpcids: RPCS.DETAIL,
                "source-path": "/app",
                bl: cred.bl || BL_FALLBACK,
                "f.sid": cred.sid || generateFallbackSid(),
                _reqid: Math.floor(1e5 * Math.random()).toString(),
                rt: "c"
            });
            let body = new URLSearchParams();
            let inner = JSON.stringify([id, 10, pageToken || null, 1, [1],
                [4], null, 1
            ]);
            let fReq = JSON.stringify([
                [
                    [RPCS.DETAIL, inner, null, "generic"]
                ]
            ]);
            body.append("f.req", fReq);
            if (cred.at) body.append("at", cred.at);
            let resp = await fetch(`${api}?${params}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1"
                },
                body: body.toString(),
                credentials: "include"
            });
            if (!resp.ok) {
                let snippet = "";
                try {
                    snippet = (await resp.text()).slice(0, 320);
                } catch {}
                throw new Error(`HTTP ${resp.status} ${resp.statusText} :: ${snippet}`);
            }
            let text = await resp.text();
            return parseDetail(text);
        }
        async getConversationDetail(conversationId, targetSid) {
            let msgs = [];
            let token = null;
            let first = null;
            let attempts = 0;
            do {
                let page = await this.fetchConversationPage(conversationId, token, targetSid);
                if (!first) first = page;
                msgs = [...page.messages, ...msgs];
                token = page.nextPageToken || null;
                attempts++;
            } while (token && attempts < 20);
            if (!first) throw new Error("no data");
            let minTs = first.createdAt || Date.now();
            let attachmentCount = msgs.reduce((a, m) => a + (m.attachmentCount || 0), 0);
            return {
                ...first,
                messages: msgs,
                messageCount: msgs.length,
                timestamp: minTs,
                createdAt: minTs,
                chatTime: minTs,
                attachmentCount
            };
        }
        getCurrentConversationId() {
            try {
                let u = new URL(global.location.href);
                let parts = u.pathname.split('/');
                let idx = parts.indexOf('app');
                if (idx !== -1 && idx < parts.length - 1) return parts[idx + 1];
                let g = parts.indexOf('gem');
                if (g !== -1 && g < parts.length - 2) return parts[g + 2];
                return null;
            } catch {
                return null;
            }
        }
    }

    global.GeminiAPIClient = GeminiAPIClient;
    global.getApiUrl = getApiUrl;
    global.GeminiResponseParserClass = {
        parseList,
        parseDetail,
        robustFirstPayload,
        highResVariant,
        extractImages
    };

})(typeof window !== "undefined" ? window : self);