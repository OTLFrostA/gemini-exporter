
import type {
    UIExportOptions,
    UIExportCallbacks,
    UIExportResult,
    FailedChat,
    FailedAttachment,
    TakeoutExportSource,
    ExportProgress,
    DirectoryHandle,
} from "../../../types/ui.js";
import type { Conversation } from "../../../types/conversation.js";
import type { TitleSources } from "../../../types/conversation.js";
import type { I18nModule, TabServiceModule } from "../../../types/utils.js";
import type { StoredExportRecordMap } from "../../storage/storageCompatibility.js";
import type { StorageServiceModule } from "../../storage/storageService.js";
import {
    type ExportActivityRecord,
    type TitleResolution,
    type TitleResolutionInput
} from "../../utils/titleUtils.js";
import { isObjectRecord } from "../../utils/messageResponses.js";
import type { BatchWorkerRequestedItem } from "./batchWorker.js";
import type { ExportIndexMetaItem, FinalizeChatRecordEntry } from "./sessionRecovery.js";
import type { ProgressReporterModule } from "./progressReporter.js";

export interface ExportOptions {
    selected: UIExportOptions['selected'];
    format?: string;
    useZip?: boolean;
    currentSlot?: string;
    dirHandle?: UIExportOptions['dirHandle'];
    skip?: boolean;
    includeIndex?: boolean;
    includeAssets?: boolean;
    conversations?: Conversation[];
    exportedIds?: StoredExportRecordMap;
    takeoutEngine?: TakeoutExportSource | null;
    downloadHandler?: (blob: Blob, filename: string) => Promise<void> | void;
    worker?: Partial<BatchWorkerModule>;
    concurrency?: number;
    [key: string]: unknown;
}

export interface ExportCallbacks extends Omit<UIExportCallbacks, 'onItemExported'> {
    onLog?: (msg: string, level?: string) => void;
    onItemExported?: (id: string, record: FinalizeChatRecordEntry) => void;
}

interface ExportFailedChat extends Omit<FailedChat, 'error'> {
    error?: string | null;
    debug?: unknown;
    raw?: unknown;
    isDeleted?: boolean;
}

export interface ExportResult extends Omit<UIExportResult, 'failedChats'> {
    landedChats: number;
    exportedCount?: number;
    failedChats: ExportFailedChat[];
    failedAttachments: FailedAttachment[];
    skipped: number;
    totalAssets: number;
    downloadedAssets: number;
    aborted?: boolean;
}

interface ExportItemPayload extends BatchWorkerRequestedItem {
    id: string;
    title: string;
    url: string;
    timestamp?: number | null;
    lastSeen?: number | string;
}

interface ExportSessionContext {
    payloadIds: ExportItemPayload[];
    skippedItems: ExportItemPayload[];
    totalSelected: number;
    slot: string;
    Storage: StorageServiceModule & { isDevMode?: () => Promise<boolean> | boolean };
    curIds: StoredExportRecordMap;
    abortSignal: AbortSignal | null;
}

interface AssetTaskMeta {
    nid: string;
    chatId: string;
    listTitle?: string;
    fileName: string;
}

interface AssetTask {
    (): Promise<void>;
    __assetMeta?: AssetTaskMeta;
}

type WriteFileDirectFn = (localName: string | null | undefined, data: WriteFileContent) => Promise<void>;

interface ExportWriterContext {
    zip: JSZipLike | null;
    folder: unknown;
    zipWriter: IExportWriter | null;
    batchDirHandle: DirectoryHandle | null;
    fsWriter: IExportWriter | null;
    writer: IExportWriter;
    writeFileDirect: WriteFileDirectFn;
}

interface JSZipAsyncMetadata {
    percent: number;
}

interface JSZipLike {
    generateAsync(options: { type: 'blob' }, onUpdate?: (metadata: JSZipAsyncMetadata) => void): Promise<Blob>;
}

type ZipPackageSource = IExportWriter | JSZipLike | null;

interface ParseDriftChatEntry extends ChatParseDrift {
    id: string;
    title?: string;
}

function isNamedError(value: unknown, name: string): boolean {
    return value !== null
        && (typeof value === 'object' || typeof value === 'function')
        && 'name' in value
        && value.name === name;
}

function getOriginalErrorMessage(value: unknown): string {
    return typeof value === 'object' && value !== null && 'message' in value
        ? String(value.message)
        : String(value);
}

function asSpreadSource(value: unknown): object {
    if (value === null || value === undefined) return {};
    if (typeof value === 'object' || typeof value === 'function') return value;
    if (typeof value === 'string') return new String(value);
    return {};
}

function mergeTitleSources(listTitles: unknown, chatTitles: unknown): TitleSources {
    return {
        ...asSpreadSource(listTitles || {}),
        ...asSpreadSource(chatTitles || {})
    };
}

