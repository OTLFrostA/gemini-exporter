// src/core/engine/export/exportOrchestrator.ts - Export run coordinator (thin).
// P1: decomposed the 1006-line god file into focused modules:
//   exportTypes.ts     - shared option/callback/result contracts (leaf)
//   asyncQueue.ts      - abort-aware AsyncQueue (leaf)
//   exportProgress.ts  - single monotonic progress formula (P1-023) (leaf)
//   exportSession.ts   - session bootstrap: slot, exportedIds, payload filter
//   exportWriter.ts    - ZIP/directory writer init + package/download
//   chatExporter.ts    - per-chat pipeline (P1-011 error isolation, P1-013
//                        awaited finalize, P1-016 consumer safety net)
// This file only: dependency wiring, concurrency, run lifecycle.
// Public API unchanged: ExportOrchestrator, AsyncQueue, ensureSubDir,
// sanitizeFileName, sanitizeZipPath, getExtensionVersion (+checkIsUpdated on
// the module object). exportEngine.ts re-exports keep working untouched.

import { normId as utilsNormId } from '../../utils/utils.js';
import { sanitizeFileName as utilsSanitizeFileName } from '../../utils/utils.js';
import { sanitizeRelativePath as utilsSanitizeRelativePath } from '../../utils/utils.js';
import { getErrorMessage as utilsGetErrorMessage } from '../../utils/utils.js';
import { ExportPipelineError } from '../../../types/errors.js';
import { checkIsUpdated as utilsCheckIsUpdated } from '../../utils/utils.js';
import { ensureSubDir as fsEnsureSubDir } from '../writers/fsWriter.js';
import BatchWorker, { type BatchWorkerModule } from './batchWorker.js';
import SessionRecovery from './sessionRecovery.js';
import { AsyncQueue } from './asyncQueue.js';
export { AsyncQueue };
import { calculateExportProgress } from './exportProgress.js';
import { initExportSession } from './exportSession.js';
import { initExportWriter, packageAndDownload } from './exportWriter.js';
import {
    exportSingleChat,
    startAttachmentConsumers,
    createChatExportState,
    resolveAssetPipelineClass,
    type ChatExportContext,
    type ChatExportState
} from './chatExporter.js';
import type { ExportCallbacks, ExportOptions, ExportResult } from './exportTypes.js';

// Re-export the shared contracts so existing import sites
// (exportEngine.ts, options UI) keep working unchanged.
export type { ExportCallbacks, ExportOptions, ExportResult, ExportOrchestratorModule } from './exportTypes.js';

export const normId = (id?: string | number | null): string =>
    ((globalThis as any).GeminiUtils?.normId || utilsNormId)(id);
export const sanitizeFileName = (name?: string | null, fallback?: string): string =>
    ((globalThis as any).GeminiUtils?.sanitizeFileName || utilsSanitizeFileName)(name, fallback);
export const sanitizeZipPath = (p?: string | null): string =>
    ((globalThis as any).GeminiUtils?.sanitizeRelativePath || utilsSanitizeRelativePath)(p, 'file');

const getUtils = (): any => (globalThis as any).GeminiUtils || null;
const checkIsUpdated = (c: any, rec?: any): boolean => {
    const utils = getUtils();
    if (utils && typeof utils.checkIsUpdated === 'function') return utils.checkIsUpdated(c, rec);
    return utilsCheckIsUpdated(c, rec);
};
const getErrorMessage = (e: unknown): string => {
    const fn = (globalThis as any).GeminiUtils?.getErrorMessage || utilsGetErrorMessage;
    try { return fn(e); } catch (_) { return String((e as any)?.message || e); }
};

export function getExtensionVersion(): string {
    try {
        const v = (globalThis as any).chrome?.runtime?.getManifest?.()?.version;
        return typeof v === 'string' && v ? v : '1.0.0';
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.ts]', e);
        return '1.0.0';
    }
}

export async function ensureSubDir(root: any, subPath: string): Promise<any> {
    const fn = (globalThis as any).FsWriter?.ensureSubDir || fsEnsureSubDir;
    return await fn(root, subPath);
}

const getBatchWorker = (): BatchWorkerModule => (globalThis as any).BatchWorker || BatchWorker;

