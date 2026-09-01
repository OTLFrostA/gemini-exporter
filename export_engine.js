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

    function sanitizeFileName(name, fallback = 'untitled') {
        // 统一委托至 GeminiUtils 单一源，避免多处截断(70 vs 80)与扩展名不一致
        if (typeof GeminiUtils !== 'undefined' && GeminiUtils.sanitizeFileName) {
            return GeminiUtils.sanitizeFileName(name, fallback);
        }
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.sanitizeFileName) {
            return globalThis.GeminiUtils.sanitizeFileName(name, fallback);
        }
        if (!name) return fallback;
        let s = String(name).replace(/[\r\n\t\f\v]+/g, ' ').replace(/[\u0000-\u001F\u007F-\u009F]/g, '_');
        s = s.replace(/\.\.\//g, '_').replace(/\.\.\\/g, '_');
        s = s.replace(/[<>:"/\\|?*]+/g, '_');
        s = s.replace(/\.{2,}/g, '_');
        s = s.replace(/^\.+|\.+$/g, '');
        s = s.trim();
        if (!s) return fallback;
        if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = s + '_chat';
        let ext = '';
        const lastDot = s.lastIndexOf('.');
        if (lastDot > 0 && s.length - lastDot <= 6) {
            ext = s.slice(lastDot);
            s = s.slice(0, lastDot);
        }
        if (s.length > 70) s = s.slice(0, 70).trim();
        s = s.replace(/[\.\s_]+$/g, '').trim();
        if (!s) s = fallback;
        return s + ext;
    }

    function normId(id) {
        if (!id) return '';
        return String(id).replace(/^c_/, '').trim();
    }

    function toIso(v) {
        if (!v) return null;
        let ms = typeof v === 'number' ? v : new Date(v).getTime();
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }

    async function ensureSubDir(root, subPath) {
        let cur = root;
        const parts = subPath.split('/').filter(Boolean).filter(p => p !== '.' && p !== '..').map(p => sanitizeFileName(p, 'dir'));
        for (let p of parts) {
            if (!p || p === '.' || p === '..') continue;
            cur = await cur.getDirectoryHandle(p, { create: true });
        }
        return cur;
    }

    async function getGeminiTab(slot) {
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
                    batchDirHandle = dirHandle;
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
                const pct = totalChats ? Math.floor((current / totalChats) * 100) : 0;

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

            const isRealTitle = (() => {
                try {
                    if (typeof GeminiUtils !== 'undefined' && GeminiUtils.isRealTitle) return GeminiUtils.isRealTitle;
                    if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.isRealTitle) return globalThis.GeminiUtils.isRealTitle;
                    if (typeof globalThis !== 'undefined' && typeof globalThis.isRealTitle === 'function') return globalThis.isRealTitle;
                } catch {}
                return (t, id) => Boolean(t && typeof t === 'string' && t.trim().length >= 2 && t !== 'Untitled' && t !== '未命名');
            })();

            const CHUNK_SIZE = 1;
            for (let i = 0; i < payloadIds.length; i += CHUNK_SIZE) {
                if (this.aborted || (abortSignal && abortSignal.aborted)) {
                    onLog('已终止导出', 'warn');
                    break;
                }
                let chunk = payloadIds.slice(i, i + CHUNK_SIZE);
                const curCandidate = chunk[0];
                if (curCandidate) {
                    updateProgress(i + 1, curCandidate.title || curCandidate.id);
                }

                let res = await new Promise(resolve => {
                    chrome.runtime.sendMessage({
                        action: 'fetchBatch',
                        ids: chunk,
                        format,
                        skipExported: skip,
                        globalOffset: i,
                        globalTotal: payloadIds.length,
                        accountSlot: currentSlot
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            resolve({ success: false, error: chrome.runtime.lastError.message });
                        } else {
                            resolve(response);
                        }
                    });
                });

                if (!res || !res.success) {
                    onLog(`抓取对话失败: ${res ? res.error : '未知错误'}`, 'warn');
                    failedChats.push(...chunk.map(c => c.id));
                    continue;
                }

                skipped += (res.skipped || 0);
                const chunkResults = res.results || [];
                let convsNeedSave = false;

                for (let cIdx = 0; cIdx < chunkResults.length; cIdx++) {
                    let chat = chunkResults[cIdx];
                    if (this.aborted || (abortSignal && abortSignal.aborted)) break;
                    const requestedItem = chunk[cIdx] || chunk[0] || {};
                    const nid = normId(requestedItem.id || chat?.id);
                    if (!chat) chat = { id: nid, title: requestedItem.title };
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
                            onLog(`[${chat.title || nid}] ⚡ 已自动从 Takeout 离线记录恢复问答并导出`, 'info');
                        }
                    }

                    if (chat.error || chat._empty) {
                        failedChats.push(chat.id);
                        onLog(`[${chat.title || nid}] 导出跳过: ${chat.error || '云端返回内容为空且无本地离线记录'}`, 'warn');
                        continue;
                    }

                    totalAssets += chat.attachmentCount || 0;
                    const listC = conversations.find(c => normId(c.id) === nid) || null;
                    let finalTitle = chat.title || listC?.title || chat.id;

                    if (isRealTitle(chat.title, chat.id) && chat.title !== chat.id) {
                        finalTitle = chat.title;
                        if (listC && listC.title !== finalTitle) {
                            listC.title = finalTitle;
                            convsNeedSave = true;
                            onTitleUpdated(chat.id, finalTitle);
                        }
                    } else if (isRealTitle(listC?.title, chat.id)) {
                        finalTitle = listC.title;
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

                    if (writeOk) {
                        landedChats++;
                        onLog(`[${listTitle}] ✓ 文本导出成功 (${fileName})`, 'info');
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
                            curIds[chat.id] = record;
                            curIds[nid] = record;
                            curIds['c_' + nid] = record;
                            exportedIds[chat.id] = record;
                            exportedIds[nid] = record;
                            exportedIds['c_' + nid] = record;
                            if (Storage) {
                                await Storage.saveExportRecord(slot, chat.id, record);
                            } else {
                                const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
                                chrome.storage.local.set({ [expKey]: curIds });
                            }
                            onItemExported(chat.id, record);
                        }
                    }

                    metaResults.push({
                        id: chat.id,
                        title: listTitle,
                        url: chat.url || `https://gemini.google.com/app/${chat.id}`,
                        createdAt: toIso(chat.createdAt || chat.timestamp || listC?.timestamp),
                        updatedAt: toIso(chat.updatedAt || chat.timestamp || listC?.timestamp),
                        messageCount: chat.messages ? chat.messages.length : (chat.messageCount || 0),
                        attachmentCount: chat.attachmentCount || 0,
                        exportFile: fileName,
                        status: writeOk ? 'success' : 'failed'
                    });

                    updateProgress(i + cIdx + 1, listTitle);

                    if (includeAssets && chat.messages && writeOk) {
                        for (const m of chat.messages) {
                            if (!m.attachments) continue;

                            for (const att of m.attachments) {
                                if (att.type !== 'file') continue;
                                if ((att.url && att.url.includes('immersive_entry_chip')) && !att.contentMarkdown) continue;
                                if (att.contentMarkdown) {
                                    if (att.contentMarkdown.includes('immersive_entry_chip') || att.contentMarkdown.includes('googleusercontent.com/immersive')) {
                                        continue;
                                    }
                                    if (useZip) {
                                        try {
                                            folder.file(att.localName, att.contentMarkdown);
                                            downloadedAssets++;
                                            updateProgress();
                                        } catch {}
                                    } else {
                                        attachmentQueue.push(async () => {
                                            const ok = await writeFileDirect(att.localName || `${safeBase}_${chat.id.slice(-6)}.md`, att.contentMarkdown);
                                            if (ok) {
                                                downloadedAssets++;
                                                updateProgress();
                                            }
                                        });
                                    }
                                    continue;
                                }

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
                                                        folder.file(att.localName, r.dataBase64, { base64: true });
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
                                                    folder.file(att.localName, offlineBin);
                                                    saved = true;
                                                } else {
                                                    saved = await writeFileDirect(att.localName, offlineBin);
                                                }
                                                if (saved) {
                                                    onLog(`[${chat.title || chat.id}] ⚡ 附件从 Takeout 离线池补全成功: ${att.localName}`, 'info');
                                                }
                                            }
                                        } catch (takeoutErr) {}
                                    }

                                    if (saved) {
                                        downloadedAssets++;
                                        updateProgress();
                                    } else {
                                        failedAttachments.push({ chatId: chat.id, chatTitle: listTitle || chat.title || chat.id, file: att.localName || att.fileName, error: failReason || 'CDN鉴权过期或资源不可达' });
                                        onLog(`[${chat.title || chat.id}] 附件获取失败 (${att.localName || att.fileName}): ${failReason || 'CDN鉴权过期或资源不可达'}`, 'warn');
                                    }
                                });
                            }

                            if (m.images && m.images.length) {
                                for (const img of m.images) {
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
                                                        folder.file(img.localName, r.dataBase64, { base64: true });
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
                                                        folder.file(img.localName, offlineBin);
                                                        saved = true;
                                                    } else {
                                                        saved = await writeFileDirect(img.localName, offlineBin);
                                                    }
                                                    if (saved) {
                                                        onLog(`[${chat.title || chat.id}] ⚡ 图片从 Takeout 离线池补全成功: ${img.localName}`, 'info');
                                                    }
                                                }
                                            } catch (takeoutErr) {}
                                        }

                                        if (saved) {
                                            downloadedAssets++;
                                            updateProgress();
                                        } else {
                                            failedAttachments.push({ chatId: chat.id, chatTitle: listTitle || chat.title || chat.id, file: img.localName, error: failReason || 'CDN鉴权过期或资源不可达' });
                                            onLog(`[${chat.title || chat.id}] 图片获取失败 (${img.localName}): ${failReason || 'CDN鉴权过期或资源不可达'}`, 'warn');
                                        }
                                    });
                                }
                            }
                        }
                    }
                }

                if (convsNeedSave) {
                    if (Storage) {
                        await Storage.setConversations(slot, conversations);
                    } else {
                        const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
                        chrome.storage.local.set({ [convKey]: conversations });
                    }
                }
            }

            isFetchingDone = true;
            try {
                await Promise.all(consumerPool);
            } catch (e) {
                if (this.aborted) onLog('附件下载因终止而中断', 'warn');
            }

            if (includeIndex && metaResults.length > 0) {
                let indexContent = `# Gemini 对话索引目录 (Export Index)\n\n> 导出时间: ${new Date().toLocaleString()} · 总会话数: ${landedChats} · 附件数: ${downloadedAssets}/${totalAssets}\n\n| 对话标题 (Title) | 消息数 | 附件 | 原始链接 (URL) | 导出文件 |\n| :--- | :--- | :--- | :--- | :--- |\n`;
                for (const meta of metaResults) {
                    const safeT = meta.title.replace(/\|/g, '\\|');
                    indexContent += `| **[${safeT}](${meta.exportFile})** | ${meta.messageCount} | ${meta.attachmentCount} | [🔗 原文](${meta.url}) | \`${meta.exportFile}\` |\n`;
                }
                indexContent += `\n---\n_Generated by Gemini Exporter at ${new Date().toISOString()}_\n`;

                if (useZip) {
                    folder.file('00_INDEX.md', indexContent);
                    folder.file('meta.json', JSON.stringify({
                        exportedAt: new Date().toISOString(),
                        version: '1.3.0',
                        total: metaResults.length,
                        conversations: metaResults
                    }, null, 2));
                } else {
                    await writeFileDirect('00_INDEX.md', indexContent);
                    await writeFileDirect('meta.json', JSON.stringify({
                        exportedAt: new Date().toISOString(),
                        version: '1.3.0',
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
                fullLogText += ` Gemini Exporter Session Log (Dev Mode)\n`;
                fullLogText += ` Time: ${new Date().toISOString()}\n`;
                fullLogText += ` Summary: Landed ${landedChats}/${payloadIds.length} chats, Assets ${downloadedAssets}/${totalAssets}, Skipped ${skipped}\n`;
                fullLogText += ` Failed Chats: ${failedChats.length}, Failed Assets: ${failedAttachments.length}\n`;
                fullLogText += `=======================================================\n\n`;

                if (failedChats.length > 0) {
                    fullLogText += `[FAILED CONVERSATIONS]\n`;
                    for (const fc of failedChats) {
                        fullLogText += `  - ${fc}\n`;
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

                try {
                    if (useZip) {
                        folder.file('_export_dev.log', fullLogText);
                        if (failedAttachments.length || failedChats.length) {
                            folder.file('_export_errors.json', JSON.stringify({ failedChats, failedAttachments }, null, 2));
                        }
                    } else {
                        await writeFileDirect('_export_dev.log', fullLogText);
                        if (failedAttachments.length || failedChats.length) {
                            await writeFileDirect('_export_errors.json', JSON.stringify({ failedChats, failedAttachments }, null, 2));
                        }
                    }
                    onLog('🛠️ [开发者模式] 已自动将完整导出日志与诊断写入 _export_dev.log', 'info');
                } catch (logWriteErr) {
                    console.error('Failed to write _export_dev.log', logWriteErr);
                }
            }

            if (useZip) {
                const zipFileName = `gemini_export_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
                onLog('正在打包 ZIP 压缩包…', 'info');
                const blob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
                    onProgress({
                        current: payloadIds.length,
                        total: payloadIds.length,
                        pct: Math.floor(metadata.percent),
                        title: `打包 ZIP 中 (${Math.floor(metadata.percent)}%)`,
                        assetsDownloaded: downloadedAssets,
                        assetsTotal: totalAssets
                    });
                });
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = zipFileName;
                a.click();
                setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
            }

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
        sanitizeFileName
    };
}));