import { __resolveModule } from "../../utils/moduleOverrides.js";
import {
    AssetPipeline as AssetPipelineStatic,
    type AssetPipelineClass,
    type AssetPipelineInstance,
    type ProcessAssetResult
} from "../assetPipeline.js";
import GeminiUtils, {
    type GeminiUtilsModule,
    sanitizeFileName as utilsSanitizeFileName,
    normId as utilsNormId,
    sanitizeRelativePath,
    buildExportFileName,
    resolveExportFileName as utilsResolveExportFileName,
    getErrorMessage,
    checkIsUpdated as utilsCheckIsUpdated,
    getEffectiveTimestamp as utilsGetEffectiveTimestamp,
    setTitleBySource as utilsSetTitleBySource,
    cleanTitle as utilsCleanTitle,
    isRealTitle as utilsIsRealTitle,
    applyExportTitleWriteback
} from "../../utils/utils.js";
export { applyExportTitleWriteback };
import { stripInternalChipMarkdown } from "../../utils/chipUtils.js";
import { ExportPipelineError } from "../../../types/errors.js";
import BatchWorker, {
    type BatchWorkerModule,
    type WorkerChat,
    type WorkerMessageAttachment,
    type ResolveChatResult
} from "./batchWorker.js";
import SessionRecovery, { type SessionRecoveryModule } from "./sessionRecovery.js";
import rateLimitModule, {
    isRateLimited,
    calculateBackoff,
    abortableSleep,
    type ExportRateLimiter,
    type RateLimitModule
} from "./rateLimiter.js";
import progressReporterModule, { ProgressReporter } from "./progressReporter.js";
import TabService from "../../utils/tabService.js";
import { ensureSubDir as fsEnsureSubDir } from "../writers/fsWriter.js";
import { createWriter, type IExportWriter, type WriteFileContent } from "../writers/writerInterface.js";
import { SessionStore } from "../../storage/sessionStore.js";
import { StorageService as StorageServiceStatic } from "../../storage/storageService.js";
import type { StoredConversationFields } from "../../storage/storageCompatibility.js";
import { ChatFormatter, type FormattedResult } from "../chatFormatter.js";
import { shortId } from "../../utils/pathUtils.js";
import { extractChatParseDrift, chatRecordStatusWithDrift, type ChatParseDrift } from "./parseDrift.js";
import { I18n as I18nStatic } from "../../utils/i18n.js";
import { assertSchemaWritable } from "../../storage/schemaMigration.js";
import { FlightRecorder } from "../../diagnostics/flightRecorder.js";
import {
    buildExportCompletion,
    computeExportMessageCount,
    computeAuthoritativeTimestamp,
    resolveReliableTitleSource
} from "./exportCompletion.js";

import { EXT_VERSION, getExtensionVersion, DEFAULT_EXPORT_FOLDER_NAME } from "../../utils/constants.js";
export { EXT_VERSION, getExtensionVersion };

function toExportActivityRecord(value: unknown): ExportActivityRecord | null {
    if (!isObjectRecord(value)) return null;
    return {
        exportedAt: typeof value.exportedAt === 'string' || typeof value.exportedAt === 'number' ? value.exportedAt : undefined,
        chatTime: typeof value.chatTime === 'string' || typeof value.chatTime === 'number' ? value.chatTime : undefined,
        messageCount: typeof value.messageCount === 'number' ? value.messageCount : undefined,
        status: typeof value.status === 'string' ? value.status : undefined,
        hasFailedAssets: typeof value.hasFailedAssets === 'boolean' ? value.hasFailedAssets : undefined,
        isTruncated: typeof value.isTruncated === 'boolean' ? value.isTruncated : undefined,
        truncated: typeof value.truncated === 'boolean' ? value.truncated : undefined
    };
}

const getUtils = (): GeminiUtilsModule | null => __resolveModule<GeminiUtilsModule | null>('GeminiUtils', GeminiUtils);
const getI18n = (): I18nModule => __resolveModule<I18nModule>('I18n', I18nStatic);
const getProgressReporter = (): ProgressReporterModule => progressReporterModule;
const getBatchWorker = (): BatchWorkerModule => BatchWorker;
const getSessionRecovery = (): SessionRecoveryModule => SessionRecovery;
const getRateLimiter = (): RateLimitModule => rateLimitModule;

export const sanitizeFileName = (name?: string | null, fallback?: string): string =>
    ((getUtils()?.sanitizeFileName) || utilsSanitizeFileName)(name, fallback);

export const normId = (id?: string | number | null): string =>
    ((getUtils()?.normId) || utilsNormId)(id);

export const sanitizeZipPath = (p?: string | null): string =>
    ((getUtils()?.sanitizeRelativePath) || sanitizeRelativePath)(p, 'file');

export const checkIsUpdated = (
    c?: Partial<Conversation> | null,
    rec?: unknown
): boolean => ((getUtils()?.checkIsUpdated) || utilsCheckIsUpdated)(c, toExportActivityRecord(rec));

export const getEffectiveTimestamp = (c?: Partial<Conversation> | null): number =>
    ((getUtils()?.getEffectiveTimestamp) || utilsGetEffectiveTimestamp)(c);

export const setTitleBySource = (
    chat?: TitleResolutionInput | null,
    source?: string,
    rawTitle?: string
): TitleResolution =>
    ((getUtils()?.setTitleBySource) || utilsSetTitleBySource)(chat, source, rawTitle);

export const cleanTitle = (rawTitle?: string | null): string =>
    ((getUtils()?.cleanTitle) || utilsCleanTitle)(rawTitle);

