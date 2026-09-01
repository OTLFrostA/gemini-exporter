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
        if (!name) return fallback;
        let s = String(name).replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001F\u007F]/g, '_');
        s = s.replace(/[<>:"/\\|?*]+/g, '_');
        s = s.replace(/^\.+|\.+$/g, '');
        s = s.trim();
        if (!s) return fallback;
        if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = s + '_chat';
        if (s.length > 80) s = s.slice(0, 80).trim();
        return s;
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
        const parts = subPath.split('/').filter(Boolean);
        for (let p of parts) {
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
        }

        abort() {
            this.aborted = true;
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
            const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
            const store = await chrome.storage.local.get([expKey]);
            let curIds = store[expKey] || {};

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
                    if (dirHandle.name === exportFolderName) {
                        batchDirHandle = dirHandle;
                    } else {
                        batchDirHandle = await dirHandle.getDirectoryHandle(exportFolderName, { create: true });
                    }
                } catch (e) {
                    onLog(`创建子文件夹失败: ${e.message}`, 'warn');
                    batchDirHandle = dirHandle;
                }
            }

            async function writeFileDirect(localName, data) {
                try {
                    const parts = localName.split('/');
                    let fileName = parts.pop();
                    fileName = sanitizeFileName(fileName, 'file');
                    const dirPath = parts.join('/');
                    let targetDir = batchDirHandle;
                    if (dirPath) {
                        const cleanParts = dirPath.split('/').map(p => sanitizeFileName(p, 'dir')).filter(Boolean);
                        targetDir = await ensureSubDir(batchDirHandle, cleanParts.join('/'));
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
                while (!this.aborted && (!isFetchingDone || attachmentQueue.length > 0)) {
                    if (attachmentQueue.length === 0 || activeDownloads >= MAX_CONCURRENT) {
                        await new Promise(r => setTimeout(r, 100));
                        continue;
                    }
                    const task = attachmentQueue.shift();
                    activeDownloads++;
                    try {
                        await task();
                    } catch (e) {}
                    activeDownloads--;
                }
            };

            const consumerPool = [];
            for (let i = 0; i < MAX_CONCURRENT; i++) {
                consumerPool.push(processAttachmentQueue());
            }

            const isRealTitle = typeof globalThis.isRealTitle === 'function' ? globalThis.isRealTitle : (t => Boolean(t && t !== 'Untitled' && t !== '未命名'));

            const CHUNK_SIZE = 1;
            for (let i = 0; i < payloadIds.length; i += CHUNK_SIZE) {
                if (this.aborted) {
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
                    if (this.aborted) break;
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

                    const formatted = typeof chatFormatter !== 'undefined' && chatFormatter.formatContent
                        ? chatFormatter.formatContent(chat, format)
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
                            chrome.storage.local.set({ [expKey]: curIds });
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
                                        failedAttachments.push({ chatId: chat.id, file: att.localName || att.fileName, error: failReason });
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
                                            failedAttachments.push({ chatId: chat.id, file: img.localName, error: failReason });
                                        }
                                    });
                                }
                            }
                        }
                    }
                }

                if (convsNeedSave) {
                    const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
                    chrome.storage.local.set({ [convKey]: conversations });
                }
            }

            isFetchingDone = true;
            await Promise.all(consumerPool);

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
                        version: '1.2.5',
                        total: metaResults.length,
                        conversations: metaResults
                    }, null, 2));
                } else {
                    await writeFileDirect('00_INDEX.md', indexContent);
                    await writeFileDirect('meta.json', JSON.stringify({
                        exportedAt: new Date().toISOString(),
                        version: '1.2.5',
                        total: metaResults.length,
                        conversations: metaResults
                    }, null, 2));
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
