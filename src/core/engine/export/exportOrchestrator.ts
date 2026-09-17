
export interface ExportOptions {
    selected: any[];
    format?: string;
    useZip?: boolean;
    currentSlot?: string;
    dirHandle?: any;
    skip?: boolean;
    includeIndex?: boolean;
    includeAssets?: boolean;
    conversations?: any[];
    exportedIds?: Record<string, any>;
    takeoutEngine?: any;
    downloadHandler?: (blob: Blob, filename: string) => Promise<void> | void;
    [key: string]: any;
}

export interface ExportCallbacks {
    onProgress?: (progress: any) => void;
    onLog?: (msg: string, level?: string) => void;
    onTitleUpdated?: (id: string, title: string, source?: string) => void;
    onItemExported?: (id: string, record: any) => void;
}

export interface ExportResult {
    landedChats: number;
    exportedCount?: number;
    failedChats: any[];
    failedAttachments: any[];
    skipped: number;
    totalAssets: number;
    downloadedAssets: number;
    aborted?: boolean;
}

export interface ExportOrchestratorModule {
    ExportOrchestrator: any;
    AsyncQueue: any;
    ensureSubDir: (root: any, subPath: string) => Promise<any>;
    sanitizeFileName: (name?: string | null, fallback?: string) => string;
    sanitizeZipPath: (p?: string | null) => string;
    getExtensionVersion: () => string;
}

import { __resolveModule } from "../../utils/moduleOverrides.js";
import GeminiUtils, {
    type GeminiUtilsModule,
    sanitizeFileName as utilsSanitizeFileName,
    normId as utilsNormId,
    sanitizeRelativePath,
    buildExportFileName,
    resolveExportFileName as utilsResolveExportFileName,
    getErrorMessage,
    checkIsUpdated as utilsCheckIsUpdated,
    setTitleBySource as utilsSetTitleBySource,
    cleanTitle as utilsCleanTitle,
    isRealTitle as utilsIsRealTitle
} from "../../utils/utils.js";
import { ExportPipelineError } from "../../../types/errors.js";
import BatchWorker, { type BatchWorkerModule } from "./batchWorker.js";
import SessionRecovery, { type SessionRecoveryModule } from "./sessionRecovery.js";
import rateLimitModule, { isRateLimited, calculateBackoff, type RateLimitModule } from "./rateLimiter.js";
import progressReporterModule, { ProgressReporter } from "./progressReporter.js";
import TabService from "../../utils/tabService.js";
import { ensureSubDir as fsEnsureSubDir } from "../writers/fsWriter.js";
import { createWriter } from "../writers/writerInterface.js";
import { SessionStore } from "../../storage/sessionStore.js";
import { shortId } from "../../utils/pathUtils.js";

import { EXT_VERSION, getExtensionVersion, exportedIdsKey } from "../../utils/constants.js";
export { EXT_VERSION, getExtensionVersion };

const getUtils = (): GeminiUtilsModule | null => __resolveModule('GeminiUtils', GeminiUtils);
const getProgressReporter = (): any => (globalThis as any).ProgressReporter || progressReporterModule;
const getBatchWorker = (): BatchWorkerModule => (globalThis as any).BatchWorker || BatchWorker;
const getSessionRecovery = (): SessionRecoveryModule => (globalThis as any).SessionRecovery || SessionRecovery;
const getRateLimiter = (): RateLimitModule => (globalThis as any).RateLimitModule || rateLimitModule;

export const sanitizeFileName = (name?: string | null, fallback?: string): string =>
    (((__resolveModule('GeminiUtils', null) as any)?.sanitizeFileName) || utilsSanitizeFileName)(name, fallback);

export const normId = (id?: string | number | null): string =>
    (((__resolveModule('GeminiUtils', null) as any)?.normId) || utilsNormId)(id);

export const sanitizeZipPath = (p?: string | null): string =>
    (((__resolveModule('GeminiUtils', null) as any)?.sanitizeRelativePath) || sanitizeRelativePath)(p, 'file');

export const checkIsUpdated = (c: any, rec?: any): boolean =>
    (((__resolveModule('GeminiUtils', null) as any)?.checkIsUpdated) || utilsCheckIsUpdated)(c, rec);

export const setTitleBySource = (chat: any, source?: string, rawTitle?: string): any =>
    (((__resolveModule('GeminiUtils', null) as any)?.setTitleBySource) || utilsSetTitleBySource)(chat, source, rawTitle);