export const isRealTitle = (title?: string | null, id?: string | number): boolean =>
    ((getUtils()?.isRealTitle) || utilsIsRealTitle)(title, id);

    function toIso(v: unknown): string | null {
        if (!v) return null;
        const ms = typeof v === 'number'
            ? v
            : v instanceof Date
                ? v.getTime()
                : typeof v === 'boolean'
                    ? Number(v)
                    : new Date(String(v)).getTime();
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }

    class AsyncQueue<T = unknown> {
        _queue: T[];
        _waiters: ((task: T | null) => void)[];
        _closed: boolean;

        constructor() {
            this._queue = [];
            this._waiters = [];
            this._closed = false;
        }

        push(task: T): boolean {
            if (this._closed) return false;
            if (this._waiters.length > 0) {
                const waiter = this._waiters.shift()!;
                waiter(task);
            } else {
                this._queue.push(task);
            }
            return true;
        }

        async pop(abortSignal?: AbortSignal | null): Promise<T | null> {
            if (this._queue.length > 0) {
                return this._queue.shift() ?? null;
            }
            if (this._closed) return null;
            return new Promise<T | null>((resolve) => {
                let onAbort: (() => void) | null = null;
                const waiter = (task: T | null) => {
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

    const ensureSubDir = fsEnsureSubDir;

    const getGeminiTab = async (slot?: string): Promise<chrome.tabs.Tab | null> =>
        (__resolveModule<TabServiceModule | null>('TabService', TabService))?.getGeminiTab?.(slot) ?? null;
    const sendToGeminiTab = (message: unknown, slot?: string, timeoutMs?: number): Promise<unknown> =>
        (__resolveModule<TabServiceModule>('TabService', TabService)).sendToGeminiTab(message, slot, timeoutMs);

    const getAssetPipelineClass = (): AssetPipelineClass | null =>
        __resolveModule<AssetPipelineClass | null>('AssetPipeline', AssetPipelineStatic);

    function isNotAllowedError(e: unknown, errMsg: string): boolean {
        const isNamedNotAllowed = e !== null && (typeof e === 'object' || typeof e === 'function')
            && 'name' in e && e.name === 'NotAllowedError';
        return isNamedNotAllowed || /permission|not\s*allowed/i.test(errMsg);
    }

    function getThrownMessage(e: unknown): string {
        return e !== null && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
    }

    function hasGenerateBlob(obj: unknown): obj is { generateBlob: (onUpdate?: (pct: number) => void) => Promise<Blob> } {
        return isObjectRecord(obj) && typeof obj.generateBlob === 'function';
    }

    function hasGenerateAsync(obj: unknown): obj is {
        generateAsync: (options: { type: 'blob' }, onUpdate?: (metadata: JSZipAsyncMetadata) => void) => Promise<Blob>;
    } {
        return isObjectRecord(obj) && typeof obj.generateAsync === 'function';
    }

    class ExportOrchestrator {
        aborted: boolean;
        _abortController: AbortController | null;
        rateLimiter: ExportRateLimiter;

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
                // G2 no-floating-promises: abort() 是同步方法，await 会改接口；
                // 状态写失败不能 unhandledrejection，catch 里记 debug 日志。
                recovery.updateSessionStatus({ status: 'aborted' }).catch((e) => {
                    if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.ts] updateSessionStatus failed on abort', e);
                });
            }
        }

        async _initSession(options: ExportOptions, _callbacks: ExportCallbacks = {}): Promise<ExportSessionContext> {
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
            // Phase A (P1-4): Storage 解析不再允许 null —— 静态 import 做 fallback，
            // 生产环境永远拿到真正的 StorageService；测试可用 __setModuleOverride 覆盖。
            // finalizeChatExport 只认 saveExportRecord 一条正式路径（fail-closed）。
            const Storage = __resolveModule<StorageServiceModule>('StorageService', StorageServiceStatic);
            let curIds: StoredExportRecordMap = await Storage.getExportedIds(slot);
            if (options.exportedIds && typeof options.exportedIds === 'object') {
                curIds = { ...curIds, ...options.exportedIds };
            }

            const payloadIds: ExportItemPayload[] = [];
            const skippedItems: ExportItemPayload[] = [];

            const utils = getUtils();
            const checkUpdatedFn = (utils && typeof utils.checkIsUpdated === 'function')
                ? utils.checkIsUpdated
                : checkIsUpdated;

            for (const s of selected) {
                const isStr = typeof s === 'string';
                const sObj = isStr ? undefined : s;
                const sid = isStr ? s : s.id;
                const nid = normId(sid);
                const itemPayload: ExportItemPayload = {
                    id: sid,
                    title: sObj?.title || sid,
                    url: sObj?.url || sObj?.href || `https://gemini.google.com/app/${sid}`,
                    timestamp: sObj?.timestamp,
                    lastSeen: sObj?.lastSeen
                };

                if (skip) {
                    // Triage #5 read-path fix: curIds is canonical-keyed — the
                    // StorageService read path collapses legacy alias keys, the
                    // raw store fallback is written canonical-only by
                    // setExportedIds/saveExportRecordsBatch, and caller-supplied
                    // options.exportedIds comes from the normalized in-memory
                    // store. A single canonical probe is enough.
                    const rec = curIds[nid] || null;
                    if (rec) {
                        const conv = (Array.isArray(conversations) ? conversations.find(c => normId(c.id) === nid) : null) || sObj || null;
                        const isUpdated = checkUpdatedFn(conv || itemPayload, rec);
                        if (!isUpdated) {
                            skippedItems.push(itemPayload);
                            FlightRecorder.record('export', 'item_skipped_unmodified', {
                                id: nid,
                                chatTime: isObjectRecord(rec) ? rec.chatTime : undefined,
                                exportedAt: isObjectRecord(rec) && 'exportedAt' in rec ? rec.exportedAt : undefined
                            });
                            continue;
                        }
                    }
                }
                payloadIds.push(itemPayload);
                FlightRecorder.record('export', 'item_enqueued', {
                    id: nid,
                    hasRecord: !!curIds[nid]
                });
            }

            FlightRecorder.record('export', 'pipeline_start', {
                total: selected.length,
                skipped: skippedItems.length,
                enqueued: payloadIds.length,
                skip
            });

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

        async _initWriter(options: ExportOptions, onLog: (msg: string, level?: string) => void): Promise<ExportWriterContext> {
            // P1-13: schema frozen 时写路径 fail-closed（读路径不受影响）
            await assertSchemaWritable();
            const { useZip = true, dirHandle = null } = options;
            const exportFolderName = DEFAULT_EXPORT_FOLDER_NAME;
            let batchDirHandle: DirectoryHandle | null = null;
            let zip: JSZipLike | null = null;
            let folder: unknown = null;
            let zipWriter: IExportWriter | null = null;
            let fsWriter: IExportWriter | null = null;
            let writer: IExportWriter;

            if (useZip) {
                writer = createWriter('zip', { folderName: exportFolderName });
                zipWriter = writer;
                const rawWriter: unknown = writer;
                const zipCandidate = isObjectRecord(rawWriter) ? rawWriter['zip'] : null;
                zip = hasGenerateAsync(zipCandidate) ? zipCandidate : null;
                folder = isObjectRecord(rawWriter) ? rawWriter['folder'] : null;
            } else {
                if (!dirHandle) throw new Error('Directory handle not provided');
                try {
                    writer = createWriter('fs', { dirHandle, folderName: exportFolderName });
                    fsWriter = writer;
                    if (typeof writer.init !== 'function') throw new TypeError('fsWriter.init is not a function');
                    batchDirHandle = await writer.init();
                } catch (e: unknown) {
                    const errMsg = getErrorMessage(e);
                    onLog(`创建子文件夹失败: ${errMsg}`, 'warn');
                    const isPermissionRevoked = isNotAllowedError(e, errMsg);
                    if (isPermissionRevoked) {
                        onLog('目录句柄权限失效，请重新授权文件夹', 'warn');
                    }
                    throw new ExportPipelineError(`无法创建导出子目录 "${exportFolderName}": ${errMsg}`, undefined, 'write', isPermissionRevoked);
                }
            }

            const writeFileDirect: WriteFileDirectFn = async (localName: string | null | undefined, data: WriteFileContent): Promise<void> => {
                if (this.aborted) throw new DOMException('Export aborted', 'AbortError');
                const cleanPath = sanitizeZipPath(localName);
                if (!writer) {
                    throw new ExportPipelineError(`无可用写入器，无法保存 (${localName})`, undefined, 'write');
                }
                try {
                    await writer.writeFile(cleanPath, data);
                } catch (e: unknown) {
                    const errMsg = getErrorMessage(e);
                    const isPermissionRevoked = isNotAllowedError(e, errMsg);
                    if (isPermissionRevoked) {
                        const I18n = getI18n();
                        onLog(I18n.t('fsPermissionRevoked'), 'error');
                        this.abort();
                    } else {
                        onLog(`保存文件失败 (${localName}): ${errMsg}`, 'error');
                    }
                    throw new ExportPipelineError(`保存文件失败 (${localName}): ${errMsg}`, undefined, 'write', isPermissionRevoked);
                }
            };

            return { zip, folder, zipWriter, batchDirHandle, fsWriter, writer, writeFileDirect };
        }

        async _packageAndDownload(
            zipWriterOrZip: ZipPackageSource,
            payloadIds: readonly unknown[],
            downloadedAssets: number,
            totalAssets: number,
            options: ExportOptions,
            onLog: (msg: string, level?: string) => void,
            onProgress: (progress: ExportProgress) => void
        ): Promise<void> {
            // B3: 取消后不再打包/下载 —— 取消是用户意图，不应触发下载回调
            if (this.aborted || this._abortController?.signal.aborted) return;
            const zipFileName = `gemini_export_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
            const I18n = getI18n();
            onLog(I18n.t('logPackagingZip'), 'info');
            const onUpdate = (percent: number) => {
                onProgress({
                    current: payloadIds.length,
                    total: payloadIds.length,
                    pct: Math.floor(percent),
                    title: I18n.t('progPackagingZip', Math.floor(percent)),
                    assetsDownloaded: downloadedAssets,
                    assetsTotal: totalAssets
                });
            };
            let blob: Blob;
            if (hasGenerateBlob(zipWriterOrZip)) {
                blob = await zipWriterOrZip.generateBlob(onUpdate);
            } else if (hasGenerateAsync(zipWriterOrZip)) {
                blob = await zipWriterOrZip.generateAsync({ type: 'blob' }, (metadata) => onUpdate(metadata.percent));
            } else {
                const generateAsync = zipWriterOrZip && 'generateAsync' in zipWriterOrZip
                    ? zipWriterOrZip.generateAsync
                    : undefined;
                blob = await generateAsync!({ type: 'blob' }, (metadata: JSZipAsyncMetadata) => onUpdate(metadata.percent));
            }

            if (options.downloadHandler && typeof options.downloadHandler === 'function') {
                await options.downloadHandler(blob, zipFileName);
            }
        }

        async run(options: ExportOptions, callbacks: ExportCallbacks = {}): Promise<ExportResult> {
            const onProgress = callbacks.onProgress || (() => {});
            const onLog = callbacks.onLog || (() => {});
            const onTitleUpdated = callbacks.onTitleUpdated || (() => {});
            const onItemExported = callbacks.onItemExported || (() => {});
            const onItemPendingAssets = callbacks.onItemPendingAssets || (() => {});

            const session = await this._initSession(options, callbacks);
            const { payloadIds, skippedItems = [], totalSelected = options.selected?.length || 0, slot, Storage, curIds, abortSignal } = session;
            // B3: _initSession 是异步的，期间用户可能已取消 —— 直接返回，不再初始化 writer/跑导出循环
            if (this.aborted || (abortSignal && abortSignal.aborted)) {
                onLog(getI18n().t('logExportAborted') || '导出已取消', 'warn');
                const earlyRecovery = getSessionRecovery();
                if (earlyRecovery && earlyRecovery.updateSessionStatus) {
                    await earlyRecovery.updateSessionStatus({
                        status: 'aborted',
                        slot,
                        total: totalSelected,
                        current: 0,
                        failedCount: 0,
                        skipped: skippedItems.length
                    });
                }
                return {
                    landedChats: 0,
                    exportedCount: 0,
                    failedChats: [],
                    failedAttachments: [],
                    skipped: skippedItems.length,
                    totalAssets: 0,
                    downloadedAssets: 0,
                    aborted: true
                };
            }

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

            const { zip, zipWriter, batchDirHandle, writer, writeFileDirect } = await this._initWriter(options, onLog);

            const AssetPipelineClass = getAssetPipelineClass();
            const assetPipeline: AssetPipelineInstance | null = AssetPipelineClass ? new AssetPipelineClass({
                currentSlot,
                useZip,
                writer,
                writeFileDirect,
                takeoutEngine,
                getGeminiTab,
                sendToGeminiTab,
                onLog
            }) : null;

            let totalAssets = 0;
            let downloadedAssets = 0;
            let landedChats = 0;
            let failedChats: ExportFailedChat[] = [];
            let failedAttachments: FailedAttachment[] = [];
            let parseDriftChats: ParseDriftChatEntry[] = [];
            let skipped = skippedItems.length;
            let metaResults: ExportIndexMetaItem[] = [];

            const totalChats = totalSelected || payloadIds.length;

            const I18n = getI18n();

            for (const sItem of skippedItems) {
                const sTitle = sItem.title || sItem.id;
                onLog(I18n.t('logExportSkippedAlreadyExported', sTitle) || `[${sTitle}] 跳过已导出内容 (无更新)`, 'info');
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
                updateProgress(totalChats, I18n.t('exportSkippedAll', skipped));
            } else {
                updateProgress(skipped, 'Preparing...');
            }

            const attachmentQueue = new AsyncQueue<AssetTask>();
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
                    } catch (e: unknown) {
                        const meta = task.__assetMeta;
                        if (meta) {
                            const errMsg = getThrownMessage(e);
                            chatFailedAssetsSet.add(meta.nid);
                            failedAttachments.push({
                                chatId: meta.chatId,
                                chatTitle: meta.listTitle,
                                file: meta.fileName,
                                error: errMsg || 'asset task threw'
                            });
                            if (!this.aborted && !(abortSignal && abortSignal.aborted)) {
                                onLog(`[${meta.listTitle || meta.chatId}] 附件任务异常，已记为失败: ${errMsg}`, 'warn');
                            }
                            const left = (pendingAssetsPerChat.get(meta.nid) || 1) - 1;
                            pendingAssetsPerChat.set(meta.nid, left);
                            if (left === 0) {
                                try { await finalizeChatExport(meta.chatId); } catch (_) { /* intentional */ }
                            }
                        } else if (typeof console !== 'undefined' && console.warn) {
                            console.warn('[GemExporter:exportOrchestrator.ts] attachment task threw without metadata', e);
                        }
                        if (abortSignal && abortSignal.aborted) break;
                    }
                }
            };

            const consumerPool: Promise<void>[] = [];
            for (let i = 0; i < MAX_CONCURRENT; i++) {
                consumerPool.push(processAttachmentWorker());
            }

            const pendingAssetsPerChat = new Map<string, number>();
            const chatRecordsMap = new Map<string, FinalizeChatRecordEntry>();
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
                            // B2: 冷却等待同样可被取消打断，不傻等整个窗口
                            await abortableSleep(waitMs, abortSignal);
                            if (this.aborted || (abortSignal && abortSignal.aborted)) break;
                        }
                    }

                    const currentIndex = nextIndex++;
                    const requestedItem = payloadIds[currentIndex];
                    if (!requestedItem) break;

                    // Per-chat error isolation: one failed chat must not abort the entire batch
                    try {
                        const nid = normId(requestedItem.id);
                        let rawRes: unknown = null;
                        let retryCount = 0;
                        const maxRateLimitRetries = 3;

                        const I18n = getI18n();

                        while (retryCount <= maxRateLimitRetries && !this.aborted && !(abortSignal && abortSignal.aborted)) {
                            rawRes = worker && worker.fetchChatDetail
                                ? await worker.fetchChatDetail(requestedItem, currentIndex, totalChats, currentSlot, skip, format, abortSignal)
                                : null;

                            if (this.aborted || (abortSignal && abortSignal.aborted)) break;

                            const isLimited = (this.rateLimiter && typeof this.rateLimiter.isRateLimited === 'function')
                                ? this.rateLimiter.isRateLimited(rawRes)
                                : isRateLimited(rawRes);

                            if (isLimited && retryCount < maxRateLimitRetries) {
                                const delayMs = (this.rateLimiter && typeof this.rateLimiter.calculateBackoff === 'function')
                                    ? this.rateLimiter.calculateBackoff(retryCount)
                                    : calculateBackoff(retryCount);
                                if (this.rateLimiter && typeof this.rateLimiter.recordRateLimit === 'function') {
                                    this.rateLimiter.recordRateLimit(delayMs);
                                } else {
                                    this.rateLimitCooldownUntil = Date.now() + delayMs;
                                }
                                onLog(I18n.t('logRateLimitedBackoff', requestedItem.title || nid, (delayMs / 1000).toFixed(1)), 'warn');
                                // B2: 退避等待可被取消打断 —— 取消后不再傻等整个退避窗口
                                const backoffAborted = await abortableSleep(delayMs, abortSignal);
                                retryCount++;
                                if (backoffAborted) break;
                                continue;
                            }
                            break;
                        }

                        if (this.aborted || (abortSignal && abortSignal.aborted)) break;

                        const res = isObjectRecord(rawRes) ? rawRes : null;
                        const success = typeof res?.success === 'boolean' ? res.success : Boolean(res?.success);
                        if (!res || !success) {
                            const fetchErr = typeof res?.error === 'string' ? res.error : 'unknown';
                            onLog(I18n.t('logFetchFailed', fetchErr), 'warn');
                            failedChats.push({ id: requestedItem.id, title: requestedItem.title || requestedItem.id, error: fetchErr });
                            onLog(I18n.t('logExportSkipped', requestedItem.title || requestedItem.id, fetchErr), 'warn');
                            completedCount++;
                            updateProgress(completedCount, requestedItem.title || requestedItem.id);
                            continue;
                        }

                        skipped += (typeof res.skipped === 'number' && Number.isFinite(res.skipped) ? res.skipped : 0);
                        let candidate: unknown;
                        if (Array.isArray(res.results) && res.results.length > 0) {
                            candidate = res.results[0];
                        } else if (res.chat !== undefined && res.chat !== null) {
                            candidate = res.chat;
                        }
                        let chat: WorkerChat & { id: string } = Object.assign(
                            // BatchWorker.resolveChat performs the existing runtime validation after the canonical id is assigned.
                            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
                            (candidate || { title: requestedItem.title }) as WorkerChat,
                            { id: nid }
                        );

                        const listC: Conversation | null = (conversations || []).find((c) => normId(c.id) === nid) || null;
                        const resolvedRes: ResolveChatResult = worker && worker.resolveChat
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

                        chat = resolvedRes.chat;
                        const listTitle = resolvedRes.listTitle;
                        chat.title = listTitle;
                        const chatId = resolvedRes.chat.id;

                        const actualMsgCount = computeExportMessageCount(chat);
                        let needUpdateStorage = !!resolvedRes.convsNeedSave;
                        if (listC && typeof listC === 'object' && actualMsgCount > 0 && listC.messageCount !== actualMsgCount) {
                            listC.messageCount = actualMsgCount;
                            needUpdateStorage = true;
                        }

                        if (needUpdateStorage) {
                            const storageService = Storage || __resolveModule<StorageServiceModule>('StorageService', StorageServiceStatic);
                            if (storageService && typeof storageService.updateConversation === 'function') {
                                try {
                                    await storageService.updateConversation(currentSlot, nid, (existing: StoredConversationFields) => {
                                        if (listC) {
                                            // Route the title write-back through the canonical tier
                                            // arbitration: a lower-authority list snapshot must not
                                            // downgrade a higher-authority stored title.
                                            const titleTarget: Record<string, unknown> = existing;
                                            applyExportTitleWriteback(titleTarget, listC);
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

                        let formatted: FormattedResult;
                        if (format === 'html') {
                            formatted = await ChatFormatter.formatHtmlCanonical(chat);
                        } else if (format === 'markdown') {
                            formatted = await ChatFormatter.formatMarkdownCanonical(chat);
                        } else {
                            formatted = ChatFormatter.formatContent(chat, format);
                        }

                        const content = formatted.content;
                        const ext = formatted.ext;
                        const safeBase = sanitizeFileName(listTitle, chatId);
                        const resolveName = ((getUtils()?.resolveExportFileName) || utilsResolveExportFileName);
                        const fileName = useZip
                            ? buildExportFileName(listTitle, chatId, ext)
                            : await resolveName(listTitle, chatId, ext, async (n: string) => {
                                try {
                                    if (!batchDirHandle || typeof batchDirHandle.getFileHandle !== 'function') return false;
                                    await batchDirHandle.getFileHandle(n, { create: false });
                                    return true;
                                } catch {
                                    return false;
                                }
                            });

                        let mainWriteError: unknown = null;
                        try {
                            await writeFileDirect(fileName, content);
                        } catch (e: unknown) {
                            mainWriteError = e;
                        }

                        let queuedAssetsForThisChat = 0;
                        const chatAssetTasks: AssetTask[] = [];
                        const queueAsset = (item: WorkerMessageAttachment, isImage: boolean) => {
                            totalAssets++;
                            queuedAssetsForThisChat++;
                            updateProgress();
                            const assetTask: AssetTask = async () => {
                                let assetRes: ProcessAssetResult = {
                                    saved: false,
                                    failReason: '',
                                    localName: item.localName || item.fileName || (isImage ? 'image.jpg' : 'file.bin'),
                                    recoveredFromTakeout: false
                                };
                                if (assetPipeline) {
                                    assetRes = await assetPipeline.processAsset(item, chat, { isImage, listTitle, signal: abortSignal });
                                }
                                if (assetRes.saved) {
                                    downloadedAssets++;
                                    updateProgress();
                                    const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                    pendingAssetsPerChat.set(nid, left);
                                    if (left === 0) await finalizeChatExport(chatId);
                                } else {
                                    chatFailedAssetsSet.add(nid);
                                    // decrement 紧跟 add(nid)：regression lock 要求失败分支必须
                                    // decrement pendingAssetsPerChat，否则 finalize 永远等不到 left===0。
                                    const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                    pendingAssetsPerChat.set(nid, left);
                                    failedAttachments.push({
                                        chatId,
                                        chatTitle: listTitle || chat.title || chatId,
                                        file: assetRes.localName,
                                        error: assetRes.failReason || 'CDN auth expired',
                                        sourceUrl: typeof item.sourceUrl === 'string' ? item.sourceUrl
                                            : typeof item.src === 'string' ? item.src
                                                : typeof item.url === 'string' ? item.url : undefined,
                                        sourceEvidence: item.sourceEvidence
                                    });
                                    const logKey = isImage ? 'logImageFailed' : 'logAssetFailed';
                                    onLog(getI18n().t(logKey, chat.title || chatId, assetRes.localName, assetRes.failReason || 'CDN auth expired'), 'warn');
                                    if (left === 0) await finalizeChatExport(chatId);
                                }
                            };
                            assetTask.__assetMeta = { nid, chatId, listTitle, fileName: item.localName || item.fileName || (isImage ? 'image.jpg' : 'file.bin') };
                            chatAssetTasks.push(assetTask);
                        };

                        if (includeAssets && chat.messages && !mainWriteError) {
                            for (const m of chat.messages) {
                                if (m.attachments && m.attachments.length) {
                                    for (const att of m.attachments) {
                                        if (att.type === 'image') {
                                            if (!m.images || !m.images.some((im: WorkerMessageAttachment) => im.localName === att.localName || im.url === att.url || im.fileName === att.fileName)) {
                                                queueAsset(att, true);
                                            }
                                            continue;
                                        }
                                        if (att.type !== 'file') continue;
                                        if ((typeof att.url === 'string' && att.url.includes('immersive_entry_chip')) && !att.contentMarkdown) continue;
                                        if (att.contentMarkdown) {
                                            const docMarkdown = typeof att.contentMarkdown === 'string' ? att.contentMarkdown : '';
                                            const cleanDocMd = stripInternalChipMarkdown(docMarkdown).trim();
                                            if (!cleanDocMd) {
                                                continue;
                                            }
                                            if (useZip) {
                                                try {
                                                    await writeFileDirect(att.localName, cleanDocMd);
                                                    totalAssets++;
                                                    downloadedAssets++;
                                                    updateProgress();
                                                } catch (e: unknown) {
                                                    // 取消不记为资产失败，直接向上传播（B3 会进一步区分取消语义）
                                                    if (isNamedError(e, 'AbortError') || this.aborted) throw e;
                                                    chatFailedAssetsSet.add(nid);
                                                    failedAttachments.push({ chatId, chatTitle: listTitle || chat.title || chatId, file: att.localName, error: getErrorMessage(e) });
                                                }
                                            } else {
                                                totalAssets++;
                                                queuedAssetsForThisChat++;
                                                updateProgress();
                                                const mdTask: AssetTask = async () => {
                                                    const docFileName = att.localName || `${safeBase}_${shortId(chatId)}.md`;
                                                    try {
                                                        await writeFileDirect(docFileName, cleanDocMd);
                                                        downloadedAssets++;
                                                    } catch (e: unknown) {
                                                        // 取消不记为资产失败，直接向上传播
                                                        if (isNamedError(e, 'AbortError') || this.aborted) throw e;
                                                        chatFailedAssetsSet.add(nid);
                                                        failedAttachments.push({ chatId, chatTitle: listTitle || chat.title || chatId, file: docFileName, error: getErrorMessage(e) });
                                                    }
                                                    updateProgress();
                                                    const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                                    pendingAssetsPerChat.set(nid, left);
                                                    if (left === 0) await finalizeChatExport(chatId);
                                                };
                                                mdTask.__assetMeta = { nid, chatId, listTitle, fileName: att.localName || 'doc.md' };
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

                        // P1-8/P1-9: parser 诊断随 chat 透出，不在生产环境静默
                        const chatDrift = extractChatParseDrift(chat);
                        const driftNotable = chatDrift.turnsRejected > 0 || chatDrift.schemaDrift.length > 0 || chatDrift.hasHeuristicDocs;

                        if (!mainWriteError) {
                            landedChats++;
                            onLog(getI18n().t('logExportSuccess', listTitle, fileName), 'info');
                            if (!chat.error && !chat._empty) {
                                if (driftNotable) {
                                    const bits: string[] = [];
                                    if (chatDrift.turnsRejected > 0) bits.push(`拒识 ${chatDrift.turnsRejected} 个 turn`);
                                    if (chatDrift.schemaDrift.length > 0) bits.push(`${chatDrift.schemaDrift.length} 条 schema 漂移告警`);
                                    if (chatDrift.hasHeuristicDocs) bits.push(`含启发式拼凑文档`);
                                    const driftStatus = chatRecordStatusWithDrift('ok', chatDrift);
                                    const statusNote = driftStatus === 'partial' ? '，已记为部分导出' : '（仅告警，导出记录仍为正常）';
                                    onLog(`[${listTitle}] 解析异常（${bits.join("；")}）${statusNote}`, 'warn');
                                    parseDriftChats.push({
                                        id: chatId,
                                        title: listTitle,
                                        schemaDrift: chatDrift.schemaDrift,
                                        turnsRejected: chatDrift.turnsRejected,
                                        hasHeuristicDocs: chatDrift.hasHeuristicDocs
                                    });
                                }
                                const isChatTruncated = Boolean(chat.truncated || chat.isTruncated);
                                if (isChatTruncated) {
                                    onLog(`[${listTitle}] 会话内容超出最大拉取深度或检测到游标异常，已截断导出并标记为部分导出 (partial)`, 'warn');
                                }
                                const baseStatus = (actualMsgCount === 0 || !!chat.isEmpty) ? 'empty' : 'ok';
                                const driftStatus = chatRecordStatusWithDrift(baseStatus, chatDrift);
                                const statusOverride = isChatTruncated
                                    ? 'partial'
                                    : (driftStatus === 'partial' ? 'partial' : undefined);

                                const authoritativeChatTime = Math.max(
                                    computeAuthoritativeTimestamp(listC) || 0,
                                    computeAuthoritativeTimestamp(chat) || 0
                                ) || undefined;

                                const completion = buildExportCompletion({
                                    conversation: chat,
                                    conversationId: nid,
                                    format: options.format || 'markdown',
                                    exportedAt: new Date().toISOString(),
                                    titleCandidate: listTitle,
                                    titleProvenance: resolveReliableTitleSource(
                                        typeof chat.titleSource === 'string' ? chat.titleSource : undefined,
                                        listC?.titleSource
                                    ),
                                    titles: mergeTitleSources(listC?.titles, chat.titles),
                                    messageCount: actualMsgCount,
                                    chatTime: authoritativeChatTime,
                                    statusOverride,
                                    isTruncated: isChatTruncated,
                                    truncateReason: isChatTruncated
                                        ? (typeof chat.truncateReason === 'string' ? chat.truncateReason : 'truncated')
                                        : undefined
                                });

                                chatRecordsMap.set(nid, {
                                    ...completion.exportRecord,
                                    exportRecord: completion.exportRecord,
                                    conversationUpdate: completion.conversationUpdate,
                                    targetId: completion.targetId
                                });
                                if (queuedAssetsForThisChat === 0) {
                                    await finalizeChatExport(chatId);
                                } else {
                                    pendingAssetsPerChat.set(nid, queuedAssetsForThisChat);
                                    try {
                                        onItemPendingAssets(chatId, queuedAssetsForThisChat);
                                    } catch { /* intentional */ }
                                    for (const task of chatAssetTasks) {
                                        const enqueued = attachmentQueue.push(task);
                                        if (!enqueued) {
                                            chatFailedAssetsSet.add(nid);
                                            const meta = task.__assetMeta;
                                            if (meta) {
                                                failedAttachments.push({
                                                    chatId: meta.chatId,
                                                    chatTitle: meta.listTitle,
                                                    file: meta.fileName,
                                                    error: 'Queue closed / export cancelled'
                                                });
                                            }
                                            const left = (pendingAssetsPerChat.get(nid) || 1) - 1;
                                            pendingAssetsPerChat.set(nid, left);
                                            if (left === 0) {
                                                await finalizeChatExport(chatId);
                                            }
                                        }
                                    }
                                }
                            }
                        } else {
                            // B3: 区分用户取消 vs 权限被收回 —— 取消是用户意图，不记失败；
                            // 权限被收回是真实失败（writeFileDirect 已 abort 并记日志），保留失败记录。
                            const userCancelled = isNamedError(mainWriteError, 'AbortError');
                            if (userCancelled) {
                                onLog(`[${listTitle}] 导出已取消`, 'warn');
                                break;
                            }
                            const permissionRevoked = mainWriteError instanceof ExportPipelineError && !!mainWriteError.isPermissionRevoked;
                            const failReason = permissionRevoked
                                ? 'Aborted due to permission revocation'
                                : getErrorMessage(mainWriteError);
                            failedChats.push({
                                id: chat.id || nid,
                                title: listTitle,
                                error: failReason
                            });
                        }

                        metaResults.push({
                            id: chatId,
                            title: listTitle,
                            url: chat.url || `https://gemini.google.com/app/${chatId}`,
                            createdAt: toIso(chat.createdAt || chat.timestamp || listC?.timestamp),
                            updatedAt: toIso(chat.updatedAt || chat.timestamp || listC?.timestamp),
                            messageCount: computeExportMessageCount(chat),
                            attachmentCount: queuedAssetsForThisChat || (typeof chat.attachmentCount === 'number' && Number.isFinite(chat.attachmentCount) ? chat.attachmentCount : 0),
                            exportFile: fileName,
                            status: mainWriteError ? 'failed' : 'success',
                            ...(driftNotable ? {
                                parseStatus: chatRecordStatusWithDrift('ok', chatDrift),
                                schemaDrift: chatDrift.schemaDrift,
                                turnsRejected: chatDrift.turnsRejected,
                                hasHeuristicDocs: chatDrift.hasHeuristicDocs || void 0
                            } : {})
                        });

                        completedCount++;
                        updateProgress(completedCount, listTitle);

                        if (recovery && recovery.updateSessionStatus) {
                            await recovery.updateSessionStatus({
                                status: 'running',
                                slot,
                                total: totalChats,
                                current: completedCount,
                                lastChatId: chatId,
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
                                    lastChatId: chatId,
                                    lastChatTitle: listTitle,
                                    format,
                                    useZip
                                });
                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:exportOrchestrator.ts]', e); }
                        }
                    } catch (e: unknown) {
                        // B3: AbortError = 用户取消（资产任务/写文件向上抛）—— 不记失败，直接结束
                        if (isNamedError(e, 'AbortError')) {
                            onLog(`[${requestedItem.title || requestedItem.id}] 导出已取消`, 'warn');
                            break;
                        }
                        const errMsg = getOriginalErrorMessage(e);
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
            } catch (e: unknown) {
                onLog(`导出调度异常: ${getOriginalErrorMessage(e)}`, 'error');
                throw e;
            }

            attachmentQueue.close();
            try {
                await Promise.all(consumerPool);
            } catch (e: unknown) {
                if (this.aborted) onLog(getI18n().t('logAssetsAborted'), 'warn');
            }

            if (includeIndex && metaResults.length > 0) {
                if (recovery && recovery.writeIndexAndMeta) {
                    try {
                        await recovery.writeIndexAndMeta(metaResults, landedChats, downloadedAssets, totalAssets, writer);
                    } catch (e: unknown) {
                        // index 写崩 = 导出契约不完整：记用户可见错误后 fail-closed 外抛
                        onLog(getErrorMessage(e), 'error');
                        throw e;
                    }
                }
            }

            const isDevMode = Storage && typeof Storage.isDevMode === 'function'
                ? await Storage.isDevMode()
                : false;

            // B3: 取消时不写 _export_errors.json —— 取消是用户意图，不是失败
            // P1-8: parser 漂移同样触发诊断文件（成功但 partial 的会话不能静默）
            if ((isDevMode || failedChats.length > 0 || failedAttachments.length > 0 || parseDriftChats.length > 0)
                && !this.aborted && !(abortSignal && abortSignal.aborted)) {
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
                        parseDrift: parseDriftChats,
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
                    failedAttachments,
                    parseDrift: parseDriftChats
                };

                if (recovery && recovery.writeDiagnostics) {
                    try {
                        await recovery.writeDiagnostics(isDevMode, sessionJson, fullLogText, writer, onLog);
                    } catch (e: unknown) {
                        // 诊断文件是 best-effort：记用户可见错误但不外抛，
                        // 避免"写错误报告失败后再写错误报告"的递归
                        onLog(getErrorMessage(e), 'error');
                    }
                }
            }

            // B3: 取消后跳过打包/下载（同 _packageAndDownload 首行判定）—— 无下载回调
            if (!this.aborted && !(abortSignal && abortSignal.aborted) && useZip) {
                if (landedChats === 0 && skipped > 0 && failedChats.length === 0) {
                    onLog(getI18n().t('logExportSkippedAllNoZip'), 'info');
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

export const ExportOrchestratorModule = {
    ExportOrchestrator,
    AsyncQueue,
    ensureSubDir,
    sanitizeFileName,
    sanitizeZipPath,
    getExtensionVersion
};

export type ExportOrchestratorModule = typeof ExportOrchestratorModule;

export default ExportOrchestratorModule;
