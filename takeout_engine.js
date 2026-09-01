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
        if (!id) return '';
        return String(id).replace(/^c_/, '').trim();
    }

    function getTakeoutOfflineChat(chatId) {
        if (!chatId) return null;
        const nid = normId(chatId);
        return __takeoutConvCache[nid] || null;
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
        if (onProgress) onProgress(15, '正在解压 Takeout 压缩包...');

        const zip = await JSZip.loadAsync(file);
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
            throw new Error('未在 ZIP 中找到 Gemini / Bard 的活动记录 (MyActivity.html)');
        }

        const htmlText = await activityFile.async('text');
        if (onProgress) onProgress(70, '正在解析对话并建立离线媒体索引...');

        __takeoutMediaMap = {};
        __takeoutGlobalMedia = {};
        __takeoutConvCache = {};
        let totalMediaCount = 0;

        for (const [path, fObj] of Object.entries(zip.files)) {
            if (fObj.dir || path.endsWith('.html') || path.endsWith('.json')) continue;
            let filename = path.replace(/^.*[\\\/]/, '').trim();
            let stem = filename.replace(/\.[^/.]+$/, '').toLowerCase();
            let cleanStem = stem.replace(/-[0-9a-fA-F]{16}$/i, '');
            __takeoutGlobalMedia[cleanStem] = fObj;
            __takeoutGlobalMedia[stem] = fObj;
            __takeoutGlobalMedia[filename] = fObj;
            totalMediaCount++;
        }

        const rawBlocks = htmlText.split('<div class="outer-cell');
        const extractedMap = {};

        for (let i = 1; i < rawBlocks.length; i++) {
            const block = rawBlocks[i];
            const linkMatches = Array.from(block.matchAll(/https:\/\/(?:gemini|bard)\.google\.com\/(?:u\/\d+\/)?(?:app|chat)\/([a-zA-Z0-9_-]{8,64})/g));
            if (!linkMatches.length) continue;

            const foundIds = [];
            for (const lm of linkMatches) {
                const fullId = lm[1].replace(/^c_/, '').trim();
                const cleanId = fullId.toLowerCase();
                if (cleanId.length >= 8 && !foundIds.includes(cleanId)) {
                    foundIds.push(cleanId);
                }
            }
            if (!foundIds.length) continue;

            let promptText = '';
            const promptMatch = block.match(/(?:Prompted|已提示|提示|プロンプト|Demande|Preguntado)\s*([\s\S]*?)(?:<br\s*\/?>|\n)/i)
                || block.match(/<div class="content-cell[^>]*>([\s\S]*?)(?:<br\s*\/?>|\n)/i);
            if (promptMatch) {
                promptText = promptMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[\u202f\xa0]/g, ' ').trim();
            }

            let ts = null;
            const timeMatchEn = block.match(/([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}(?::\d{2})?\s*[\u202f\s]*(?:AM|PM)\s*[A-Z]*)/);
            const timeMatchZh = block.match(/(\d{4}年\d{1,2}月\d{1,2}日[\s\u202f\xa0]*(?:上午|下午)?\s*\d{1,2}:\d{2}(?::\d{2})?)/);
            const timeMatchIso = block.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}[\sT]\d{1,2}:\d{2}(?::\d{2})?)/);

            if (timeMatchEn) {
                let cleanT = timeMatchEn[1].replace(/\s+[A-Z]{3,4}$/, '').replace(/[\u202f\xa0]/g, ' ').trim();
                let dt = new Date(cleanT);
                if (!isNaN(dt.getTime())) ts = dt.getTime();
            } else if (timeMatchZh) {
                let rawZh = timeMatchZh[1];
                let isPm = rawZh.includes('下午');
                let cleanZh = rawZh.replace(/[年月日上下]/g, (m) => m === '年' || m === '月' ? '-' : (m === '日' ? ' ' : ''))
                                   .replace(/[\u202f\xa0]/g, ' ').replace(/\s+/g, ' ').trim();
                let dt = new Date(cleanZh);
                if (!isNaN(dt.getTime())) {
                    ts = dt.getTime() + (isPm ? 12 * 3600 * 1000 : 0);
                }
            } else if (timeMatchIso) {
                let dt = new Date(timeMatchIso[1].replace(/[\u202f\xa0]/g, ' '));
                if (!isNaN(dt.getTime())) ts = dt.getTime();
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
                turnMsgs.push({
                    role: 'user',
                    content: promptText,
                    timestamp: ts || Date.now()
                });
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

                if (!__takeoutConvCache[cleanId]) {
                    __takeoutConvCache[cleanId] = {
                        id: cleanId,
                        title: promptText ? promptText.split('\n')[0].slice(0, 80) : 'Takeout conversation',
                        messages: [...turnMsgs],
                        timestamp: ts,
                        messageCount: turnMsgs.length,
                        source: 'takeout-offline'
                    };
                } else if (turnMsgs.length > 0) {
                    __takeoutConvCache[cleanId].messages.push(...turnMsgs);
                    __takeoutConvCache[cleanId].messageCount = __takeoutConvCache[cleanId].messages.length;
                }

                if (!extractedMap[cleanId]) {
                    extractedMap[cleanId] = {
                        id: cleanId,
                        title: promptText ? promptText.split('\n')[0].slice(0, 80) : 'Untitled conversation',
                        url: `https://gemini.google.com/app/${cleanId}`,
                        href: `https://gemini.google.com/app/${cleanId}`,
                        timestamp: ts,
                        lastSeen: ts ? new Date(ts).toISOString() : '',
                        source: 'takeout-import'
                    };
                } else {
                    if (promptText && (!extractedMap[cleanId].title || extractedMap[cleanId].title.startsWith('Untitled'))) {
                        extractedMap[cleanId].title = promptText.split('\n')[0].slice(0, 80);
                    }
                    if (ts && (!extractedMap[cleanId].timestamp || ts > extractedMap[cleanId].timestamp)) {
                        extractedMap[cleanId].timestamp = ts;
                        extractedMap[cleanId].lastSeen = new Date(ts).toISOString();
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
        parseTakeoutZip,
        clearTakeoutData
    };
}));