export const cleanTitle = (rawTitle?: string | null): string =>
    (((__resolveModule('GeminiUtils', null) as any)?.cleanTitle) || utilsCleanTitle)(rawTitle);

export const isRealTitle = (title?: string | null, id?: string | number): boolean =>
    (((__resolveModule('GeminiUtils', null) as any)?.isRealTitle) || utilsIsRealTitle)(title, id);

/**
 * Applies an export-time title write-back from a list-snapshot conversation
 * (listC) onto the stored record (existing) through the canonical title tier
 * arbitration (setTitleBySource -> resolveTitle -> TITLE_TIER_RANK).
 *
 * Previously this was a blind overwrite (`existing.title = listC.title`),
 * which let a lower-authority list snapshot downgrade a higher-authority
 * stored title (e.g. storage holds an rpc title while the list snapshot only
 * carries takeout). Now listC's titles are adopted per source-tier slot and
 * the resolved title is re-arbitrated, so the stored title can stay or be
 * upgraded, but never be downgraded by a weaker source.
 */
export function applyExportTitleWriteback(existing: any, listC: any): any {
    if (!existing || !listC) return existing;
    // Seed the stored record's own resolved title into its tier slot first
    // (mirrors mergeConversation step 0), so legacy-shaped records whose
    // title lives only in title/titleSource are protected by arbitration too.
    // The slot-worthiness gate mirrors setTitleBySource/mergeConversation so
    // placeholder titles never trigger a gratuitous titleSource rewrite.
    if (existing.titleSource && existing.title &&
        (!existing.titles || typeof existing.titles !== 'object' || !existing.titles[existing.titleSource])) {
        const cleanedSeed = cleanTitle(existing.title);
        if (cleanedSeed && (isRealTitle(cleanedSeed, existing.id) || existing.titleSource === 'takeout')) {
            setTitleBySource(existing, existing.titleSource, existing.title);
        }
    }
    if (listC.titles && typeof listC.titles === 'object') {
        for (const [slot, slotTitle] of Object.entries(listC.titles)) {
            if (typeof slotTitle === 'string' && slotTitle) {
                setTitleBySource(existing, slot, slotTitle);
            }
        }
    }
    if (listC.title) {
        setTitleBySource(existing, listC.titleSource || 'legacy', listC.title);
    }
    return existing;
}

    function toIso(v: any): string | null {
        if (!v) return null;
        let ms = typeof v === 'number' ? v : new Date(v).getTime();
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }

    class AsyncQueue {
        _queue: any[];
        _waiters: ((task: any) => void)[];
        _closed: boolean;

        constructor() {
            this._queue = [];
            this._waiters = [];
            this._closed = false;
        }

        push(task: any): void {
            if (this._closed) return;
            if (this._waiters.length > 0) {
                const waiter = this._waiters.shift()!;
                waiter(task);
            } else {
                this._queue.push(task);
            }
        }

        async pop(abortSignal?: AbortSignal | null): Promise<any> {
            if (this._queue.length > 0) {
                return this._queue.shift();
            }
            if (this._closed) return null;
            return new Promise((resolve) => {
                let onAbort: any = null;
                const waiter = (task: any) => {
                    if (onAbort && abortSignal) {
                        try { abortSignal.removeEventListener('abort', onAbort); } catch (_) { /* intentional */ }
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
                        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.ts]', e);
                    }
                }
                this._waiters.push(waiter);
            });
        }

        close(): void {
            this._closed = true;
            while (this._waiters.length > 0) {
                const waiter = this._waiters.shift()!;
                waiter(null);
            }
        }

        get length(): number {
            return this._queue.length;
        }
    }

    async function ensureSubDir(root: any, subPath: string): Promise<any> {
        const fn = (globalThis as any).FsWriter?.ensureSubDir || fsEnsureSubDir;
        return await fn(root, subPath);
    }

    const getGeminiTab = async (slot?: string): Promise<any> =>
        ((globalThis as any).TabService || TabService)?.getGeminiTab?.(slot) ?? null;

    const getAssetPipelineClass = (): any => (globalThis as any).AssetPipeline || null;

    class ExportOrchestrator {
        aborted: boolean;
        _abortController: AbortController | null;
        rateLimiter: any;

        get rateLimitCooldownUntil(): number {
            return this.rateLimiter ? this.rateLimiter.rateLimitCooldownUntil : 0;
        }
        set rateLimitCooldownUntil(v: number) {
            if (this.rateLimiter) this.rateLimiter.rateLimitCooldownUntil = v;
        }

        constructor() {
            this.aborted = false;
            this._abortController = null;
            const rlModule = getRateLimiter();
            if (!rlModule || !rlModule.RateLimitManager) throw new Error('RateLimitModule missing: ensure rateLimiter.ts is bundled');
            this.rateLimiter = new rlModule.RateLimitManager();
        }

        abort(): void {
            this.aborted = true;
            try { this._abortController && this._abortController.abort(); } catch (_) { /* intentional */ }
            try {
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                    chrome.runtime.sendMessage({ action: 'cancelExport' }, () => {
                        if (chrome.runtime.lastError) {}
                    });
                }
            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.ts]', e); }
            const recovery = getSessionRecovery();
            if (recovery && recovery.updateSessionStatus) {
                recovery.updateSessionStatus({ status: 'aborted' });
            }
        }

        async _initSession(options: ExportOptions, _callbacks: ExportCallbacks = {}): Promise<any> {
            const {
                selected = [],
                format = 'markdown',
                useZip = true,
                currentSlot = 'u0',
                skip = false,
                conversations = []
            } = options;

            if (!selected.length) {
                throw new Error('No items selected');
            }

            this.aborted = false;
            if (this.rateLimiter && typeof this.rateLimiter.reset === 'function') {
                this.rateLimiter.reset();
            }
            this._abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const abortSignal = this._abortController ? this._abortController.signal : null;

            const slot = currentSlot || 'u0';
            const Storage = __resolveModule('StorageService', null);
            let curIds = Storage ? await Storage.getExportedIds(slot) : {};
            if (!Storage && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                const expKey = exportedIdsKey(slot);
                const store = await chrome.storage.local.get([expKey]);
                curIds = store[expKey] || {};
            }
            if (options.exportedIds && typeof options.exportedIds === 'object') {
                curIds = { ...curIds, ...options.exportedIds };
            }

            const payloadIds: any[] = [];
            const skippedItems: any[] = [];

            const utils = getUtils();
            const checkUpdatedFn = (utils && typeof utils.checkIsUpdated === 'function')
                ? utils.checkIsUpdated
                : checkIsUpdated;

            for (const s of selected) {
                const sid = typeof s === 'string' ? s : s?.id;
                const nid = normId(sid);
                const itemPayload = {
                    id: sid,
                    title: s.title || sid,
                    url: s.url || s.href || `https://gemini.google.com/app/${sid}`,
                    timestamp: s.timestamp,
                    lastSeen: s.lastSeen
                };

                if (skip) {
                    const rec = curIds[sid] || curIds['c_' + nid] || curIds[nid] || null;
                    if (rec) {
                        const conv = (Array.isArray(conversations) ? conversations.find((c: any) => normId(c.id) === nid) : null) || (typeof s === 'object' ? s : null);
                        const isUpdated = checkUpdatedFn(conv || itemPayload, rec);
                        if (!isUpdated) {
                            skippedItems.push(itemPayload);
                            continue;
                        }
                    }
                }
                payloadIds.push(itemPayload);
            }

            const recovery = getSessionRecovery();
            if (recovery && recovery.updateSessionStatus) {
                await recovery.updateSessionStatus({
                    status: 'running',
                    slot,
                    total: selected.length,
                    current: skippedItems.length,
                    format,
                    useZip,
                    startTime: Date.now()
                });
            }

            return {
                payloadIds,
                skippedItems,
                totalSelected: selected.length,
                slot,
                Storage,
                curIds,
                abortSignal
            };
        }

        async _initWriter(options: ExportOptions, onLog: (msg: string, level?: string) => void): Promise<any> {
            const { useZip = true, dirHandle = null } = options;
            const exportFolderName = 'gemini_export';
            let batchDirHandle: any = null;
            let zip: any = null;
            let folder: any = null;
            let zipWriter: any = null;
            let fsWriter: any = null;
            let writer: any = null;

            if (useZip) {
                writer = createWriter('zip', { folderName: exportFolderName });
                zipWriter = writer;
                zip = (writer as any).zip;
                folder = (writer as any).folder;
            } else {
                if (!dirHandle) throw new Error('Directory handle not provided');
                try {
                    writer = createWriter('fs', { dirHandle, folderName: exportFolderName });
                    fsWriter = writer;
                    batchDirHandle = await (fsWriter as any).init();
                } catch (e: unknown) {
                    const errMsg = getErrorMessage(e);
                    onLog(`创建子文件夹失败: ${errMsg}`, 'warn');
                    const errObj = e as any;
                    const isPermissionRevoked = errObj?.name === 'NotAllowedError' || /permission|not\s*allowed/i.test(errMsg);
                    if (isPermissionRevoked) {
                        onLog('目录句柄权限失效，请重新授权文件夹', 'warn');
                    }
                    throw new ExportPipelineError(`无法创建导出子目录 "${exportFolderName}": ${errMsg}`, undefined, 'write', isPermissionRevoked);
                }
            }

            const writeFileDirect = async (localName: string, data: any): Promise<boolean> => {
                if (this.aborted) return false;
                try {
                    const cleanPath = sanitizeZipPath(localName);
                    if (writer) {
                        await writer.writeFile(cleanPath, data);
                        return true;
                    }
                    return false;
                } catch (e: unknown) {
                    const errMsg = getErrorMessage(e);
                    const errObj = e as any;
                    const isPermissionRevoked = errObj?.name === 'NotAllowedError'
                        || /permission|not\s*allowed/i.test(errMsg);
                    if (isPermissionRevoked) {
                        const I18n = (globalThis as any).I18n;
                        const permMsg = typeof I18n !== 'undefined'
                            ? I18n.t('fsPermissionRevoked')
                            : '文件夹访问权限已失效或被撤销，导出已中止';
                        onLog(permMsg, 'error');
                        this.abort();
                        return false;
                    }
                    onLog(`保存文件失败 (${localName}): ${errMsg}`, 'error');
                    return false;
                }
            };

            return { zip, folder, zipWriter, batchDirHandle, fsWriter, writer, writeFileDirect };
        }

        async _packageAndDownload(
            zipWriterOrZip: any,
            payloadIds: any[],
            downloadedAssets: number,
            totalAssets: number,
            options: ExportOptions,
            onLog: (msg: string, level?: string) => void,
            onProgress: (progress: any) => void
        ): Promise<void> {
            const zipFileName = `gemini_export_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
            const I18n = (globalThis as any).I18n;
            onLog(typeof I18n !== 'undefined' ? I18n.t('logPackagingZip') : '正在打包 ZIP 压缩包…', 'info');
            const onUpdate = (percent: number) => {
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
                : await zipWriterOrZip.generateAsync({ type: 'blob' }, (metadata: any) => onUpdate(metadata.percent));

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

        async run(options: ExportOptions, callbacks: ExportCallbacks = {}): Promise<ExportResult> {
            const onProgress = callbacks.onProgress || (() => {});
            const onLog = callbacks.onLog || (() => {});
            const onTitleUpdated = callbacks.onTitleUpdated || (() => {});
            const onItemExported = callbacks.onItemExported || (() => {});

            const session = await this._initSession(options, callbacks);
            const { payloadIds, skippedItems = [], totalSelected = options.selected?.length || 0, slot, Storage, curIds, abortSignal } = session;

            const {
                format = 'markdown',
                skip = false,
                includeIndex = false,
                includeAssets = true,
                useZip = true,
                currentSlot = 'u0',
                conversations = [],
                exportedIds = {},
                takeoutEngine = null
            } = options;

            const { zip, folder, zipWriter, batchDirHandle, writeFileDirect } = await this._initWriter(options, onLog);

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
            let failedChats: any[] = [];
            let failedAttachments: any[] = [];
            let skipped = skippedItems.length;
            let metaResults: any[] = [];

            const totalChats = totalSelected || payloadIds.length;

            const I18n = (globalThis as any).I18n;

            for (const sItem of skippedItems) {
                const sTitle = sItem.title || sItem.id;
                onLog(typeof I18n !== 'undefined'
                    ? (I18n.t('logExportSkippedAlreadyExported', sTitle) || `[${sTitle}] 跳过已导出内容 (无更新)`)
                    : `[${sTitle}] 跳过已导出内容 (无更新)`, 'info');
            }

            const ProgressReporterClass = getProgressReporter()?.ProgressReporter || ProgressReporter;
            const reporter = new ProgressReporterClass({
                totalChats,
                onProgress,
                onLog
            });

            const updateProgress = (chatIdx?: number, chatTitle?: string) => {
                reporter.update(chatIdx, chatTitle, { downloadedAssets, totalAssets });
            };


            if (payloadIds.length === 0) {
                updateProgress(totalChats, typeof I18n !== 'undefined' ? I18n.t('exportSkippedAll', skipped) : 'All items skipped');
            } else {
                updateProgress(skipped, 'Preparing...');
            }

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
                        // Decrement pending count and record failure if task throws
                        const meta = (task as any)?.__assetMeta || null;
                        if (meta) {
                            const errMsg = typeof e === 'object' && e !== null && 'message' in (e as any) ? String((e as any).message) : String(e);
                            chatFailedAssetsSet.add(meta.nid);
                            failedAttachments.push({
                                chatId: meta.chatId,
                                chatTitle: meta.listTitle,
                                file: meta.fileName,
                                error: errMsg || 'asset task threw'
                            });
                            onLog(`[${meta.listTitle || meta.chatId}] 附件任务异常，已记为失败: ${errMsg}`, 'warn');
                            const left = (pendingAssetsPerChat.get(meta.nid) || 1) - 1;
                            pendingAssetsPerChat.set(meta.nid, left);
                            if (left === 0) {
                                try { await finalizeChatExport(meta.chatId); } catch (_) { /* intentional */ }
                            }
                        } else if (typeof console !== 'undefined' && console.warn) {
                            console.warn('[GemExporter:exportOrchestrator.ts] attachment task threw without metadata', e);
                        }
                    }
                }
            };

            const consumerPool: Promise<void>[] = [];
            for (let i = 0; i < MAX_CONCURRENT; i++) {
                consumerPool.push(processAttachmentWorker());
            }

            const pendingAssetsPerChat = new Map<string, number>();
            const chatRecordsMap = new Map<string, any>();
            const chatFailedAssetsSet = new Set<string>();
            const finalizedChatsSet = new Set<string>();

            const recovery = getSessionRecovery();
            const worker = options.worker || getBatchWorker();

            async function finalizeChatExport(targetId: string) {
                if (recovery && recovery.finalizeChatExport) {
                    await recovery.finalizeChatExport(targetId, {
                        finalizedChatsSet,
                        chatRecordsMap,
                        chatFailedAssetsSet,
                        curIds,
                        exportedIds,
                        Storage,
                        slot,
                        onItemExported
                    });
                }
            }

            const CONCURRENCY = Math.max(1, typeof options.concurrency === 'number' ? options.concurrency : 3);
            let nextIndex = 0;
            let completedCount = skipped;

            const exportWorker = async () => {
                while (nextIndex < payloadIds.length && !this.aborted && !(abortSignal && abortSignal.aborted)) {
                    if (this.rateLimiter && typeof this.rateLimiter.waitForCooldown === 'function') {
                        const canProceed = await this.rateLimiter.waitForCooldown(abortSignal);
                        if (!canProceed || this.aborted || (abortSignal && abortSignal.aborted)) break;
                    } else if (this.rateLimitCooldownUntil && Date.now() < this.rateLimitCooldownUntil) {
                        const waitMs = Math.max(0, this.rateLimitCooldownUntil - Date.now());
                        if (waitMs > 0) {
                            await new Promise(r => setTimeout(r, waitMs));
                            if (this.aborted || (abortSignal && abortSignal.aborted)) break;
                        }
                    }

                    const currentIndex = nextIndex++;
                    const requestedItem = payloadIds[currentIndex];
                    if (!requestedItem) break;

                    // Per-chat error isolation: one failed chat must not abort the entire batch
                    try {
                        const nid = normId(requestedItem.id);
                        let res: any = null;
                        let retryCount = 0;
                        const maxRateLimitRetries = 3;

                        const I18n = (globalThis as any).I18n;

                        while (retryCount <= maxRateLimitRetries && !this.aborted && !(abortSignal && abortSignal.aborted)) {
                            res = worker && worker.fetchChatDetail
                                ? await worker.fetchChatDetail(requestedItem, currentIndex, totalChats, currentSlot, skip, format, abortSignal)
                                : null;

                            if (this.aborted || (abortSignal && abortSignal.aborted)) break;

                            const isLimited = (this.rateLimiter && typeof this.rateLimiter.isRateLimited === 'function')
                                ? this.rateLimiter.isRateLimited(res)
                                : isRateLimited(res);

                            if (isLimited && retryCount < maxRateLimitRetries) {
                                const delayMs = (this.rateLimiter && typeof this.rateLimiter.calculateBackoff === 'function')
                                    ? this.rateLimiter.calculateBackoff(retryCount)
                                    : calculateBackoff(retryCount);
                                if (this.rateLimiter && typeof this.rateLimiter.recordRateLimit === 'function') {
                                    this.rateLimiter.recordRateLimit(delayMs);
                                } else {
                                    this.rateLimitCooldownUntil = Date.now() + delayMs;
                                }
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
                        const chunkResults = res.results || (res.chat ? [res.chat] : []);
                        let chat = chunkResults[0] || { id: nid, title: requestedItem.title };
                        chat.id = nid;

                        const listC = conversations.find((c: any) => normId(c.id) === nid) || null;
                        const resolvedRes = worker && worker.resolveChat
                            ? await worker.resolveChat(chat, requestedItem, listC, takeoutEngine, currentSlot, onTitleUpdated, onLog)
                            : { chat, listTitle: chat.title, displayTitle: chat.title, isError: false, errMsg: null, isConfirmedDeleted: false, convsNeedSave: false };

                        if (resolvedRes.isError) {
                            failedChats.push({ id: chat.id || nid, title: resolvedRes.displayTitle, error: resolvedRes.errMsg, debug: chat._debug || null, raw: chat._raw || null, isDeleted: resolvedRes.isConfirmedDeleted });
                            if (typeof console !== 'undefined' && console.warn) {
                                console.warn('[Gemini Exporter] export empty detail', nid, resolvedRes.errMsg, 'chat keys', Object.keys(chat || {}));
                            }
                            completedCount++;
                            updateProgress(completedCount, resolvedRes.displayTitle);
                            continue;
                        }

                        chat = resolvedRes.chat || chat;
                        const listTitle = resolvedRes.listTitle;
                        chat.title = listTitle;

                        const actualMsgCount = Array.isArray(chat.messages) ? chat.messages.length : (chat.messageCount || 0);
                        let needUpdateStorage = !!resolvedRes.convsNeedSave;
                        if (listC && typeof listC === 'object' && actualMsgCount > 0 && listC.messageCount !== actualMsgCount) {
                            listC.messageCount = actualMsgCount;
                            needUpdateStorage = true;
                        }

                        if (needUpdateStorage) {
                            const storageService = Storage || __resolveModule('StorageService', null);
                            if (storageService && typeof storageService.updateConversation === 'function') {
                                try {
                                    await storageService.updateConversation(currentSlot, nid, (existing: any) => {
                                        if (listC) {
                                            // Route the title write-back through the canonical tier
                                            // arbitration: a lower-authority list snapshot must not
                                            // downgrade a higher-authority stored title.
                                            applyExportTitleWriteback(existing, listC);
                                            if (listC.messageCount) existing.messageCount = listC.messageCount;
                                        }
                                        return existing;
                                    });
                                } catch (err) {
                                    if (typeof console !== 'undefined' && console.warn) {
                                        console.warn('[Gemini Exporter] atomic updateConversation failed for', nid, err);
                                    }
                                }
                            }
                        }

                        const ChatFormatter = (globalThis as any).ChatFormatter;
                        const formatted = typeof ChatFormatter !== 'undefined' && ChatFormatter.formatContent
                            ? ChatFormatter.formatContent(chat, format)
                            : { content: JSON.stringify(chat, null, 2), ext: 'json' };

                        const content = formatted.content;
                        const ext = formatted.ext;
                        const safeBase = sanitizeFileName(listTitle, chat.id);
                        // In direct-write mode, probe for existing filename on disk to reuse
                        const resolveName = (((__resolveModule('GeminiUtils', null) as any)?.resolveExportFileName) || utilsResolveExportFileName);
                        const fileName = useZip
                            ? buildExportFileName(listTitle, chat.id, ext)
                            : await resolveName(listTitle, chat.id, ext, async (n: string) => {
                                try {
                                    if (!batchDirHandle || typeof batchDirHandle.getFileHandle !== 'function') return false;
                                    await batchDirHandle.getFileHandle(n, { create: false });
                                    return true;
                                } catch {
                                    return false;
                                }
                            });

                        const writeOk = await writeFileDirect(fileName, content);

                        let queuedAssetsForThisChat = 0;
                        const chatAssetTasks: (() => Promise<void>)[] = [];
                        const queueAsset = (item: any, isImage: boolean) => {
                            totalAssets++;
                            queuedAssetsForThisChat++;
                            updateProgress();
                            const assetTask = async () => {
                                let assetRes = { saved: false, failReason: '', localName: item.localName || item.fileName || (isImage ? 'image.jpg' : 'file.bin') };
                                if (assetPipeline) {
                                    assetRes = await assetPipeline.processAsset(item, chat, { isImage, listTitle });
                                }
                                if (assetRes.saved) {
                                    downloadedAssets++;
                                    updateProgress();
                                    const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                    pendingAssetsPerChat.set(nid, left);
                                    if (left === 0) await finalizeChatExport(chat.id);
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
                                    if (left === 0) await finalizeChatExport(chat.id);
                                }
                            };
                            (assetTask as any).__assetMeta = { nid, chatId: chat.id, listTitle, fileName: item.localName || item.fileName || (isImage ? 'image.jpg' : 'file.bin') };
                            chatAssetTasks.push(assetTask);
                        };

                        if (includeAssets && chat.messages && writeOk) {
                            for (const m of chat.messages) {
                                if (m.attachments && m.attachments.length) {
                                    for (const att of m.attachments) {
                                        if (att.type === 'image') {
                                            if (!m.images || !m.images.some((im: any) => im.localName === att.localName || im.url === att.url || im.fileName === att.fileName)) {
                                                queueAsset(att, true);
                                            }
                                            continue;
                                        }
                                        if (att.type !== 'file') continue;
                                        if ((att.url && att.url.includes('immersive_entry_chip')) && !att.contentMarkdown) continue;
                                        if (att.contentMarkdown) {
                                            if (att.contentMarkdown.includes('immersive_entry_chip') || att.contentMarkdown.includes('googleusercontent.com/immersive')) {
                                                continue;
                                            }
                                            if (useZip) {
                                                try {
                                                    await writeFileDirect(att.localName, att.contentMarkdown);
                                                    totalAssets++;
                                                    downloadedAssets++;
                                                    updateProgress();
                                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.ts]', e); }
                                            } else {
                                                totalAssets++;
                                                queuedAssetsForThisChat++;
                                                updateProgress();
                                                const mdTask = async () => {
                                                    const ok = await writeFileDirect(att.localName || `${safeBase}_${shortId(chat.id)}.md`, att.contentMarkdown);
                                                    if (ok) {
                                                        downloadedAssets++;
                                                        updateProgress();
                                                        const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                                        pendingAssetsPerChat.set(nid, left);
                                                        if (left === 0) await finalizeChatExport(chat.id);
                                                    } else {
                                                        chatFailedAssetsSet.add(nid);
                                                        const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                                        pendingAssetsPerChat.set(nid, left);
                                                        if (left === 0) await finalizeChatExport(chat.id);
                                                    }
                                                };
                                                (mdTask as any).__assetMeta = { nid, chatId: chat.id, listTitle, fileName: att.localName || 'doc.md' };
                                                chatAssetTasks.push(mdTask);
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
                                let exportTs = listC?.timestamp ?? chat.timestamp ?? null;
                                if (typeof exportTs === 'string') exportTs = new Date(exportTs).getTime();
                                const record = {
                                    title: listTitle,
                                    exportedAt: new Date().toISOString(),
                                    format: options.format || 'markdown',
                                    messageCount: actualMsgCount || chat.messageCount || chat.messages?.length || 0,
                                    chatTime: exportTs,
                                    status: 'ok'
                                };
                                chatRecordsMap.set(nid, record);
                                if (queuedAssetsForThisChat === 0) {
                                    await finalizeChatExport(chat.id);
                                } else {
                                    pendingAssetsPerChat.set(nid, queuedAssetsForThisChat);
                                    for (const task of chatAssetTasks) {
                                        attachmentQueue.push(task);
                                    }
                                }
                            }
                        } else {
                            const failReason = this.aborted ? 'Aborted due to permission revocation' : 'File write failed';
                            failedChats.push({
                                id: chat.id || nid,
                                title: listTitle,
                                error: failReason
                            });
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

                        if (recovery && recovery.updateSessionStatus) {
                            await recovery.updateSessionStatus({
                                status: 'running',
                                slot,
                                total: totalChats,
                                current: completedCount,
                                lastChatId: chat.id,
                                lastChatTitle: listTitle,
                                format,
                                useZip
                            });
                        } else {
                            try {
                                await SessionStore.setSession({
                                    status: 'running',
                                    slot,
                                    total: totalChats,
                                    current: completedCount,
                                    lastChatId: chat.id,
                                    lastChatTitle: listTitle,
                                    format,
                                    useZip
                                });
                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.ts]', e); }
                        }
                    } catch (e) {
                        const errMsg = typeof e === 'object' && e !== null && 'message' in (e as any) ? String((e as any).message) : String(e);
                        const failId = requestedItem.id || 'unknown';
                        const title = requestedItem.title || failId;
                        onLog(`[${title}] export failed, skipped: ${errMsg}`, 'error');
                        if (typeof console !== 'undefined' && console.warn) {
                            console.warn('[GemExporter:exportOrchestrator.ts] per-chat export failed for', failId, e);
                        }
                        failedChats.push({ id: failId, title, error: errMsg });
                        completedCount++;
                        try { updateProgress(completedCount, title); } catch (_) { /* intentional */ }
                    }
                }
            };

            const exportWorkers: Promise<void>[] = [];
            const workerCount = Math.min(CONCURRENCY, payloadIds.length);
            for (let w = 0; w < workerCount; w++) {
                exportWorkers.push(exportWorker());
            }
            try {
                await Promise.all(exportWorkers);
            } catch (e) {
                onLog(`导出调度异常: ${typeof e === 'object' && e !== null && 'message' in (e as any) ? (e as any).message : String(e)}`, 'error');
                throw e;
            }

            attachmentQueue.close();
            try {
                await Promise.all(consumerPool);
            } catch (e) {
                const I18n = (globalThis as any).I18n;
                if (this.aborted) onLog(typeof I18n !== 'undefined' ? I18n.t('logAssetsAborted') : '附件下载因终止而中断', 'warn');
            }

            if (includeIndex && metaResults.length > 0) {
                if (recovery && recovery.writeIndexAndMeta) {
                    await recovery.writeIndexAndMeta(metaResults, landedChats, downloadedAssets, totalAssets, writeFileDirect, folder, useZip);
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
                        totalChats,
                        downloadedAssets,
                        totalAssets,
                        skipped,
                        failedChats,
                        failedAttachments,
                        isDevMode
                    });
                }

                const sessionJson = {
                    exportedAt: new Date().toISOString(),
                    isDevMode,
                    summary: {
                        total: totalChats,
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
                }
            }

            if (useZip) {
                if (landedChats === 0 && skipped > 0 && failedChats.length === 0) {
                    onLog(typeof I18n !== 'undefined'
                        ? (I18n.t('logExportSkippedAllNoZip') || '所选对话均已导出且无更新，已全部跳过，无需生成 ZIP。')
                        : '所选对话均已导出且无更新，已全部跳过，无需生成 ZIP。', 'info');
                } else {
                    await this._packageAndDownload(zipWriter || zip, payloadIds, downloadedAssets, totalAssets, options, onLog, onProgress);
                }
            }

            if (recovery && recovery.updateSessionStatus) {
                await recovery.updateSessionStatus({
                    status: this.aborted ? 'aborted' : (failedChats.length > 0 ? 'completed_with_errors' : 'completed'),
                    slot,
                    total: totalChats,
                    current: landedChats + skipped,
                    failedCount: failedChats.length,
                    skipped
                });
            }

            return {
                landedChats,
                exportedCount: landedChats,
                failedChats,
                failedAttachments,
                skipped,
                totalAssets,
                downloadedAssets,
                aborted: this.aborted
            };
        }
    }

export {
    ExportOrchestrator,
    AsyncQueue,
    ensureSubDir
};

export const ExportOrchestratorModule: ExportOrchestratorModule = {
    ExportOrchestrator,
    AsyncQueue,
    ensureSubDir,
    sanitizeFileName,
    sanitizeZipPath,
    getExtensionVersion
};

(ExportOrchestratorModule as any).ExportOrchestrator = ExportOrchestrator;
(ExportOrchestratorModule as any).AsyncQueue = AsyncQueue;
(ExportOrchestratorModule as any).ensureSubDir = ensureSubDir;
(ExportOrchestratorModule as any).sanitizeFileName = sanitizeFileName;
(ExportOrchestratorModule as any).sanitizeZipPath = sanitizeZipPath;
(ExportOrchestratorModule as any).getExtensionVersion = getExtensionVersion;
(ExportOrchestratorModule as any).checkIsUpdated = checkIsUpdated;
(ExportOrchestratorModule as any).applyExportTitleWriteback = applyExportTitleWriteback;
(ExportOrchestratorModule as any).default = ExportOrchestratorModule;

if (typeof module === 'object' && module.exports) {
    module.exports = ExportOrchestratorModule;
}
export default ExportOrchestratorModule;
