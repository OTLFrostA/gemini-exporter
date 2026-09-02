// takeout_engine.js - Google Takeout ZIP extraction and offline media fallback engine
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TakeoutEngine = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    let __takeoutMediaMap = {};
    let __takeoutGlobalMedia = {};
    let __takeoutConvCache = {};

    function normId(id) {
        try {
            if (typeof GeminiUtils !== 'undefined' && GeminiUtils.normId) return GeminiUtils.normId(id);
            if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.normId) return globalThis.GeminiUtils.normId(id);
        } catch {}
        if (!id) return '';
        return String(id).replace(/^c_/, '').trim();
    }

    function extractC2PATimestamp(bufferOrArray) {
        if (!bufferOrArray) return null;
        let str = '';
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bufferOrArray)) {
            str = bufferOrArray.toString('binary');
        } else if (bufferOrArray instanceof Uint8Array || ArrayBuffer.isView(bufferOrArray)) {
            const len = Math.min(bufferOrArray.length, 65536);
            let s = '';
            for (let i = 0; i < len; i++) {
                s += String.fromCharCode(bufferOrArray[i]);
            }
            str = s;
        } else if (typeof bufferOrArray === 'string') {
            str = bufferOrArray;
        }
        const m = str.match(/(202\d[01]\d[0-3]\d[0-2]\d[0-5]\d[0-5]\dZ)/);
        if (!m) return null;
        const s = m[1];
        const year = parseInt(s.slice(0, 4), 10);
        const month = parseInt(s.slice(4, 6), 10);
        const day = parseInt(s.slice(6, 8), 10);
        const hour = parseInt(s.slice(8, 10), 10);
        const min = parseInt(s.slice(10, 12), 10);
        const sec = parseInt(s.slice(12, 14), 10);
        return Date.UTC(year, month - 1, day, hour, min, sec);
    }

    function getTakeoutOfflineChat(chatId) {
        if (!chatId) return null;
        const nid = normId(chatId);
        return __takeoutConvCache[nid] || null;
    }

    function getTakeoutMediaForChat(chatId) {
        if (!chatId) return [];
        const nid = normId(chatId);
        return __takeoutMediaMap[nid] || [];
    }

    async function getTakeoutFallbackMedia(chatId, filenameOrId) {
        if (!filenameOrId) return null;
        const nid = normId(chatId);
        let target = String(filenameOrId).replace(/^.*[\\\/]/, '').trim();
        try { target = decodeURIComponent(target); } catch {}
        let targetStem = target.replace(/\.[^/.]+$/, '').toLowerCase();
        let cleanTargetStem = targetStem.replace(/^[0-9a-fA-F]{4,16}_+/, '').replace(/[-_][0-9a-fA-F]{6,16}$/i, '').trim();
        let cleanTarget = target.replace(/^[0-9a-fA-F]{4,16}_+/, '').trim();

        const convMedia = __takeoutMediaMap[nid];
        if (convMedia && convMedia.length) {
            for (const item of convMedia) {
                let itemFilename = item.filename;
                let itemStem = itemFilename.replace(/\.[^/.]+$/, '').toLowerCase();
                let cleanItemStem = itemStem.replace(/^[0-9a-fA-F]{4,16}_+/, '').replace(/[-_][0-9a-fA-F]{6,16}$/i, '').trim();
                if (itemFilename === target || itemFilename === cleanTarget || itemStem === cleanTargetStem || cleanItemStem === cleanTargetStem || cleanItemStem === targetStem || (cleanItemStem.length > 3 && cleanTargetStem.includes(cleanItemStem)) || (cleanTargetStem.length > 3 && cleanItemStem.includes(cleanTargetStem))) {
                    try {
                        let bin = await item.fileObj.async('uint8array');
                        if (bin && bin.length > 0) return bin;
                    } catch {}
                }
            }
            if (convMedia.length === 1 && (/^image(?:-\d+)?$/i.test(cleanTargetStem) || /^file/i.test(cleanTargetStem) || /^asset/i.test(cleanTargetStem))) {
                try {
                    let bin = await convMedia[0].fileObj.async('uint8array');
                    if (bin && bin.length > 0) return bin;
                } catch {}
            }
        }

        if (__takeoutGlobalMedia[cleanTargetStem] || __takeoutGlobalMedia[targetStem] || __takeoutGlobalMedia[cleanTarget] || __takeoutGlobalMedia[target]) {
            const fObj = __takeoutGlobalMedia[cleanTargetStem] || __takeoutGlobalMedia[targetStem] || __takeoutGlobalMedia[cleanTarget] || __takeoutGlobalMedia[target];
            try {
                let bin = await fObj.async('uint8array');
                if (bin && bin.length > 0) return bin;
            } catch {}
        }

        for (const [stem, fileObj] of Object.entries(__takeoutGlobalMedia)) {
            let cleanStem = stem.replace(/^[0-9a-fA-F]{4,16}_+/, '').replace(/[-_][0-9a-fA-F]{6,16}$/i, '').trim();
            if ((cleanStem.length > 4 && (cleanStem === cleanTargetStem || cleanStem.includes(cleanTargetStem) || cleanTargetStem.includes(cleanStem))) ||
                (stem.length > 4 && (stem === cleanTargetStem || stem.includes(cleanTargetStem) || cleanTargetStem.includes(stem)))) {
                try {
                    let bin = await fileObj.async('uint8array');
                    if (bin && bin.length > 0) return bin;
                } catch {}
            }
        }

        return null;
    }

    async function parseTakeoutZip(file, onProgress) {
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip 库未加载，无法解析 ZIP');
        }
        // ZipBomb 防护：单文件体积与条目数上限
        const MAX_ZIP_SIZE = 500 * 1024 * 1024; // 500MB
        const MAX_ENTRY_COUNT = 10000;
        const MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024; // 1GB 估算
        if (file && typeof file.size === 'number' && file.size > MAX_ZIP_SIZE) {
            throw new Error(`Takeout ZIP 体积过大 (${(file.size / 1024 / 1024).toFixed(1)}MB)，超过 ${MAX_ZIP_SIZE / 1024 / 1024}MB 上限，请确认是否为完整 Takeout 归档`);
        }
        if (onProgress) onProgress(15, '正在解压 Takeout 压缩包...');

        const zip = await JSZip.loadAsync(file);
        const entryCount = Object.keys(zip.files).length;
        if (entryCount > MAX_ENTRY_COUNT) {
            throw new Error(`ZIP 条目数过多 (${entryCount})，超过 ${MAX_ENTRY_COUNT} 上限，疑似 ZipBomb，已中止`);
        }
        // 估算未压缩体积（JSZip 内部 _data 未压缩长度）
        let approxUncompressed = 0;
        for (const f of Object.values(zip.files)) {
            if (!f.dir && f._data && typeof f._data.uncompressedSize === 'number') {
                approxUncompressed += f._data.uncompressedSize;
                if (approxUncompressed > MAX_TOTAL_UNCOMPRESSED) {
                    throw new Error(`ZIP 未压缩体积估算超过 1GB，已中止以防 OOM`);
                }
            }
        }
        if (onProgress) onProgress(40, '正在检索 Gemini / Bard 活动记录...');

        let activityFile = null;
        for (const filename of Object.keys(zip.files)) {
            if (zip.files[filename].dir) continue;
            if (/MyActivity\.html$/i.test(filename) && (/Gemini/i.test(filename) || /Bard/i.test(filename) || /我的活动/i.test(filename))) {
                activityFile = zip.files[filename];
                break;
            }
        }
        if (!activityFile) {
            for (const filename of Object.keys(zip.files)) {
                if (zip.files[filename].dir) continue;
                if (/MyActivity\.html$/i.test(filename) || /Gemini.*\.html$/i.test(filename) || /Bard.*\.html$/i.test(filename) || /我的活动.*\.html$/i.test(filename)) {
                    activityFile = zip.files[filename];
                    break;
                }
            }
        }

        if (!activityFile) {
            throw new Error(typeof I18n !== 'undefined' ? I18n.t('takeoutNotFound') : '未在 ZIP 中找到 Gemini / Bard 的活动记录 (MyActivity.html)');
        }

        const htmlText = await activityFile.async('text');
        if (onProgress) onProgress(70, typeof I18n !== 'undefined' ? I18n.t('takeoutParsingDetail') : '正在解析对话并建立离线媒体索引...');

        __takeoutMediaMap = {};
        __takeoutGlobalMedia = {};
        __takeoutConvCache = {};
        let totalMediaCount = 0;

        const watermarkedImages = [];
        for (const [path, fObj] of Object.entries(zip.files)) {
            if (fObj.dir || path.endsWith('.html') || path.endsWith('.json')) continue;
            let filename = path.replace(/^.*[\\\/]/, '').trim();
            let stem = filename.replace(/\.[^/.]+$/, '').toLowerCase();
            let cleanStem = stem.replace(/-[0-9a-fA-F]{16}$/i, '');
            __takeoutGlobalMedia[cleanStem] = fObj;
            __takeoutGlobalMedia[stem] = fObj;
            __takeoutGlobalMedia[filename] = fObj;
            totalMediaCount++;

            if (/watermarked_img_/i.test(filename)) {
                try {
                    const bin = await fObj.async('uint8array');
                    const c2paTime = extractC2PATimestamp(bin) || (fObj.date ? fObj.date.getTime() : null);
                    watermarkedImages.push({
                        filename,
                        stem,
                        cleanStem,
                        fileObj: fObj,
                        time: c2paTime
                    });
                } catch (e) {
                    watermarkedImages.push({
                        filename,
                        stem,
                        cleanStem,
                        fileObj: fObj,
                        time: fObj.date ? fObj.date.getTime() : null
                    });
                }
            }
        }

        const rawBlocks = htmlText.split('<div class="outer-cell');
        const extractedMap = {};
        const genBlocks = [];

        for (let i = 1; i < rawBlocks.length; i++) {
            const block = rawBlocks[i];
            const linkMatches = Array.from(block.matchAll(/https:\/\/(?:gemini|bard)\.google\.com\/(?:u\/\d+\/)?(?:app|chat)\/([a-zA-Z0-9_-]{8,64})/g));
            if (!linkMatches.length) continue;

            const foundIds = [];
            for (const lm of linkMatches) {
                const cleanId = normId(lm[1]);
                if (cleanId.length >= 8 && !foundIds.includes(cleanId)) {
                    foundIds.push(cleanId);
                }
            }
            if (!foundIds.length) continue;

            let promptText = '';
            let hasExplicitPrompt = false;
            const promptMatch = block.match(/(?:Prompted|已提示|提示|プロンプト|Demande|Preguntado)\s*([\s\S]*?)(?:<br\s*\/?>|\n)/i);
            if (promptMatch) {
                hasExplicitPrompt = true;
                promptText = promptMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[\u202f\xa0]/g, ' ').trim();
            } else {
                const contentCellMatchFallback = block.match(/<div class="content-cell[^>]*>([\s\S]*?)(?:<br\s*\/?>|\n)/i);
                if (contentCellMatchFallback) {
                    promptText = contentCellMatchFallback[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[\u202f\xa0]/g, ' ').trim();
                }
            }

            let ts = null;
            const timeMatchEn = block.match(/([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}(?::\d{2})?\s*[\u202f\s]*(?:AM|PM)\s*[A-Z]*)/);
            const timeMatchZh = block.match(/(\d{4}年\d{1,2}月\d{1,2}日[\s\u202f\xa0]*(?:上午|下午)?\s*\d{1,2}:\d{2}(?::\d{2})?)/);
            const timeMatchIso = block.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}[\sT]\d{1,2}:\d{2}(?::\d{2})?)/);

            if (timeMatchEn) {
                let rawT = timeMatchEn[1].replace(/[\u202f\xa0]/g, ' ').trim();
                const tzMap = {
                    'UTC': '+0000', 'GMT': '+0000',
                    'EDT': '-0400', 'EST': '-0500',
                    'CDT': '-0500', 'CST': '-0600',
                    'MDT': '-0600', 'MST': '-0700',
                    'PDT': '-0700', 'PST': '-0800',
                    'AKDT': '-0800', 'AKST': '-0900',
                    'HST': '-1000', 'HDT': '-0900',
                    'BST': '+0100', 'CET': '+0100', 'CEST': '+0200',
                    'EET': '+0200', 'EEST': '+0300',
                    'IST': '+0530', 'JST': '+0900',
                    'AEST': '+1000', 'AEDT': '+1100'
                };
                const tzMatch = rawT.match(/\s+([A-Z]{3,4})$/);
                let tzOffsetStr = '';
                if (tzMatch && tzMap[tzMatch[1]]) {
                    tzOffsetStr = ' GMT' + tzMap[tzMatch[1]];
                }
                let cleanT = rawT.replace(/\s+[A-Z]{3,4}$/, '').trim() + tzOffsetStr;
                let dt = new Date(cleanT);
                if (!isNaN(dt.getTime())) ts = dt.getTime();
            } else if (timeMatchZh) {
                let rawZh = timeMatchZh[1];
                let isPm = rawZh.includes('下午');
                let isAm = rawZh.includes('上午');
                // 移除 上午/下午标记后再解析，避免重复+12h导致次日错误
                let cleanZh = rawZh.replace(/上午|下午/g, '').replace(/[年月日]/g, (m) => m === '年' || m === '月' ? '-' : ' ')
                                   .replace(/[\u202f\xa0]/g, ' ').replace(/\s+/g, ' ').trim();
                let dt = new Date(cleanZh);
                if (!isNaN(dt.getTime())) {
                    let h = dt.getHours();
                    if (isPm && h < 12) dt.setHours(h + 12);
                    else if (isAm && h === 12) dt.setHours(0);
                    ts = dt.getTime();
                }
            } else if (timeMatchIso) {
                let dt = new Date(timeMatchIso[1].replace(/[\u202f\xa0]/g, ' '));
                if (!isNaN(dt.getTime())) ts = dt.getTime();
            }

            const hasGenMarker = /(?:(\d+)\s*generated images?|(\d+)\s*张生成的图片)/i.test(block);
            if (hasGenMarker && foundIds.length > 0 && ts) {
                for (const cid of foundIds) {
                    genBlocks.push({
                        chatId: cid,
                        time: ts,
                        prompt: promptText
                    });
                }
            }

            const contentCellMatch = block.match(/<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">([\s\S]*?)<\/div>/i);
            let responseHtml = '';
            if (contentCellMatch) {
                const rawCc = contentCellMatch[1];
                const parts = rawCc.split(/<br\s*\/?>|\n/);
                const respParts = [];
                let started = false;
                for (const p of parts) {
                    if (started) {
                        respParts.push(p);
                    } else if (/<p>|<pre>|<table>|<h1>|<h2>|<h3>|<ul>|<ol>|<strong>|<em>|<code>/i.test(p)) {
                        started = true;
                        respParts.push(p);
                    }
                }
                responseHtml = respParts.join('\n').trim();
            }

            const rawMediaMatches = block.match(/(?:src|href)=["']([^#"'>]+?)["']/gi) || [];
            const localMediaNames = [];
            for (const raw of rawMediaMatches) {
                const val = raw.replace(/^(?:src|href)=["']/, '').replace(/["']$/, '').trim();
                if (/^(?:https?:|\/\/|javascript:|mailto:|data:)/i.test(val) || /\.html?$/i.test(val)) continue;
                try {
                    const decoded = decodeURIComponent(val).replace(/^.*[\\\/]/, '').trim();
                    if (decoded && !localMediaNames.includes(decoded)) {
                        localMediaNames.push(decoded);
                    }
                } catch (e) {
                    const simpleName = val.replace(/^.*[\\\/]/, '').trim();
                    if (simpleName && !localMediaNames.includes(simpleName)) {
                        localMediaNames.push(simpleName);
                    }
                }
            }

            const turnMsgs = [];
            if (promptText) {
                const userMsg = {
                    role: 'user',
                    content: promptText,
                    timestamp: ts || Date.now()
                };
                if (localMediaNames.length > 0) {
                    userMsg.images = localMediaNames.map(name => ({
                        url: name,
                        name: name,
                        fileName: name,
                        localName: `assets/${name.replace(/[\\/:*?"<>|]/g, '_')}`,
                        source: 'takeout'
                    }));
                    userMsg.attachments = localMediaNames.map(name => ({
                        type: 'file',
                        url: name,
                        name: name,
                        fileName: name,
                        localName: `assets/${name.replace(/[\\/:*?"<>|]/g, '_')}`,
                        source: 'takeout'
                    }));
                }
                turnMsgs.push(userMsg);
            }
            if (responseHtml) {
                turnMsgs.push({
                    role: 'model',
                    content: responseHtml,
                    timestamp: (ts ? ts + 2000 : Date.now())
                });
            }

            for (const cleanId of foundIds) {
                if (!__takeoutMediaMap[cleanId]) __takeoutMediaMap[cleanId] = [];
                for (const refName of localMediaNames) {
                    const refStem = refName.replace(/\.[^/.]+$/, '').toLowerCase();
                    for (const [path, fObj] of Object.entries(zip.files)) {
                        if (fObj.dir) continue;
                        const zipFilename = path.replace(/^.*[\\\/]/, '').trim();
                        const zipStem = zipFilename.replace(/\.[^/.]+$/, '').toLowerCase();
                        if (zipFilename === refName || zipStem === refStem || zipFilename.endsWith(refName) || (refStem.length > 5 && zipStem.includes(refStem))) {
                            if (!__takeoutMediaMap[cleanId].some(x => x.filename === zipFilename)) {
                                __takeoutMediaMap[cleanId].push({ filename: zipFilename, fileObj: fObj });
                            }
                        }
                    }
                }

                const promptTitle = promptText ? promptText.split('\n')[0].slice(0, 80).trim() : 'Takeout conversation';
                if (!__takeoutConvCache[cleanId]) {
                    __takeoutConvCache[cleanId] = {
                        id: cleanId,
                        title: promptTitle,
                        titleSource: 'takeout',
                        titles: { takeout: promptTitle },
                        messages: [...turnMsgs],
                        timestamp: ts,
                        messageCount: turnMsgs.length,
                        attachmentCount: localMediaNames.length,
                        source: 'takeout-offline',
                        hasExplicitPrompt
                    };
                } else if (turnMsgs.length > 0) {
                    __takeoutConvCache[cleanId].messages.push(...turnMsgs);
                    __takeoutConvCache[cleanId].messageCount = __takeoutConvCache[cleanId].messages.length;
                    __takeoutConvCache[cleanId].attachmentCount = (__takeoutConvCache[cleanId].attachmentCount || 0) + localMediaNames.length;
                    if (hasExplicitPrompt && !__takeoutConvCache[cleanId].hasExplicitPrompt && promptTitle) {
                        __takeoutConvCache[cleanId].title = promptTitle;
                        __takeoutConvCache[cleanId].titles = __takeoutConvCache[cleanId].titles || {};
                        __takeoutConvCache[cleanId].titles.takeout = promptTitle;
                        __takeoutConvCache[cleanId].hasExplicitPrompt = true;
                    }
                }

                if (!extractedMap[cleanId]) {
                    extractedMap[cleanId] = {
                        id: cleanId,
                        title: promptTitle,
                        titleSource: 'takeout',
                        titles: { takeout: promptTitle },
                        url: `https://gemini.google.com/app/${cleanId}`,
                        href: `https://gemini.google.com/app/${cleanId}`,
                        timestamp: ts,
                        lastSeen: ts ? new Date(ts).toISOString() : '',
                        source: 'takeout-import',
                        messageCount: turnMsgs.length,
                        attachmentCount: localMediaNames.length,
                        hasExplicitPrompt
                    };
                } else {
                    extractedMap[cleanId].attachmentCount = (extractedMap[cleanId].attachmentCount || 0) + localMediaNames.length;
                    const cleanPrompt = promptText ? promptText.split('\n')[0].slice(0, 80).trim() : '';
                    const shouldUpdate = cleanPrompt && (
                        (hasExplicitPrompt && !extractedMap[cleanId].hasExplicitPrompt) ||
                        !extractedMap[cleanId].title ||
                        extractedMap[cleanId].title.startsWith('Untitled') ||
                        extractedMap[cleanId].title === 'Takeout conversation'
                    );
                    if (shouldUpdate) {
                        extractedMap[cleanId].title = cleanPrompt;
                        extractedMap[cleanId].titles = extractedMap[cleanId].titles || {};
                        extractedMap[cleanId].titles.takeout = cleanPrompt;
                        if (hasExplicitPrompt) extractedMap[cleanId].hasExplicitPrompt = true;
                        if (__takeoutConvCache[cleanId]) {
                            __takeoutConvCache[cleanId].title = cleanPrompt;
                            __takeoutConvCache[cleanId].titles = __takeoutConvCache[cleanId].titles || {};
                            __takeoutConvCache[cleanId].titles.takeout = cleanPrompt;
                            if (hasExplicitPrompt) __takeoutConvCache[cleanId].hasExplicitPrompt = true;
                        }
                    }
                    if (ts && (!extractedMap[cleanId].timestamp || ts > extractedMap[cleanId].timestamp)) {
                        extractedMap[cleanId].timestamp = ts;
                        extractedMap[cleanId].lastSeen = new Date(ts).toISOString();
                    }
                }
            }
        }

        // Correlate watermarked generated images with conversations
        if (watermarkedImages.length > 0 && genBlocks.length > 0) {
            function linkTakeoutGeneratedImage(chatId, img) {
                if (!__takeoutMediaMap[chatId]) __takeoutMediaMap[chatId] = [];
                if (!__takeoutMediaMap[chatId].some(x => x.filename === img.filename)) {
                    __takeoutMediaMap[chatId].push({
                        filename: img.filename,
                        fileObj: img.fileObj,
                        isGenerated: true
                    });
                }
                const imgObj = {
                    url: img.filename,
                    name: img.filename,
                    fileName: img.filename,
                    localName: `assets/${img.filename}`,
                    source: 'takeout',
                    isGenerated: true
                };
                const cached = __takeoutConvCache[chatId];
                if (cached && Array.isArray(cached.messages)) {
                    let modelTurn = cached.messages.find(m => m.role === 'model');
                    if (!modelTurn) {
                        modelTurn = {
                            role: 'model',
                            content: `![Generated Image](assets/${img.filename})`,
                            timestamp: img.time || (cached.timestamp ? cached.timestamp + 2000 : Date.now()),
                            images: [imgObj],
                            attachments: [imgObj]
                        };
                        cached.messages.push(modelTurn);
                    } else {
                        modelTurn.images = modelTurn.images || [];
                        modelTurn.attachments = modelTurn.attachments || [];
                        if (!modelTurn.images.some(im => im.fileName === img.filename)) {
                            modelTurn.images.push(imgObj);
                        }
                        if (!modelTurn.attachments.some(at => at.fileName === img.filename)) {
                            modelTurn.attachments.push(imgObj);
                        }
                        if (!modelTurn.content.includes(img.filename)) {
                            modelTurn.content = (modelTurn.content ? modelTurn.content + '\n\n' : '') + `![Generated Image](assets/${img.filename})`;
                        }
                    }
                    cached.attachmentCount = (cached.attachmentCount || 0) + 1;
                }
                if (extractedMap[chatId]) {
                    extractedMap[chatId].attachmentCount = (extractedMap[chatId].attachmentCount || 0) + 1;
                }
            }

            if (watermarkedImages.length === 1 && genBlocks.length === 1) {
                // Monopolistic Fallback
                linkTakeoutGeneratedImage(genBlocks[0].chatId, watermarkedImages[0]);
            } else {
                // C2PA Temporal Causal Matching
                for (const img of watermarkedImages) {
                    let bestBlock = null;
                    let minDiff = Infinity;
                    for (const gb of genBlocks) {
                        if (!gb.time || !img.time) continue;
                        const diff = img.time - gb.time;
                        // Allow diff between -5000ms (clock skew) and 120,000ms (2 minutes generation delay)
                        if (diff >= -5000 && diff <= 120000 && diff < minDiff) {
                            minDiff = diff;
                            bestBlock = gb;
                        }
                    }
                    if (bestBlock) {
                        linkTakeoutGeneratedImage(bestBlock.chatId, img);
                    }
                }
            }
        }

        const conversations = Object.values(extractedMap);
        if (onProgress) onProgress(100, `Takeout 解析完成，共发现 ${conversations.length} 条对话与 ${totalMediaCount} 个离线资源`);

        return {
            conversations,
            totalMediaCount,
            convCache: __takeoutConvCache,
            mediaMap: __takeoutMediaMap,
            globalMedia: __takeoutGlobalMedia
        };
    }

    function clearTakeoutData() {
        __takeoutMediaMap = {};
        __takeoutGlobalMedia = {};
        __takeoutConvCache = {};
    }

    return {
        getTakeoutOfflineChat,
        getTakeoutFallbackMedia,
        getTakeoutMediaForChat,
        extractC2PATimestamp,
        parseTakeoutZip,
        clearTakeoutData
    };
}));
