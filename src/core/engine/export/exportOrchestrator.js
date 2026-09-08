// exportOrchestrator.js - Top-level orchestrator for Gemini export workflows
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ExportOrchestrator = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function getExtensionVersion() {
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
                return chrome.runtime.getManifest().version || '1.3.8';
            }
        } catch (e) {
            if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.js]', e);
        }
        return '1.3.8';
    }

    const getUtils = () => {
        if (typeof GeminiUtils !== 'undefined') return GeminiUtils;
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils) return globalThis.GeminiUtils;
        if (typeof require !== 'undefined') {
            try { return require('../../utils/utils.js'); } catch { /* intentional: require fallback in browser context */ }
        }
        return null;
    };

    const getProgressReporter = () => {
        if (typeof ProgressReporter !== 'undefined') return ProgressReporter;
        if (typeof globalThis !== 'undefined' && globalThis.ProgressReporter) return globalThis.ProgressReporter;
        if (typeof require !== 'undefined') {
            try { return require('./progressReporter.js'); } catch { /* intentional */ }
        }
        return null;
    };

    const getBatchWorker = () => {
        if (typeof BatchWorker !== 'undefined') return BatchWorker;
        if (typeof globalThis !== 'undefined' && globalThis.BatchWorker) return globalThis.BatchWorker;
        if (typeof require !== 'undefined') {
            try { return require('./batchWorker.js'); } catch { /* intentional */ }
        }
        return null;
    };

    const getSessionRecovery = () => {
        if (typeof SessionRecovery !== 'undefined') return SessionRecovery;
        if (typeof globalThis !== 'undefined' && globalThis.SessionRecovery) return globalThis.SessionRecovery;
        if (typeof require !== 'undefined') {
            try { return require('./sessionRecovery.js'); } catch { /* intentional */ }
        }
        return null;
    };

    const sanitizeFileName = (name, fallback) => (getUtils()?.sanitizeFileName ? getUtils().sanitizeFileName(name, fallback) : (name || fallback || 'untitled').trim());
    const normId = (id) => (getUtils()?.normId ? getUtils().normId(id) : String(id || '').replace(/^c_/, '').trim());
    const sanitizeZipPath = (p) => (getUtils()?.sanitizeRelativePath ? getUtils().sanitizeRelativePath(p, 'file') : (p || 'file').replace(/^[/\\]+/, ''));

    function toIso(v) {
        if (!v) return null;
        let ms = typeof v === 'number' ? v : new Date(v).getTime();
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }

    class AsyncQueue {
        constructor() {
            this._queue = [];
            this._waiters = [];
            this._closed = false;
        }
        push(task) {
            if (this._closed) return;
            if (this._waiters.length > 0) {
                const waiter = this._waiters.shift();
                waiter(task);
            } else {
                this._queue.push(task);
            }
        }
        async pop(abortSignal) {
            if (this._queue.length > 0) {
                return this._queue.shift();
            }
            if (this._closed) return null;
            return new Promise((resolve) => {
                let onAbort = null;
                const waiter = (task) => {
                    if (onAbort && abortSignal) {
                        try { abortSignal.removeEventListener('abort', onAbort); } catch { /* intentional */ }
                    }
                    resolve(task);
                };
                if (abortSignal) {
                    onAbort = () => {
                        const idx = this._waiters.indexOf(waiter);
                        if (idx !== -1) this._waiters.splice(idx, 1);
                        resolve(null);
                    };
                    if (abortSignal.aborted) return resolve(null);
                    try { abortSignal.addEventListener('abort', onAbort, { once: true }); } catch (e) {
                        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.js]', e);
                    }
                }
                this._waiters.push(waiter);
            });
        }
        close() {
            this._closed = true;
            while (this._waiters.length > 0) {
                const waiter = this._waiters.shift();
                waiter(null);
            }
        }
        get length() {
            return this._queue.length;
        }
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
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
            return chrome.tabs.query({ url: 'https://gemini.google.com/*' }).then(tabs => tabs?.[0] || null);
        }
        return null;
    }

    const getAssetPipelineClass = () => {
        if (typeof AssetPipeline !== 'undefined') return AssetPipeline;
        if (typeof globalThis !== 'undefined' && globalThis.AssetPipeline) return globalThis.AssetPipeline;
        if (typeof require !== 'undefined') {
            try { return require('../assetPipeline.js'); } catch { /* intentional */ }
        }
        return null;
    };

    class ExportOrchestrator {
        constructor() {
            this.aborted = false;
            this._abortController = null;
            this.rateLimitCooldownUntil = 0;
        }

        abort() {
            this.aborted = true;
            try { this._abortController && this._abortController.abort(); } catch { /* intentional */ }
            try {
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                    chrome.runtime.sendMessage({ action: 'cancelExport' }, () => {
                        if (chrome.runtime.lastError) {}
                    });
                }
            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.js]', e); }
            try {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
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
                }
            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.js]', e); }
        }

        async _initSession(options, callbacks) {
            const {
                selected = [],
                format = 'markdown',
                useZip = true,
                currentSlot = 'u0'
            } = options;

            if (!selected.length) {
                throw new Error('No items selected');
            }

            this.aborted = false;
            this.rateLimitCooldownUntil = 0;
            this._abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const abortSignal = this._abortController ? this._abortController.signal : null;

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
            if (!Storage && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
                const store = await chrome.storage.local.get([expKey]);
                curIds = store[expKey] || {};
            }

            try {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
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
                }
            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.js]', e); }

            return {
                payloadIds,
                slot,
                Storage,
                curIds,
                abortSignal
            };
        }

        async _initWriter(options, onLog) {
            const { useZip = true, dirHandle = null } = options;
            const exportFolderName = 'gemini_export';
            let batchDirHandle = null;
            let zip = null;
            let folder = null;
            let zipWriter = null;
            let fsWriter = null;

            if (useZip) {
                const ZipWriterClass = (typeof ZipWriter !== 'undefined' && ZipWriter.ZipWriter)
                    ? ZipWriter.ZipWriter
                    : (typeof ZipWriter === 'function' ? ZipWriter : null);
                if (ZipWriterClass) {
                    zipWriter = new ZipWriterClass(exportFolderName);
                    zip = zipWriter.zip;
                    folder = zipWriter.folder;
                } else {
                    if (typeof JSZip === 'undefined') throw new Error('JSZip library not found');
                    zip = new JSZip();
                    folder = zip.folder(exportFolderName);
                }
            } else {
                if (!dirHandle) throw new Error('Directory handle not provided');
                try {
                    const FsWriterClass = (typeof FsWriter !== 'undefined' && FsWriter.FsWriter)
                        ? FsWriter.FsWriter
                        : (typeof FsWriter === 'function' ? FsWriter : null);
                    if (FsWriterClass) {
                        fsWriter = new FsWriterClass(dirHandle, exportFolderName);
                        batchDirHandle = await fsWriter.init();
                    } else {
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
                    }
                } catch (e) {
                    onLog(`创建子文件夹失败: ${e.message}`, 'warn');
                    if (e.name === 'NotAllowedError' || String(e.message).includes('permission')) {
                        onLog('目录句柄权限失效，请重新授权文件夹', 'warn');
                    }
                    throw new Error(`无法创建导出子目录 "${exportFolderName}": ${e.message}`);
                }
            }

            const writeFileDirect = async (localName, data) => {
                try {
                    const cleanPath = sanitizeZipPath(localName);
                    if (fsWriter) {
                        await fsWriter.writeFile(cleanPath, data);
                        return true;
                    }
                    const parts = cleanPath.split('/').filter(Boolean);
                    let fileName = parts.pop() || 'file';
                    const dirPath = parts.join('/');
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
            };

            return { zip, folder, zipWriter, batchDirHandle, fsWriter, writeFileDirect };
        }

        async _packageAndDownload(zipWriterOrZip, payloadIds, downloadedAssets, totalAssets, options, onLog, onProgress) {
            const zipFileName = `gemini_export_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
            onLog(typeof I18n !== 'undefined' ? I18n.t('logPackagingZip') : '正在打包 ZIP 压缩包…', 'info');
            const onUpdate = (percent) => {
                onProgress({
                    current: payloadIds.length,
                    total: payloadIds.length,
                    pct: Math.floor(percent),
                    title: typeof I18n !== 'undefined' ? I18n.t('progPackagingZip', Math.floor(percent)) : `打包 ZIP 中 (${Math.floor(percent)}%)`,
                    assetsDownloaded: downloadedAssets,
                    assetsTotal: totalAssets
                });
            };
            const blob = (zipWriterOrZip && typeof zipWriterOrZip.generateBlob === 'function')
                ? await zipWriterOrZip.generateBlob(onUpdate)
                : await zipWriterOrZip.generateAsync({ type: 'blob' }, (metadata) => onUpdate(metadata.percent));

            if (options.downloadHandler && typeof options.downloadHandler === 'function') {
                await options.downloadHandler(blob, zipFileName);
            } else if (typeof document !== 'undefined' && document.createElement && document.body) {
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = zipFileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
            }
        }

        async run(options, callbacks = {}) {
            const onProgress = callbacks.onProgress || (() => {});
            const onLog = callbacks.onLog || (() => {});
            const onTitleUpdated = callbacks.onTitleUpdated || (() => {});
            const onItemExported = callbacks.onItemExported || (() => {});

            const session = await this._initSession(options, callbacks);
            const { payloadIds, slot, Storage, curIds, abortSignal } = session;

            const {
                format = 'markdown',
                skip = false,
                includeIndex = true,
                includeAssets = true,
                useZip = true,
                currentSlot = 'u0',
                conversations = [],
                exportedIds = {},
                takeoutEngine = null
            } = options;

            const { zip, folder, zipWriter, writeFileDirect } = await this._initWriter(options, onLog);

            const AssetPipelineClass = getAssetPipelineClass();
            const assetPipeline = AssetPipelineClass ? new AssetPipelineClass({
                currentSlot,
                useZip,
                folder,
                writeFileDirect,
                takeoutEngine,
                getGeminiTab,
                onLog
            }) : null;

            let totalAssets = 0;
            let downloadedAssets = 0;
            let landedChats = 0;
            let failedChats = [];
            let failedAttachments = [];
            let skipped = 0;
            let metaResults = [];

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

            const attachmentQueue = new AsyncQueue();
            const MAX_CONCURRENT = 4;

            if (abortSignal) {
                abortSignal.addEventListener('abort', () => attachmentQueue.close(), { once: true });
            }

            const processAttachmentWorker = async () => {
                while (!this.aborted && !(abortSignal && abortSignal.aborted)) {
                    const task = await attachmentQueue.pop(abortSignal);
                    if (!task) break;
                    try {
                        await task();
                    } catch (e) {
                        if (abortSignal && abortSignal.aborted) break;
                    }
                }
            };

            const consumerPool = [];
            for (let i = 0; i < MAX_CONCURRENT; i++) {
                consumerPool.push(processAttachmentWorker());
            }

            const pendingAssetsPerChat = new Map();
            const chatRecordsMap = new Map();
            const chatFailedAssetsSet = new Set();
            const finalizedChatsSet = new Set();

            const recovery = getSessionRecovery();
            const worker = getBatchWorker();

            async function finalizeChatExport(targetId) {
                const targetNid = normId(targetId);
                if (finalizedChatsSet.has(targetNid)) return;
                const rec = chatRecordsMap.get(targetNid);
                if (!rec || chatFailedAssetsSet.has(targetNid)) return;
                finalizedChatsSet.add(targetNid);
                curIds[targetId] = rec;
                curIds[targetNid] = rec;
                curIds['c_' + targetNid] = rec;
                exportedIds[targetId] = rec;
                exportedIds[targetNid] = rec;
                exportedIds['c_' + targetNid] = rec;
                if (Storage) {
                    await Storage.saveExportRecord(slot, targetId, rec);
                } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
                    chrome.storage.local.set({ [expKey]: curIds });
                }
                onItemExported(targetId, rec);
            }

            const CONCURRENCY = 3;
            let nextIndex = 0;
            let completedCount = 0;
            let convsNeedSave = false;

            const exportWorker = async () => {
                while (nextIndex < payloadIds.length && !this.aborted && !(abortSignal && abortSignal.aborted)) {
                    if (this.rateLimitCooldownUntil && Date.now() < this.rateLimitCooldownUntil) {
                        const waitMs = Math.max(0, this.rateLimitCooldownUntil - Date.now());
                        if (waitMs > 0) {
                            await new Promise(r => setTimeout(r, waitMs));
                            if (this.aborted || (abortSignal && abortSignal.aborted)) break;
                        }
                    }

                    const currentIndex = nextIndex++;
                    const requestedItem = payloadIds[currentIndex];
                    if (!requestedItem) break;

                    const nid = normId(requestedItem.id);
                    let res = null;
                    let retryCount = 0;
                    const maxRateLimitRetries = 3;

                    while (retryCount <= maxRateLimitRetries && !this.aborted && !(abortSignal && abortSignal.aborted)) {
                        res = worker && worker.fetchChatDetail
                            ? await worker.fetchChatDetail(requestedItem, currentIndex, payloadIds.length, currentSlot, skip, format, abortSignal)
                            : await this._fetchChatDetail(requestedItem, currentIndex, payloadIds.length, currentSlot, skip, format, abortSignal);

                        if (this.aborted || (abortSignal && abortSignal.aborted)) break;

                        const isRateLimited = res && !res.success && (
                            res.status === 429 ||
                            /429|rate\s*limit|quota|too\s*many\s*requests/i.test(res.error || '')
                        );

                        if (isRateLimited && retryCount < maxRateLimitRetries) {
                            const delayMs = Math.min(30000, 2000 * Math.pow(2, retryCount) + Math.floor(Math.random() * 1000));
                            this.rateLimitCooldownUntil = Date.now() + delayMs;
                            onLog(typeof I18n !== 'undefined'
                                ? I18n.t('logRateLimitedBackoff', requestedItem.title || nid, (delayMs / 1000).toFixed(1))
                                : `[${requestedItem.title || nid}] ⚠️ 触发 Google 限频 (429)，退避等待 ${(delayMs / 1000).toFixed(1)} 秒后重试...`, 'warn');
                            await new Promise(r => setTimeout(r, delayMs));
                            retryCount++;
                            continue;
                        }
                        break;
                    }

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

                    const listC = conversations.find(c => normId(c.id) === nid) || null;
                    const resolvedRes = worker && worker.resolveChat
                        ? await worker.resolveChat(chat, requestedItem, listC, takeoutEngine, currentSlot, onTitleUpdated, onLog)
                        : await this._resolveChat(chat, requestedItem, listC, takeoutEngine, currentSlot, onTitleUpdated, onLog);

                    if (resolvedRes.convsNeedSave) convsNeedSave = true;

                    if (resolvedRes.isError) {
                        failedChats.push({ id: chat.id || nid, title: resolvedRes.displayTitle, error: resolvedRes.errMsg, debug: chat._debug || null, raw: chat._raw || null, isDeleted: resolvedRes.isConfirmedDeleted });
                        if (typeof console !== 'undefined' && console.warn) {
                            console.warn('[Gemini Exporter] export empty detail', nid, resolvedRes.errMsg, 'chat keys', Object.keys(chat || {}));
                        }
                        completedCount++;
                        updateProgress(completedCount, resolvedRes.displayTitle);
                        continue;
                    }

                    const listTitle = resolvedRes.listTitle;
                    chat.title = listTitle;

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
                    const chatAssetTasks = [];
                    const queueAsset = (item, isImage) => {
                        totalAssets++;
                        queuedAssetsForThisChat++;
                        updateProgress();
                        chatAssetTasks.push(async () => {
                            let assetRes = { saved: false, failReason: '', localName: item.localName || item.fileName || (isImage ? 'image.jpg' : 'file.bin') };
                            if (assetPipeline) {
                                assetRes = await assetPipeline.processAsset(item, chat, { isImage, listTitle });
                            }
                            if (assetRes.saved) {
                                downloadedAssets++;
                                updateProgress();
                                const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                pendingAssetsPerChat.set(nid, left);
                                if (left === 0) finalizeChatExport(chat.id);
                            } else {
                                chatFailedAssetsSet.add(nid);
                                failedAttachments.push({ chatId: chat.id, chatTitle: listTitle || chat.title || chat.id, file: assetRes.localName, error: assetRes.failReason || 'CDN auth expired' });
                                const logKey = isImage ? 'logImageFailed' : 'logAssetFailed';
                                const fallbackMsg = isImage
                                    ? `[${chat.title || chat.id}] 图片获取失败 (${assetRes.localName}): ${assetRes.failReason || 'CDN鉴权过期或资源不可达'}`
                                    : `[${chat.title || chat.id}] 附件获取失败 (${assetRes.localName}): ${assetRes.failReason || 'CDN鉴权过期或资源不可达'}`;
                                onLog(typeof I18n !== 'undefined' ? I18n.t(logKey, chat.title || chat.id, assetRes.localName, assetRes.failReason || 'CDN auth expired') : fallbackMsg, 'warn');
                                const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                pendingAssetsPerChat.set(nid, left);
                                if (left === 0) finalizeChatExport(chat.id);
                            }
                        });
                    };

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
                                        if (useZip) {
                                            try {
                                                folder.file(sanitizeZipPath(att.localName), att.contentMarkdown);
                                                totalAssets++;
                                                downloadedAssets++;
                                                updateProgress();
                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.js]', e); }
                                        } else {
                                            totalAssets++;
                                            queuedAssetsForThisChat++;
                                            updateProgress();
                                            chatAssetTasks.push(async () => {
                                                const ok = await writeFileDirect(att.localName || `${safeBase}_${chat.id.slice(-6)}.md`, att.contentMarkdown);
                                                if (ok) {
                                                    downloadedAssets++;
                                                    updateProgress();
                                                    const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                                    pendingAssetsPerChat.set(nid, left);
                                                    if (left === 0) finalizeChatExport(chat.id);
                                                } else {
                                                    chatFailedAssetsSet.add(nid);
                                                    const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                                    pendingAssetsPerChat.set(nid, left);
                                                    if (left === 0) finalizeChatExport(chat.id);
                                                }
                                            });
                                        }
                                        continue;
                                    }

                                    queueAsset(att, false);
                                }
                            }

                            if (m.images && m.images.length) {
                                for (const img of m.images) {
                                    queueAsset(img, true);
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
                                for (const task of chatAssetTasks) {
                                    attachmentQueue.push(task);
                                }
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
                        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
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
                        }
                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.js]', e); }
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
                } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
                    chrome.storage.local.set({ [convKey]: conversations });
                }
            }

            attachmentQueue.close();
            try {
                await Promise.all(consumerPool);
            } catch (e) {
                if (this.aborted) onLog(typeof I18n !== 'undefined' ? I18n.t('logAssetsAborted') : '附件下载因终止而中断', 'warn');
            }

            if (includeIndex && metaResults.length > 0) {
                if (recovery && recovery.writeIndexAndMeta) {
                    await recovery.writeIndexAndMeta(metaResults, landedChats, downloadedAssets, totalAssets, writeFileDirect, folder, useZip);
                } else {
                    await this._writeIndexAndMeta(metaResults, landedChats, downloadedAssets, totalAssets, writeFileDirect, folder, useZip);
                }
            }

            let isDevMode = false;
            try {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    const devData = await chrome.storage.local.get(['gemini_dev_mode']);
                    isDevMode = !!devData?.gemini_dev_mode;
                }
            } catch (e) {
                if (typeof console !== 'undefined' && console.warn) console.warn('[GemExporter:storage] Storage operation failed:', e);
            }

            if (isDevMode || failedChats.length > 0 || failedAttachments.length > 0) {
                let fullLogText = '';
                if (recovery && recovery.buildSessionLogText) {
                    fullLogText = recovery.buildSessionLogText({
                        landedChats,
                        totalChats: payloadIds.length,
                        downloadedAssets,
                        totalAssets,
                        skipped,
                        failedChats,
                        failedAttachments,
                        isDevMode
                    });
                } else {
                    fullLogText = `=======================================================\n`;
                    fullLogText += ` Gemini Exporter Session Log${isDevMode ? ' (Dev Mode)' : ' (Error Report)'}\n`;
                    fullLogText += ` Time: ${new Date().toISOString()}\n`;
                    fullLogText += ` Summary: Landed ${landedChats}/${payloadIds.length} chats, Assets ${downloadedAssets}/${totalAssets}, Skipped ${skipped}\n`;
                    fullLogText += ` Failed Chats: ${failedChats.length}, Failed Assets: ${failedAttachments.length}\n`;
                    fullLogText += `=======================================================\n\n`;
                }

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

                if (recovery && recovery.writeDiagnostics) {
                    await recovery.writeDiagnostics(isDevMode, sessionJson, fullLogText, writeFileDirect, folder, useZip, onLog);
                } else {
                    await this._writeDiagnostics(isDevMode, sessionJson, fullLogText, writeFileDirect, folder, useZip, onLog);
                }
            }

            if (useZip) {
                await this._packageAndDownload(zipWriter || zip, payloadIds, downloadedAssets, totalAssets, options, onLog, onProgress);
            }

            try {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
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
                }
            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.js]', e); }

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
        ExportOrchestrator,
        AsyncQueue,
        ensureSubDir,
        sanitizeFileName,
        sanitizeZipPath,
        getExtensionVersion
    };
}));