function getSessionRecovery(): any {
    return (globalThis as any).SessionRecovery || SessionRecovery;
}

const getRateLimiter = (): any => (globalThis as any).RateLimitManager || null;

export class ExportOrchestrator {
    options: ExportOptions;
    callbacks: ExportCallbacks;
    aborted: boolean;
    _isExporting: boolean;
    rateLimiter: any;
    private _rateLimitCooldownUntil: number;
    private _abortController: AbortController | null;

    constructor(options: ExportOptions = {} as ExportOptions, callbacks: ExportCallbacks = {}) {
        this.options = options;
        this.callbacks = callbacks;
        this.aborted = false;
        this._isExporting = false;
        this.rateLimiter = null;
        this._rateLimitCooldownUntil = 0;
        this._abortController = null;

        const RateLimitManager = getRateLimiter();
        if (RateLimitManager) {
            this.rateLimiter = new RateLimitManager();
        }
    }

    get rateLimitCooldownUntil(): number {
        return this._rateLimitCooldownUntil;
    }

    set rateLimitCooldownUntil(v: number) {
        this._rateLimitCooldownUntil = v;
    }

    cancel(): void {
        this.abort();
    }

    abort(): void {
        this.aborted = true;
        try { this._abortController && this._abortController.abort(); } catch (_) { /* intentional */ }
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({ action: 'cancelExport' }, () => {
                    if (chrome.runtime.lastError) { /* intentional: best effort */ }
                });
            }
        } catch (e) {
            if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.ts]', e);
        }
        const recovery = getSessionRecovery();
        if (recovery && recovery.updateSessionStatus) {
            recovery.updateSessionStatus({ status: 'aborted' });
        }
    }

    isAborted(): boolean {
        return this.aborted;
    }

    async run(runOptions?: ExportOptions, runCallbacks?: ExportCallbacks): Promise<ExportResult> {
        if (this._isExporting) {
            throw new Error('Export already in progress');
        }
        this._isExporting = true;
        this.aborted = false;

        // The classic calling convention is `new ExportEngine()` + `run(options, callbacks)`.
        // Options/callbacks may also be supplied via the constructor; per-run args win.
        if (runOptions) this.options = runOptions;
        if (runCallbacks) this.callbacks = runCallbacks;
        const options = this.options;
        const {
            format = 'markdown',
            useZip = true,
            skip = false,
            includeAssets = true,
            currentSlot = 'u0',
            conversations = [],
            takeoutEngine = null
        } = options;

        const onProgress = this.callbacks.onProgress || (() => { /* intentional */ });
        const onLog = this.callbacks.onLog || (() => { /* intentional */ });
        const onTitleUpdated = this.callbacks.onTitleUpdated || (() => { /* intentional */ });
        const onItemExported = this.callbacks.onItemExported || (() => { /* intentional */ });

        const isAborted = () => this.aborted;

        try {
        // ---- Session bootstrap (exportSession.ts) ----
        const session = await initExportSession(options, {
            normId,
            checkIsUpdated,
            getUtils,
            getSessionRecovery,
            onLog,
            resetRateLimiter: () => {
                if (this.rateLimiter && typeof this.rateLimiter.reset === 'function') {
                    try { this.rateLimiter.reset(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.ts]', e); }
                }
                this._rateLimitCooldownUntil = 0;
            }
        });
        const {
            payloadIds,
            skippedItems,
            totalSelected,
            slot,
            Storage,
            abortSignal,
            abortController
        } = session;
        this._abortController = abortController;
        const curIds = session.curIds;
        const exportedIds = curIds;

        // ---- Writer init (exportWriter.ts) ----
        const writer = await initExportWriter(options, this, onLog);
        const { zip, folder, zipWriter, writeFileDirect } = writer;

        // ---- Shared per-run state (chatExporter.ts) ----
        const state: ChatExportState = createChatExportState(skippedItems.length);
        const totalChats = totalSelected;

        const updateProgress = (chatIdx?: number, chatTitle?: string) => {
            if (typeof chatIdx === 'number') state.currentExportIdx = chatIdx;
            if (typeof chatTitle === 'string' && chatTitle) state.currentExportTitle = chatTitle;
            const current = Math.min(state.currentExportIdx, totalChats);
            // P1-023: single monotonic formula from exportProgress.ts.
            const pct = calculateExportProgress({
                current,
                total: totalChats,
                downloadedAssets: state.downloadedAssets,
                totalAssets: state.totalAssets,
                prevPct: state.lastPct
            });
            state.lastPct = pct;
            onProgress({
                current,
                total: totalChats,
                pct,
                title: state.currentExportTitle,
                assetsDownloaded: state.downloadedAssets,
                assetsTotal: state.totalAssets
            });
        };

        const recovery = getSessionRecovery();

        // P1-014: finalize wrapper. Only marks a chat failed when the record
        // write itself failed (not when there was nothing to do).
        const finalizeChatExport = async (targetId: string, title?: string): Promise<boolean> => {
            if (!recovery || !recovery.finalizeChatExport) return false;
            const targetNid = normId(targetId);
            let ok = false;
            try {
                ok = await recovery.finalizeChatExport(targetId, {
                    finalizedChatsSet: state.finalizedChatsSet,
                    chatRecordsMap: state.chatRecordsMap,
                    chatFailedAssetsSet: state.chatFailedAssetsSet,
                    curIds,
                    exportedIds,
                    Storage,
                    slot,
                    onItemExported
                });
            } catch (e: unknown) {
                ok = false;
                onLog(`[${title || targetId}] 导出记录写入异常: ${getErrorMessage(e)}`, 'error');
            }
            if (!ok) {
                const shouldHaveFinalized = state.chatRecordsMap.get(targetNid)
                    && !state.finalizedChatsSet.has(targetNid)
                    && !state.chatFailedAssetsSet.has(targetNid);
                if (shouldHaveFinalized && !state.recordWriteFailedSet.has(targetNid)) {
                    state.recordWriteFailedSet.add(targetNid);
                    state.failedChats.push({
                        id: targetId,
                        title: title || targetId,
                        error: 'export record write failed; will retry on next incremental run'
                    });
                    onLog(`[${title || targetId}] 导出记录未能落盘，已记为失败，下次增量导出将重试`, 'error');
                }
            }
            return ok;
        };

        const updateSessionStatus = async (patch: any): Promise<void> => {
            if (recovery && recovery.updateSessionStatus) {
                await recovery.updateSessionStatus(patch);
            }
        };

        // ---- Asset pipeline ----
        let assetPipeline: any = null;
        const AssetPipelineClass = resolveAssetPipelineClass();
        if (includeAssets && AssetPipelineClass) {
            assetPipeline = new AssetPipelineClass({
                folder,
                writeFileDirect,
                onLog,
                abortSignal,
                skipExisting: options.skipExisting !== false
            });
        }

        const worker = options.worker || getBatchWorker();

        // ---- Attachment consumers (chatExporter.ts, P1-016) ----
        const attachmentQueue = new AsyncQueue();
        const ctx: ChatExportContext = {
            options,
            format,
            skip,
            includeAssets,
            useZip,
            currentSlot,
            conversations,
            takeoutEngine,
            totalChats,
            slot,
            curIds,
            exportedIds,
            Storage,
            state,
            worker,
            assetPipeline,
            attachmentQueue,
            rateLimiter: this.rateLimiter,
            folder,
            writeFileDirect,
            abortSignal,
            isAborted,
            onProgress,
            onLog,
            onTitleUpdated,
            onItemExported,
            finalizeChatExport,
            updateProgress,
            updateSessionStatus
        };
        const attachmentPool = startAttachmentConsumers(ctx, 4);

        // ---- Worker pool (each chat fully error-isolated, P1-011) ----
        let nextIndex = 0;
        const exportWorker = async () => {
            while (nextIndex < payloadIds.length && !isAborted()) {
                if (this.rateLimiter && typeof this.rateLimiter.waitForCooldown === 'function') {
                    // P1-036/037: cooldown 等待可中断（返回 false 即取消），到期后
                    // 各 worker 错峰唤醒；返回 false 直接跳出，不再继续派发任务。
                    const cooldownOk = await this.rateLimiter.waitForCooldown(abortSignal);
                    if (!cooldownOk) break;
                }
                if (isAborted()) break;
                const currentIndex = nextIndex++;
                const requestedItem = payloadIds[currentIndex];
                if (!requestedItem) break;
                await exportSingleChat(ctx, requestedItem, currentIndex);
            }
        };

        try {
            const concurrency = Math.max(1, typeof options.concurrency === 'number' ? options.concurrency : 3);
            const exportWorkers: Promise<void>[] = [];
            for (let i = 0; i < concurrency; i++) {
                exportWorkers.push(exportWorker());
            }
            await Promise.all(exportWorkers);
        } catch (e) {
            // P1-011: exportSingleChat never throws, but a scheduler-level
            // failure must still be visible rather than vanish.
            onLog(`导出调度异常: ${getErrorMessage(e)}`, 'error');
            throw e;
        }

        // ---- Drain queue, finalize pending chats ----
        while (attachmentQueue.length > 0 && !isAborted()) {
            await new Promise(r => setTimeout(r, 200));
        }

        if (!isAborted()) {
            for (const [n, c] of state.pendingAssetsPerChat.entries()) {
                if (c > 0 && !state.chatFailedAssetsSet.has(n) && !state.finalizedChatsSet.has(n) && !state.recordWriteFailedSet.has(n)) {
                    await finalizeChatExport(n);
                }
            }
        }
        attachmentQueue.close();
        await Promise.all(attachmentPool);

        // Mark conversations whose export never completed (never silently OK).
        // Chats already recorded in failedChats keep their original error.
        const alreadyFailed = new Set(state.failedChats.map((f: any) => normId(f.id)));
        for (const it of payloadIds) {
            if (isAborted()) break;
            const nid2 = normId(typeof it === 'string' ? it : it.id);
            if (alreadyFailed.has(nid2)) continue;
            if (!state.finalizedChatsSet.has(nid2) && !state.chatFailedAssetsSet.has(nid2) && !state.recordWriteFailedSet.has(nid2)) {
                state.failedChats.push({
                    id: typeof it === 'string' ? it : it.id,
                    title: (typeof it === 'string' ? it : (it.title || it.id)),
                    error: 'Skipped or export did not complete'
                });
            }
        }

        if (state.convsNeedSave && Storage && Storage.set) {
            await Storage.set('conversations', conversations, slot);
        }

        // ---- Package & download ----
        if (!isAborted() && useZip) {
            if (state.landedChats === 0 && state.skipped > 0 && state.failedChats.length === 0) {
                const I18n = (globalThis as any).I18n;
                onLog(typeof I18n !== 'undefined'
                    ? (I18n.t('logExportSkippedAllNoZip') || '所选对话均已导出且无更新，已全部跳过，无需生成 ZIP。')
                    : '所选对话均已导出且无更新，已全部跳过，无需生成 ZIP。', 'info');
            } else {
                await packageAndDownload(zipWriter || zip, payloadIds, state.downloadedAssets, state.totalAssets, options, onLog, onProgress);
            }
        }

        // ---- Session recovery ----
        await updateSessionStatus({
            status: 'completed',
            slot,
            total: totalChats,
            current: state.completedCount,
            format,
            useZip,
            endTime: Date.now(),
            failedCount: state.failedChats.length
        });

        const result: ExportResult = {
            landedChats: state.landedChats,
            exportedCount: state.landedChats,
            failedChats: state.failedChats,
            failedAttachments: state.failedAttachments,
            skipped: state.skipped,
            totalAssets: state.totalAssets,
            downloadedAssets: state.downloadedAssets,
            aborted: this.aborted
        };

        return result;
        } finally {
            this._isExporting = false;
        }
    }
}

export const module = {
    ExportOrchestrator,
    AsyncQueue,
    ensureSubDir,
    sanitizeFileName,
    sanitizeZipPath,
    getExtensionVersion
};

(module as any).checkIsUpdated = checkIsUpdated;

if (typeof globalThis !== 'undefined') {
    if (!(globalThis as any).ExportOrchestrator) (globalThis as any).ExportOrchestrator = ExportOrchestrator;
}

if (typeof (globalThis as any).module !== 'undefined' && (globalThis as any).module.exports) {
    (globalThis as any).module.exports = module;
}

export default module;
