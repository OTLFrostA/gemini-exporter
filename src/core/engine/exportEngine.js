// export_engine.js - Export engine for batch downloading, JSZip packaging, and FileSystem Access API
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ExportEngine = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function getExtensionVersion() {
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
                return chrome.runtime.getManifest().version || '1.3.8';
            }
        } catch {}
        return '1.3.8';
    }

    function sanitizeFileName(name, fallback = 'untitled') {
        if (typeof GeminiUtils !== 'undefined' && GeminiUtils.sanitizeFileName) {
            return GeminiUtils.sanitizeFileName(name, fallback);
        }
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.sanitizeFileName) {
            return globalThis.GeminiUtils.sanitizeFileName(name, fallback);
        }
        return (name || fallback).trim() || fallback;
    }

    function normId(id) {
        if (typeof GeminiUtils !== 'undefined' && GeminiUtils.normId) return GeminiUtils.normId(id);
        return String(id || '').replace(/^c_/, '').trim();
    }

    function cleanTitle(t) {
        if (typeof GeminiUtils !== 'undefined' && GeminiUtils.cleanTitle) return GeminiUtils.cleanTitle(t);
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.cleanTitle) return globalThis.GeminiUtils.cleanTitle(t);
        return (t || '').trim();
    }

    function isRealTitle(t, fallbackId) {
        if (typeof GeminiUtils !== 'undefined' && GeminiUtils.isRealTitle) return GeminiUtils.isRealTitle(t, fallbackId);
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.isRealTitle) return globalThis.GeminiUtils.isRealTitle(t, fallbackId);
        return !!(t && typeof t === 'string' && t.trim().length > 1);
    }

    function resolveTitle(chat) {
        if (typeof GeminiUtils !== 'undefined' && GeminiUtils.resolveTitle) return GeminiUtils.resolveTitle(chat);
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.resolveTitle) return globalThis.GeminiUtils.resolveTitle(chat);
        return { title: cleanTitle(chat?.title) || '未命名对话', source: chat?.titleSource || 'legacy' };
    }

    function toIso(v) {
        if (!v) return null;
        let ms = typeof v === 'number' ? v : new Date(v).getTime();
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }

    function sanitizeZipPath(p) {
        if (!p) return p;
        return p.split('/').map(seg => {
            if (!seg || seg === '.' || seg === '..') return '_';
            return sanitizeFileName(seg.replace(/\.\./g, '_'), 'file');
        }).filter(Boolean).join('/');
    }

    async function ensureSubDir(root, subPath) {
        if (typeof FsWriter !== 'undefined' && FsWriter.ensureSubDir) {
            return await FsWriter.ensureSubDir(root, subPath);
        }
        let cur = root;
        const parts = subPath.split('/').filter(Boolean).filter(p => p !== '.' && p !== '..').map(p => sanitizeFileName(p, 'dir'));
        for (let p of parts) {
            if (!p || p === '.' || p === '..') continue;
            cur = await cur.getDirectoryHandle(p, { create: true });
        }
        return cur;
    }

    async function getGeminiTab(slot) {
        if (typeof TabService !== 'undefined' && TabService.getGeminiTab) {
            return await TabService.getGeminiTab(slot);
        }
        return chrome.tabs.query({ url: 'https://gemini.google.com/*' }).then(tabs => {
            if (!tabs.length) return null;
            if (slot && slot !== 'u0') {
                const slotNum = slot.replace('u', '');
                const match = tabs.find(t => t.url && t.url.includes(`/u/${slotNum}/`));
                if (match) return match;
            } else if (slot === 'u0') {
                const defMatch = tabs.find(t => t.url && (!t.url.match(/\/u\/\d+\//) || t.url.includes('/u/0/')));
                if (defMatch) return defMatch;
            }
            return tabs.find(t => t.active) || tabs[0];
        });
    }

    class ExportEngine {
        constructor() {
            this.aborted = false;
            this._abortController = null;
        }

        abort() {
            this.aborted = true;
            try { this._abortController && this._abortController.abort(); } catch {}
            try {
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                    chrome.runtime.sendMessage({ action: 'cancelExport' }, () => {
                        if (chrome.runtime.lastError) {}
                    });
                }
            } catch {}
            try {
                chrome.storage.local.get(['gemini_last_export_session'], (data) => {
                    if (data?.gemini_last_export_session) {
                        chrome.storage.local.set({
                            gemini_last_export_session: {
                                ...data.gemini_last_export_session,
                                status: 'aborted',
                                updatedAt: Date.now()
                            }
                        });
                    }
                });
            } catch {}
        }

        async run(options, callbacks = {}) {
            const {
                selected = [],
                format = 'markdown',
                skip = false,
                includeIndex = true,
                includeAssets = true,
                useZip = true,
                dirHandle = null,
                currentSlot = 'u0',
                conversations = [],
                exportedIds = {},
                takeoutEngine = null
            } = options;

            const onProgress = callbacks.onProgress || (() => {});
            const onLog = callbacks.onLog || (() => {});
            const onTitleUpdated = callbacks.onTitleUpdated || (() => {});
            const onItemExported = callbacks.onItemExported || (() => {});

            this.aborted = false;
            this._abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const abortSignal = this._abortController ? this._abortController.signal : null;

            if (!selected.length) {
                throw new Error('No items selected');
            }

            let totalAssets = 0;
            let downloadedAssets = 0;
            let landedChats = 0;
            let failedChats = [];
            let failedAttachments = [];
            let skipped = 0;
            let metaResults = [];

            const payloadIds = selected.map(s => ({
                id: s.id,
                title: s.title,
                url: s.url || s.href || `https://gemini.google.com/app/${s.id}`,
                timestamp: s.timestamp,
                lastSeen: s.lastSeen
            }));

            const slot = currentSlot || 'u0';
            const Storage = (typeof StorageService !== 'undefined') ? StorageService : (globalThis.StorageService || null);
            let curIds = Storage ? await Storage.getExportedIds(slot) : {};
            if (!Storage) {
                const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
                const store = await chrome.storage.local.get([expKey]);
                curIds = store[expKey] || {};
            }

            // Record active export session
            try {
                await chrome.storage.local.set({
                    gemini_last_export_session: {
                        status: 'running',
                        slot,
                        total: payloadIds.length,
                        current: 0,
                        format,
                        useZip,
                        startTime: Date.now(),
                        updatedAt: Date.now()
                    }
                });
            } catch {}

            let batchDirHandle;
            let zip;
            let folder;
            const exportFolderName = 'gemini_export';

            if (useZip) {
                if (typeof JSZip === 'undefined') throw new Error('JSZip library not found');
                zip = new JSZip();
                folder = zip.folder(exportFolderName);
            } else {
                if (!dirHandle) throw new Error('Directory handle not provided');
                try {
                    // 持久句柄权限校验，过期则回退
                    if (dirHandle.queryPermission) {
                        const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
                        if (perm !== 'granted') {
                            const req = dirHandle.requestPermission ? await dirHandle.requestPermission({ mode: 'readwrite' }) : perm;
                            if (req !== 'granted') throw new Error('Directory permission not granted: ' + req);
                        }
                    }
                    if (dirHandle.name === exportFolderName) {
                        batchDirHandle = dirHandle;
                    } else {
                        batchDirHandle = await dirHandle.getDirectoryHandle(exportFolderName, { create: true });
                    }
                } catch (e) {
                    onLog(`创建子文件夹失败: ${e.message}`, 'warn');
                    if (e.name === 'NotAllowedError' || String(e.message).includes('permission')) {
                        onLog('目录句柄权限失效，请重新授权文件夹', 'warn');
                    }
                    throw new Error(`无法创建导出子目录 "${exportFolderName}": ${e.message}`);
                }
            }

            async function writeFileDirect(localName, data) {
                try {
                    // 防路径穿越：过滤 .. 与 .，且对每段 sanitize
                    const parts = localName.split('/').filter(Boolean).filter(p => p !== '.' && p !== '..');
                    let fileName = parts.pop();
                    fileName = sanitizeFileName(fileName, 'file');
                    if (fileName === '.' || fileName === '..') fileName = 'file';
                    const dirPath = parts.map(p => sanitizeFileName(p, 'dir')).filter(Boolean).join('/');
                    let targetDir = batchDirHandle;
                    if (dirPath) {
                        targetDir = await ensureSubDir(batchDirHandle, dirPath);
                    }
                    const fh = await targetDir.getFileHandle(fileName, { create: true });
                    const wr = await fh.createWritable();
                    await wr.write(data);
                    await wr.close();
                    return true;
                } catch (e) {
                    onLog(`保存文件失败 (${localName}): ${e.message}`, 'error');
                    return false;
                }
            }

            let currentExportTitle = '';
            let currentExportIdx = 0;

            const updateProgress = (chatIdx, chatTitle) => {
                if (typeof chatIdx === 'number') currentExportIdx = chatIdx;
                if (typeof chatTitle === 'string' && chatTitle) currentExportTitle = chatTitle;

                const totalChats = payloadIds.length;
                const current = Math.min(currentExportIdx, totalChats);
                let pct = totalChats ? Math.floor((current / totalChats) * 100) : 0;

                if (totalAssets > 0 && downloadedAssets > 0 && pct < 100) {
                    const chatWeight = 0.75;
                    const assetWeight = 0.25;
                    const chatFraction = totalChats ? (current / totalChats) : 0;
                    const assetFraction = Math.min(1, downloadedAssets / totalAssets);
                    pct = Math.min(99, Math.floor((chatFraction * chatWeight + assetFraction * assetWeight) * 100));
                }

                onProgress({
                    current,
                    total: totalChats,
                    pct,
                    title: currentExportTitle,
                    assetsDownloaded: downloadedAssets,
                    assetsTotal: totalAssets
                });
            };

            updateProgress(0, 'Preparing...');

            let attachmentQueue = [];
            let isFetchingDone = false;
            let activeDownloads = 0;
            const MAX_CONCURRENT = 4;

            const processAttachmentQueue = async () => {
                while (!this.aborted && !(abortSignal && abortSignal.aborted) && (!isFetchingDone || attachmentQueue.length > 0)) {
                    if (this.aborted || (abortSignal && abortSignal.aborted)) break;
                    if (attachmentQueue.length === 0 || activeDownloads >= MAX_CONCURRENT) {
                        // 可中断的等待
                        await new Promise(r => {
                            let t = setTimeout(r, 100);
                            if (abortSignal) abortSignal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
                        });
                        continue;
                    }
                    if (abortSignal && abortSignal.aborted) break;
                    const task = attachmentQueue.shift();
                    activeDownloads++;
                    try {
                        await task();
                    } catch (e) {
                        if (abortSignal && abortSignal.aborted) break;
                    }
                    activeDownloads--;
                }
            };

            const consumerPool = [];
            for (let i = 0; i < MAX_CONCURRENT; i++) {
                consumerPool.push(processAttachmentQueue());
            }

            const pendingAssetsPerChat = new Map();
            const chatRecordsMap = new Map();
            const chatFailedAssetsSet = new Set();

            async function finalizeChatExport(targetId) {
                const targetNid = normId(targetId);
                const rec = chatRecordsMap.get(targetNid);
                if (!rec || chatFailedAssetsSet.has(targetNid)) return;
                curIds[targetId] = rec;
                curIds[targetNid] = rec;
                curIds['c_' + targetNid] = rec;
                exportedIds[targetId] = rec;
                exportedIds[targetNid] = rec;
                exportedIds['c_' + targetNid] = rec;
                if (Storage) {
                    await Storage.saveExportRecord(slot, targetId, rec);
                } else {
                    const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
                    chrome.storage.local.set({ [expKey]: curIds });
                }
                onItemExported(targetId, rec);
            }

            const isRealTitle = (() => {
                try {
                    if (typeof GeminiUtils !== 'undefined' && GeminiUtils.isRealTitle) return GeminiUtils.isRealTitle;
                    if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.isRealTitle) return globalThis.GeminiUtils.isRealTitle;
                    if (typeof globalThis !== 'undefined' && typeof globalThis.isRealTitle === 'function') return globalThis.isRealTitle;
                } catch {}
                return (t, id) => Boolean(t && typeof t === 'string' && t.trim().length >= 2 && t !== 'Untitled' && t !== '未命名');
            })();

            const CONCURRENCY = 3;
            let nextIndex = 0;
            let completedCount = 0;
            let convsNeedSave = false;

            const exportWorker = async () => {
                while (nextIndex < payloadIds.length && !this.aborted && !(abortSignal && abortSignal.aborted)) {
                    const currentIndex = nextIndex++;
                    const requestedItem = payloadIds[currentIndex];
                    if (!requestedItem) break;

                    const nid = normId(requestedItem.id);
                    let res = await new Promise(resolve => {
                        let settled = false;
                        const onAbort = () => {
                            if (!settled) {
                                settled = true;
                                resolve({ success: false, error: 'aborted' });
                            }
                        };
                        if (abortSignal) {
                            if (abortSignal.aborted) return onAbort();
                            abortSignal.addEventListener('abort', onAbort, { once: true });
                        }
                        chrome.runtime.sendMessage({
                            action: 'fetchBatch',
                            ids: [requestedItem],
                            format,
                            skipExported: skip,
                            globalOffset: currentIndex,
                            globalTotal: payloadIds.length,
                            accountSlot: currentSlot
                        }, (response) => {
                            if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
                            if (!settled) {
                                settled = true;
                                if (chrome.runtime.lastError) {
                                    resolve({ success: false, error: chrome.runtime.lastError.message });
                                } else {
                                    resolve(response);
                                }
                            }
                        });
                    });

                    if (this.aborted || (abortSignal && abortSignal.aborted)) break;

                    if (!res || !res.success) {
                        const fetchErr = res ? res.error : 'unknown';
                        onLog(typeof I18n !== 'undefined' ? I18n.t('logFetchFailed', fetchErr) : `抓取对话失败: ${fetchErr}`, 'warn');
                        failedChats.push({ id: requestedItem.id, title: requestedItem.title || requestedItem.id, error: fetchErr });
                        onLog(typeof I18n !== 'undefined' ? I18n.t('logExportSkipped', requestedItem.title || requestedItem.id, fetchErr) : `[${requestedItem.title || requestedItem.id}] 导出跳过: ${fetchErr}`, 'warn');
                        completedCount++;
                        updateProgress(completedCount, requestedItem.title || requestedItem.id);
                        continue;
                    }

                    skipped += (res.skipped || 0);
                    const chunkResults = res.results || [];
                    let chat = chunkResults[0] || { id: nid, title: requestedItem.title };
                    chat.id = nid;

                    // Takeout offline chat fallback
                    if ((chat.error || chat._empty || !chat.messages || chat.messages.length === 0) && takeoutEngine) {
                        const fbChat = takeoutEngine.getTakeoutOfflineChat(nid);
                        if (fbChat && fbChat.messages && fbChat.messages.length > 0) {
                            chat = {
                                ...fbChat,
                                id: nid,
                                title: isRealTitle(chat.title, nid) ? chat.title : fbChat.title,
                                url: `https://gemini.google.com/app/${nid}`
                            };
                            delete chat.error;
                            delete chat._empty;
                            onLog(typeof I18n !== 'undefined' ? I18n.t('logTakeoutChatRecovered', chat.title || nid) : `[${chat.title || nid}] ⚡ 已自动从 Takeout 离线记录恢复问答并导出`, 'info');
                        }
                    }

                    // Supplement missing offline generated media from Takeout into chat.messages if present
                    if (takeoutEngine && typeof takeoutEngine.getTakeoutMediaForChat === 'function' && Array.isArray(chat.messages) && chat.messages.length > 0) {
                        const takeoutMedia = takeoutEngine.getTakeoutMediaForChat(nid);
                        if (takeoutMedia && takeoutMedia.length > 0) {
                            for (const tm of takeoutMedia) {
                                const alreadyHas = chat.messages.some(m => 
                                    (m.images && m.images.some(im => im.fileName === tm.filename || (im.localName && im.localName.includes(tm.filename)))) ||
                                    (m.attachments && m.attachments.some(at => at.fileName === tm.filename || (at.localName && at.localName.includes(tm.filename)))) ||
                                    (m.content && m.content.includes(tm.filename))
                                );
                                if (!alreadyHas) {
                                    const imgObj = {
                                        url: tm.filename,
                                        name: tm.filename,
                                        fileName: tm.filename,
                                        localName: `assets/${tm.filename}`,
                                        source: 'takeout',
                                        isGenerated: true
                                    };
                                    let targetModelMsg = chat.messages.slice().reverse().find(m => m.role === 'model');
                                    if (targetModelMsg) {
                                        targetModelMsg.images = targetModelMsg.images || [];
                                        targetModelMsg.attachments = targetModelMsg.attachments || [];
                                        targetModelMsg.images.push(imgObj);
                                        targetModelMsg.attachments.push(imgObj);
                                        if (!targetModelMsg.content.includes(tm.filename)) {
                                            targetModelMsg.content = (targetModelMsg.content ? targetModelMsg.content + '\n\n' : '') + `![Generated Image](assets/${tm.filename})`;
                                        }
                                    } else {
                                        chat.messages.push({
                                            role: 'model',
                                            content: `![Generated Image](assets/${tm.filename})`,
                                            timestamp: Date.now(),
                                            images: [imgObj],
                                            attachments: [imgObj]
                                        });
                                    }
                                }
                            }
                        }
                    }

                    if (chat.error || chat._empty) {
                        const isConfirmedDeleted = !!chat.isDeleted || !!chat._debug?.isNotFound || !!chat._debug?.domDebug?.isNotFound;
                        const cleanForLog = t => String(t||'').replace(/[\u200E\u200B\uFEFF\u00A0]/g,'').trim();
                        const rawTitle = chat.title || nid;
                        const displayTitle = cleanForLog(rawTitle) && !/^(Google\s+)?(Gemini|Bard|Google\s+AI|Google\s+Account)$/i.test(cleanForLog(rawTitle)) ? cleanForLog(rawTitle) : nid;
                        const debugInfo = chat._debug ? ` _debug=${String(chat._debug).slice(0,200)}` : (chat._raw ? ` _raw_len=${JSON.stringify(chat._raw).length}` : '');
                        const errMsg = (isConfirmedDeleted ? '云端会话已被删除或不存在' : (chat.error || '云端返回内容为空（服务端未返回任何消息，可能为限频、对话已被清空/归档或新格式未兼容）')) + debugInfo;

                        if (isConfirmedDeleted) {
                            try {
                                const storage = typeof StorageService !== 'undefined' ? StorageService : (typeof window !== 'undefined' && window.StorageService);
                                if (storage && typeof storage.removeConversation === 'function') {
                                    await storage.removeConversation(accountSlot || 'u0', nid);
                                    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                                        const p = chrome.runtime.sendMessage({ action: 'syncUpdate', slot: accountSlot || 'u0', count: -1, from: 'export-prune-deleted' });
                                        if (p && p.catch) p.catch(() => {});
                                    }
                                }
                            } catch {}
                            onLog(typeof I18n !== 'undefined' ? I18n.t('logChatDeletedAndPruned', displayTitle) : `[${displayTitle}] ⚡ 云端已确认该会话不存在或已被删除，已自动从本地列表中移除`, 'warn');
                        } else {
                            onLog(typeof I18n !== 'undefined' ? I18n.t('logExportSkipped', displayTitle, errMsg) : `[${displayTitle}] 导出跳过: ${errMsg}`, 'error');
                        }

                        failedChats.push({ id: chat.id || nid, title: displayTitle, error: errMsg, debug: chat._debug || null, raw: chat._raw || null, isDeleted: isConfirmedDeleted });
                        console.warn('[Gemini Exporter] export empty detail', nid, errMsg, 'chat keys', Object.keys(chat || {}));
                        completedCount++;
                        updateProgress(completedCount, displayTitle);
                        continue;
                    }

                    const listC = conversations.find(c => normId(c.id) === nid) || null;

                    if (!isRealTitle(chat.title, chat.id) && Array.isArray(chat.messages)) {
                        const firstUser = chat.messages.find(m => m.role === 'user' && m.content && m.content.trim());
                        if (firstUser) {
                            let candidate = firstUser.content.trim();
                            candidate = candidate.replace(/^(请问一下|请问|我想问一下|我想问|你能帮我|帮我|你能|请教一下|请教|都说|那么|那个|如果说|如果|我发现|为什么)\s*[,，:：]?\s*/i, '');
                            const breakMatch = candidate.match(/^([^，。？！\n\r\t,?!]{4,35})/);
                            if (breakMatch && breakMatch[1]) {
                                candidate = breakMatch[1].trim();
                            } else {
                                candidate = candidate.slice(0, 30).trim();
                            }
                            if (isRealTitle(candidate, chat.id)) {
                                chat.title = candidate;
                                chat.titleSource = 'sniff';
                                chat.titles = chat.titles || {};
                                chat.titles.sniff = candidate;
                            }
                        }
                    }

                    let finalTitle = chat.title || listC?.title || chat.id;

                    if (listC) {
                        // 防御：绝不允许 "Google Gemini" 等品牌词覆盖已有标题（含 U+200E 隐形字符）
                        const cleanForBad = t => String(t||'').replace(/[\u200E\u200B\uFEFF\u00A0]/g,'').trim();
                        const isBadBrand = t => !t || /^(Google\s+)?(Gemini|Bard|Google\s+AI|Google\s+Account)$/i.test(cleanForBad(t));
                        listC.titles = listC.titles || {};
                        for (const [k,v] of Object.entries(listC.titles)) {
                            if (isBadBrand(v)) delete listC.titles[k];
                        }
                        if (chat.titles && typeof chat.titles === 'object') {
                            for (const [k,v] of Object.entries(chat.titles)) {
                                if (isBadBrand(v)) delete chat.titles[k];
                            }
                            Object.assign(listC.titles, chat.titles);
                        }
                        if (chat.titleSource && isRealTitle(chat.title, chat.id) && chat.title !== chat.id) {
                            listC.titles[chat.titleSource] = cleanTitle(chat.title);
                        }
                        const resolved = resolveTitle(listC);
                        const cleanResolved = String(resolved.title||'').replace(/[\u200E\u200B\uFEFF\u00A0]/g,'').trim();
                        if (resolved.title && /^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(cleanResolved)) {
                            console.warn('[Export] skip bad brand resolved title', nid, resolved.title);
                        } else if (listC.title !== resolved.title || listC.titleSource !== resolved.source) {
                            listC.title = resolved.title;
                            listC.titleSource = resolved.source;
                            convsNeedSave = true;
                            onTitleUpdated(nid, listC.title, listC.titleSource);
                        }
                        finalTitle = listC.title;
                    } else if (isRealTitle(chat.title, chat.id)) {
                        finalTitle = cleanTitle(chat.title);
                    }
                    chat.title = finalTitle;
                    const listTitle = finalTitle;

                    const formatted = typeof ChatFormatter !== 'undefined' && ChatFormatter.formatContent
                        ? ChatFormatter.formatContent(chat, format)
                        : { content: JSON.stringify(chat, null, 2), ext: 'json' };

                    const content = formatted.content;
                    const ext = formatted.ext;
                    const safeBase = sanitizeFileName(listTitle, chat.id);
                    const fileName = `${safeBase}_${chat.id.slice(-6)}.${ext}`;

                    let writeOk = true;
                    if (useZip) {
                        folder.file(fileName, content);
                    } else {
                        writeOk = await writeFileDirect(fileName, content);
                    }

                    let queuedAssetsForThisChat = 0;
                    if (includeAssets && chat.messages && writeOk) {
                        for (const m of chat.messages) {
                            if (m.attachments && m.attachments.length) {
                                for (const att of m.attachments) {
                                    if (att.type !== 'file') continue;
                                    if ((att.url && att.url.includes('immersive_entry_chip')) && !att.contentMarkdown) continue;
                                    if (att.contentMarkdown) {
                                        if (att.contentMarkdown.includes('immersive_entry_chip') || att.contentMarkdown.includes('googleusercontent.com/immersive')) {
                                            continue;
                                        }
                                        totalAssets++;
                                        queuedAssetsForThisChat++;
                                        updateProgress();
                                        if (useZip) {
                                            try {
                                                folder.file(sanitizeZipPath(att.localName), att.contentMarkdown);
                                                downloadedAssets++;
                                                updateProgress();
                                                const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                                pendingAssetsPerChat.set(nid, left);
                                                if (left === 0) finalizeChatExport(chat.id);
                                            } catch {}
                                        } else {
                                            attachmentQueue.push(async () => {
                                                const ok = await writeFileDirect(att.localName || `${safeBase}_${chat.id.slice(-6)}.md`, att.contentMarkdown);
                                                if (ok) {
                                                    downloadedAssets++;
                                                    updateProgress();
                                                    const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                                    pendingAssetsPerChat.set(nid, left);
                                                    if (left === 0) finalizeChatExport(chat.id);
                                                } else {
                                                    chatFailedAssetsSet.add(nid);
                                                }
                                            });
                                        }
                                        continue;
                                    }

                                    totalAssets++;
                                    queuedAssetsForThisChat++;
                                    updateProgress();
                                    attachmentQueue.push(async () => {
                                        let saved = false;
                                        let failReason = '';
                                        try {
                                            let tab = await getGeminiTab(currentSlot);
                                            if (tab) {
                                                let candidates = [att.url, att.sourceUrl, att.src].filter(Boolean);
                                                let candidateUrl = candidates[0];
                                                if (candidateUrl) {
                                                    let r = await new Promise(resolve => {
                                                        chrome.tabs.sendMessage(tab.id, {
                                                            action: 'downloadAssetDirect',
                                                            url: candidateUrl,
                                                            referer: `https://gemini.google.com/app/${chat.id}`
                                                        }, (resp) => {
                                                            if (chrome.runtime.lastError) {
                                                                resolve({ success: false, error: chrome.runtime.lastError.message });
                                                            } else {
                                                                resolve(resp);
                                                            }
                                                        });
                                                    });
                                                    if (r && r.success && r.dataBase64) {
                                                        if (useZip) {
                                                            folder.file(sanitizeZipPath(att.localName), r.dataBase64, { base64: true });
                                                            saved = true;
                                                        } else {
                                                            const binStr = atob(r.dataBase64);
                                                            const len = binStr.length;
                                                            const bytes = new Uint8Array(len);
                                                            for (let k = 0; k < len; k++) bytes[k] = binStr.charCodeAt(k);
                                                            saved = await writeFileDirect(att.localName, bytes);
                                                        }
                                                    } else {
                                                        failReason = r ? r.error : 'downloadAssetDirect failed';
                                                    }
                                                }
                                            }
                                        } catch (e) {
                                            failReason = e.message;
                                        }

                                        // Fallback to Takeout offline pool
                                        if (!saved && takeoutEngine) {
                                            try {
                                                let offlineBin = await takeoutEngine.getTakeoutFallbackMedia(chat.id, att.localName || att.fileName || att.title);
                                                if (offlineBin && offlineBin.length > 0) {
                                                    if (useZip) {
                                                        folder.file(sanitizeZipPath(att.localName), offlineBin);
                                                        saved = true;
                                                    } else {
                                                        saved = await writeFileDirect(att.localName, offlineBin);
                                                    }
                                                    if (saved) {
                                                        onLog(typeof I18n !== 'undefined' ? I18n.t('logTakeoutAssetRecovered', chat.title || chat.id, att.localName) : `[${chat.title || chat.id}] ⚡ 附件从 Takeout 离线池补全成功: ${att.localName}`, 'info');
                                                    }
                                                }
                                            } catch (takeoutErr) {}
                                        }

                                        if (saved) {
                                            downloadedAssets++;
                                            updateProgress();
                                            const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                            pendingAssetsPerChat.set(nid, left);
                                            if (left === 0) finalizeChatExport(chat.id);
                                        } else {
                                            chatFailedAssetsSet.add(nid);
                                            failedAttachments.push({ chatId: chat.id, chatTitle: listTitle || chat.title || chat.id, file: att.localName || att.fileName, error: failReason || 'CDN auth expired' });
                                            onLog(typeof I18n !== 'undefined' ? I18n.t('logAssetFailed', chat.title || chat.id, att.localName || att.fileName, failReason || 'CDN auth expired') : `[${chat.title || chat.id}] 附件获取失败 (${att.localName || att.fileName}): ${failReason || 'CDN鉴权过期或资源不可达'}`, 'warn');
                                        }
                                    });
                                }
                            }

                            if (m.images && m.images.length) {
                                for (const img of m.images) {
                                    totalAssets++;
                                    queuedAssetsForThisChat++;
                                    updateProgress();
                                    attachmentQueue.push(async () => {
                                        let saved = false;
                                        let failReason = '';
                                        const targetUrl = img.resolvedUrl || img.sourceUrl;
                                        try {
                                            let tab = await getGeminiTab(currentSlot);
                                            if (tab && targetUrl) {
                                                let r = await new Promise(resolve => {
                                                    chrome.tabs.sendMessage(tab.id, {
                                                        action: 'downloadAssetDirect',
                                                        url: targetUrl,
                                                        referer: `https://gemini.google.com/app/${chat.id}`
                                                    }, (resp) => {
                                                        if (chrome.runtime.lastError) {
                                                            resolve({ success: false, error: chrome.runtime.lastError.message });
                                                        } else {
                                                            resolve(resp);
                                                        }
                                                    });
                                                });
                                                if (r && r.success && r.dataBase64) {
                                                    if (useZip) {
                                                        folder.file(sanitizeZipPath(img.localName), r.dataBase64, { base64: true });
                                                        saved = true;
                                                    } else {
                                                        const binStr = atob(r.dataBase64);
                                                        const len = binStr.length;
                                                        const bytes = new Uint8Array(len);
                                                        for (let k = 0; k < len; k++) bytes[k] = binStr.charCodeAt(k);
                                                        saved = await writeFileDirect(img.localName, bytes);
                                                    }
                                                } else {
                                                    failReason = r ? r.error : 'image direct download failed';
                                                }
                                            }
                                        } catch (e) {
                                            failReason = e.message;
                                        }

                                        if (!saved && takeoutEngine) {
                                            try {
                                                let offlineBin = await takeoutEngine.getTakeoutFallbackMedia(chat.id, img.localName || img.fileName);
                                                if (offlineBin && offlineBin.length > 0) {
                                                    if (useZip) {
                                                        folder.file(sanitizeZipPath(img.localName), offlineBin);
                                                        saved = true;
                                                    } else {
                                                        saved = await writeFileDirect(img.localName, offlineBin);
                                                    }
                                                    if (saved) {
                                                        onLog(typeof I18n !== 'undefined' ? I18n.t('logTakeoutImageRecovered', chat.title || chat.id, img.localName) : `[${chat.title || chat.id}] ⚡ 图片从 Takeout 离线池补全成功: ${img.localName}`, 'info');
                                                    }
                                                }
                                            } catch (takeoutErr) {}
                                        }

                                        if (saved) {
                                            downloadedAssets++;
                                            updateProgress();
                                            const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                            pendingAssetsPerChat.set(nid, left);
                                            if (left === 0) finalizeChatExport(chat.id);
                                        } else {
                                            chatFailedAssetsSet.add(nid);
                                            failedAttachments.push({ chatId: chat.id, chatTitle: listTitle || chat.title || chat.id, file: img.localName, error: failReason || 'CDN auth expired' });
                                            onLog(typeof I18n !== 'undefined' ? I18n.t('logImageFailed', chat.title || chat.id, img.localName, failReason || 'CDN auth expired') : `[${chat.title || chat.id}] 图片获取失败 (${img.localName}): ${failReason || 'CDN鉴权过期或资源不可达'}`, 'warn');
                                        }
                                    });
                                }
                            }
                        }
                    }

                    if (writeOk) {
                        landedChats++;
                        onLog(typeof I18n !== 'undefined' ? I18n.t('logExportSuccess', listTitle, fileName) : `[${listTitle}] ✓ 文本导出成功 (${fileName})`, 'info');
                        if (!chat.error && !chat._empty) {
                            let exportTs = listC?.timestamp || chat.timestamp || Date.now();
                            if (typeof exportTs === 'string') exportTs = new Date(exportTs).getTime();
                            const record = {
                                title: listTitle,
                                exportedAt: new Date().toISOString(),
                                messageCount: chat.messageCount || chat.messages?.length || 0,
                                chatTime: exportTs,
                                status: 'ok'
                            };
                            chatRecordsMap.set(nid, record);
                            if (queuedAssetsForThisChat === 0) {
                                finalizeChatExport(chat.id);
                            } else {
                                pendingAssetsPerChat.set(nid, queuedAssetsForThisChat);
                            }
                        }
                    }

                    metaResults.push({
                        id: chat.id,
                        title: listTitle,
                        url: chat.url || `https://gemini.google.com/app/${chat.id}`,
                        createdAt: toIso(chat.createdAt || chat.timestamp || listC?.timestamp),
                        updatedAt: toIso(chat.updatedAt || chat.timestamp || listC?.timestamp),
                        messageCount: chat.messages ? chat.messages.length : (chat.messageCount || 0),
                        attachmentCount: queuedAssetsForThisChat || chat.attachmentCount || 0,
                        exportFile: fileName,
                        status: writeOk ? 'success' : 'failed'
                    });

                    completedCount++;
                    updateProgress(completedCount, listTitle);

                    try {
                        await chrome.storage.local.set({
                            gemini_last_export_session: {
                                status: 'running',
                                slot,
                                total: payloadIds.length,
                                current: completedCount,
                                lastChatId: chat.id,
                                lastChatTitle: listTitle,
                                format,
                                useZip,
                                updatedAt: Date.now()
                            }
                        });
                    } catch {}
                }
            };

            const exportWorkers = [];
            const workerCount = Math.min(CONCURRENCY, payloadIds.length);
            for (let w = 0; w < workerCount; w++) {
                exportWorkers.push(exportWorker());
            }
            await Promise.all(exportWorkers);

            if (convsNeedSave) {
                if (Storage) {
                    await Storage.setConversations(slot, conversations);
                } else {
                    const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
                    chrome.storage.local.set({ [convKey]: conversations });
                }
            }

            isFetchingDone = true;
            try {
                await Promise.all(consumerPool);
            } catch (e) {
                if (this.aborted) onLog(typeof I18n !== 'undefined' ? I18n.t('logAssetsAborted') : '附件下载因终止而中断', 'warn');
            }

            if (includeIndex && metaResults.length > 0) {
                const isZh = typeof I18n !== 'undefined' && I18n.getLang() === 'zh';
                let indexContent = isZh
                    ? `# Gemini 对话索引目录 (Export Index)\n\n> 导出时间: ${new Date().toLocaleString()} · 总会话数: ${landedChats} · 附件数: ${downloadedAssets}/${totalAssets}\n\n| 对话标题 (Title) | 消息数 | 附件 | 原始链接 (URL) | 导出文件 |\n| :--- | :--- | :--- | :--- | :--- |\n`
                    : `# Gemini Conversation Export Index\n\n> Export Time: ${new Date().toLocaleString()} · Total Chats: ${landedChats} · Assets: ${downloadedAssets}/${totalAssets}\n\n| Conversation Title | Messages | Assets | Original URL | Exported File |\n| :--- | :--- | :--- | :--- | :--- |\n`;
                for (const meta of metaResults) {
                    const safeT = meta.title.replace(/\|/g, '\\|');
                    const linkText = isZh ? '🔗 原文' : '🔗 Link';
                    indexContent += `| **[${safeT}](${meta.exportFile})** | ${meta.messageCount} | ${meta.attachmentCount} | [${linkText}](${meta.url}) | \`${meta.exportFile}\` |\n`;
                }
                indexContent += `\n---\n_Generated by Gemini Exporter at ${new Date().toISOString()}_\n`;

                if (useZip) {
                    folder.file('00_INDEX.md', indexContent);
                    folder.file('meta.json', JSON.stringify({
                        exportedAt: new Date().toISOString(),
                        version: getExtensionVersion(),
                        total: metaResults.length,
                        conversations: metaResults
                    }, null, 2));
                } else {
                    await writeFileDirect('00_INDEX.md', indexContent);
                    await writeFileDirect('meta.json', JSON.stringify({
                        exportedAt: new Date().toISOString(),
                        version: getExtensionVersion(),
                        total: metaResults.length,
                        conversations: metaResults
                    }, null, 2));
                }
            }

            // 🛠️ 开发者模式或有错误发生时，自动将全部会话日志与错误详情写入导出目录
            let isDevMode = false;
            try {
                const devData = await chrome.storage.local.get(['gemini_dev_mode']);
                isDevMode = !!devData?.gemini_dev_mode;
            } catch {}

            if (isDevMode || failedChats.length > 0 || failedAttachments.length > 0) {
                let fullLogText = `=======================================================\n`;
                fullLogText += ` Gemini Exporter Session Log${isDevMode ? ' (Dev Mode)' : ' (Error Report)'}\n`;
                fullLogText += ` Time: ${new Date().toISOString()}\n`;
                fullLogText += ` Summary: Landed ${landedChats}/${payloadIds.length} chats, Assets ${downloadedAssets}/${totalAssets}, Skipped ${skipped}\n`;
                fullLogText += ` Failed Chats: ${failedChats.length}, Failed Assets: ${failedAttachments.length}\n`;
                fullLogText += `=======================================================\n\n`;

                if (failedChats.length > 0) {
                    fullLogText += `[FAILED CONVERSATIONS]\n`;
                    for (const fc of failedChats) {
                        if (typeof fc === 'string') {
                            fullLogText += `  - ${fc}\n`;
                        } else {
                            const fcId = fc.id || fc.chatId || 'unknown';
                            const fcTitle = (fc.title || fc.chatTitle || '').slice(0, 60);
                            const fcErr = fc.error || fc.reason || 'unknown';
                            fullLogText += `  - ${fcId} | "${fcTitle}" | ${fcErr}\n`;
                            // Include structured debug block if available (new format)
                            if (fc.debug && typeof fc.debug === 'object') {
                                try {
                                    fullLogText += `    [debug] ${JSON.stringify(fc.debug).slice(0, 800)}\n`;
                                } catch {}
                            } else if (fc.raw && typeof fc.raw === 'object') {
                                try {
                                    fullLogText += `    [raw_preview] ${JSON.stringify(fc.raw).slice(0, 400)}\n`;
                                } catch {}
                            }
                        }
                    }
                    fullLogText += `\n`;
                }

                if (failedAttachments.length > 0) {
                    fullLogText += `[FAILED ASSETS / ATTACHMENTS]\n`;
                    for (const fa of failedAttachments) {
                        fullLogText += `  - Chat: "${fa.chatTitle || fa.chatId || fa.chat}" | File: "${fa.file}" | Reason: ${fa.error || fa.reason}\n`;
                    }
                    fullLogText += `\n`;
                }

                // Full structured JSON dump (always in dev mode, only errors otherwise)
                const sessionJson = {
                    exportedAt: new Date().toISOString(),
                    isDevMode,
                    summary: {
                        total: payloadIds.length,
                        landed: landedChats,
                        failed: failedChats.length,
                        skipped,
                        assetsTotal: totalAssets,
                        assetsDownloaded: downloadedAssets,
                        assetsFailed: failedAttachments.length
                    },
                    failedChats,
                    failedAttachments
                };

                try {
                    if (useZip) {
                        folder.file('_export_dev.log', fullLogText);
                        // Always write errors JSON when there are failures; also write full session JSON in dev mode
                        if (failedAttachments.length || failedChats.length) {
                            folder.file('_export_errors.json', JSON.stringify(sessionJson, null, 2));
                        }
                        if (isDevMode) {
                            folder.file('_export_session_dev.json', JSON.stringify(sessionJson, null, 2));
                        }
                    } else {
                        await writeFileDirect('_export_dev.log', fullLogText);
                        if (failedAttachments.length || failedChats.length) {
                            await writeFileDirect('_export_errors.json', JSON.stringify(sessionJson, null, 2));
                        }
                        if (isDevMode) {
                            await writeFileDirect('_export_session_dev.json', JSON.stringify(sessionJson, null, 2));
                        }
                    }
                    onLog(typeof I18n !== 'undefined' ? I18n.t('logDevLogWritten') : '🛠️ [开发者模式] 已自动将完整导出日志与诊断写入 _export_dev.log', 'info');
                } catch (logWriteErr) {
                    console.error('Failed to write _export_dev.log', logWriteErr);
                }
            }

            if (useZip) {
                const zipFileName = `gemini_export_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
                onLog(typeof I18n !== 'undefined' ? I18n.t('logPackagingZip') : '正在打包 ZIP 压缩包…', 'info');
                const blob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
                    onProgress({
                        current: payloadIds.length,
                        total: payloadIds.length,
                        pct: Math.floor(metadata.percent),
                        title: typeof I18n !== 'undefined' ? I18n.t('progPackagingZip', Math.floor(metadata.percent)) : `打包 ZIP 中 (${Math.floor(metadata.percent)}%)`,
                        assetsDownloaded: downloadedAssets,
                        assetsTotal: totalAssets
                    });
                });
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = zipFileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
            }

            try {
                await chrome.storage.local.set({
                    gemini_last_export_session: {
                        status: this.aborted ? 'aborted' : (failedChats.length > 0 ? 'completed_with_errors' : 'completed'),
                        slot,
                        total: payloadIds.length,
                        current: landedChats,
                        failedCount: failedChats.length,
                        skipped,
                        updatedAt: Date.now()
                    }
                });
            } catch {}

            return {
                landedChats,
                failedChats,
                failedAttachments,
                skipped,
                totalAssets,
                downloadedAssets
            };
        }
    }

    return {
        ExportEngine,
        sanitizeFileName,
        sanitizeZipPath,
        getExtensionVersion
    };
}));
