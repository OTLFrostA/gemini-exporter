// src/core/engine/export/chatExporter.ts - Single-chat export pipeline.
// Split out of exportOrchestrator.ts (P1: god-file decomposition).
// Responsibility: fetch -> resolve -> format -> write -> queue assets for ONE
// conversation. P1-011: the whole per-chat body runs inside try/catch so a
// single chat throwing (P0-6/P0-7 class defects) can never kill the entire run;
// failures are recorded in failedChats and the run continues.
// Also hosts the attachment consumer pool; P1-016: a task that throws no
// longer swallows the exception NOR leaks pendingAssetsPerChat.

import type { ExportCallbacks, ExportOptions } from './exportTypes.js';
import { AsyncQueue } from './asyncQueue.js';
import {
    normId as utilsNormId,
    sanitizeFileName as utilsSanitizeFileName,
    buildExportFileName as utilsBuildExportFileName,
    getErrorMessage as utilsGetErrorMessage
} from '../../utils/utils.js';
import { isRateLimited, calculateBackoff, abortableSleep } from './rateLimiter.js';

const normId = (id?: string | number | null): string =>
    ((globalThis as any).GeminiUtils?.normId || utilsNormId)(id);
const sanitizeFileName = (name?: string | null, fallback?: string): string =>
    ((globalThis as any).GeminiUtils?.sanitizeFileName || utilsSanitizeFileName)(name, fallback);
const buildExportFileName = (title: string, id: string, ext: string): string => {
    const fn = (globalThis as any).GeminiUtils?.buildExportFileName || utilsBuildExportFileName;
    return fn(title, id, ext);
};
const getErrorMessage = (e: unknown): string => {
    const fn = (globalThis as any).GeminiUtils?.getErrorMessage || utilsGetErrorMessage;
    try { return fn(e); } catch (_) { return String((e as any)?.message || e); }
};

function toIso(v: any): string | null {
    if (!v) return null;
    const ms = typeof v === 'number' ? v : new Date(v).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Mutable per-run state shared between the orchestrator and chat export. */
export interface ChatExportState {
    totalAssets: number;
    downloadedAssets: number;
    landedChats: number;
    failedChats: any[];
    failedAttachments: any[];
    skipped: number;
    metaResults: any[];
    completedCount: number;
    convsNeedSave: boolean;
    currentExportTitle: string;
    currentExportIdx: number;
    lastPct: number;
    pendingAssetsPerChat: Map<string, number>;
    chatRecordsMap: Map<string, any>;
    chatFailedAssetsSet: Set<string>;
    finalizedChatsSet: Set<string>;
    /** P1-014: chats whose export record failed to persist (retryable). */
    recordWriteFailedSet: Set<string>;
}

export function createChatExportState(skippedCount: number): ChatExportState {
    return {
        totalAssets: 0,
        downloadedAssets: 0,
        landedChats: 0,
        failedChats: [],
        failedAttachments: [],
        skipped: skippedCount,
        metaResults: [],
        completedCount: skippedCount,
        convsNeedSave: false,
        currentExportTitle: '',
        currentExportIdx: skippedCount,
        lastPct: 0,
        pendingAssetsPerChat: new Map(),
        chatRecordsMap: new Map(),
        chatFailedAssetsSet: new Set(),
        finalizedChatsSet: new Set(),
        recordWriteFailedSet: new Set()
    };
}

export interface ChatExportContext {
    options: ExportOptions;
    format: string;
    skip: boolean;
    includeAssets: boolean;
    useZip: boolean;
    currentSlot: string;
    conversations: any[];
    takeoutEngine: any;
    totalChats: number;
    slot: string;
    curIds: Record<string, any>;
    exportedIds: Record<string, any>;
    Storage: any;
    state: ChatExportState;
    /** Resolved batch worker (fetchChatDetail/resolveChat), injected. */
    worker: any;
    assetPipeline: any;
    attachmentQueue: AsyncQueue;
    rateLimiter: any;
    folder: any;
    writeFileDirect: (localName: string, data: any) => Promise<boolean>;
    abortSignal: AbortSignal | null;
    isAborted: () => boolean;
    onProgress: (p: any) => void;
    onLog: (m: string, l?: string) => void;
    onTitleUpdated: (id: string, t: string, s?: string) => void;
    onItemExported: (id: string, r: any) => void;
    /** Persist one chat's export record; resolves false when nothing was done or the write failed. */
    finalizeChatExport: (targetId: string, title?: string) => Promise<boolean>;
    updateProgress: (chatIdx?: number, chatTitle?: string) => void;
    updateSessionStatus: (patch: any) => Promise<void>;
}

const getChatFormatter = (): any => (globalThis as any).ChatFormatter || null;
const getAssetPipelineClass = (): any => (globalThis as any).AssetPipeline || null;

/**
 * Export one conversation. Never throws: every failure mode is recorded in
 * state.failedChats / state.failedAttachments and the run continues. (P1-011)
 */
export async function exportSingleChat(
    ctx: ChatExportContext,
    requestedItem: any,
    currentIndex: number
): Promise<void> {
    const { state } = ctx;
    const nid = normId(requestedItem.id);

    try {
        let res: any = null;
        let retryCount = 0;
        const maxRateLimitRetries = 3;
        const I18n = (globalThis as any).I18n;

        while (retryCount <= maxRateLimitRetries && !ctx.isAborted()) {
            res = ctx.worker && ctx.worker.fetchChatDetail
                ? await ctx.worker.fetchChatDetail(requestedItem, currentIndex, ctx.totalChats, ctx.currentSlot, ctx.skip, ctx.format, ctx.abortSignal)
                : null;

            if (ctx.isAborted()) break;

            const isLimited = (ctx.rateLimiter && typeof ctx.rateLimiter.isRateLimited === 'function')
                ? ctx.rateLimiter.isRateLimited(res)
                : isRateLimited(res);

            if (isLimited && retryCount < maxRateLimitRetries) {
                // P1-039: honor the server Retry-After hint when present.
                const retryAfterOpt = (res as any)?.retryAfterMs != null ? { retryAfterMs: (res as any).retryAfterMs } : undefined;
                const delayMs = (ctx.rateLimiter && typeof ctx.rateLimiter.calculateBackoff === 'function')
                    ? ctx.rateLimiter.calculateBackoff(retryCount, retryAfterOpt)
                    : calculateBackoff(retryCount, retryAfterOpt);
                if (ctx.rateLimiter && typeof ctx.rateLimiter.recordRateLimit === 'function') {
                    ctx.rateLimiter.recordRateLimit(delayMs);
                }
                ctx.onLog(typeof I18n !== 'undefined'
                    ? I18n.t('logRateLimitedBackoff', requestedItem.title || nid, (delayMs / 1000).toFixed(1))
                    : `[${requestedItem.title || nid}] ⚠️ 触发 Google 限频 (429)，退避等待 ${(delayMs / 1000).toFixed(1)} 秒后重试...`, 'warn');
                // P1-036: 429 退避等待可被取消中断；中断后跳出重试循环且不记为失败
                if (await abortableSleep(delayMs, ctx.abortSignal)) break;
                retryCount++;
                continue;
            }
            break;
        }

        if (ctx.isAborted() || (ctx.abortSignal && ctx.abortSignal.aborted)) return;

        if (!res || !res.success) {
            const fetchErr = res ? (res.error || (res.aborted ? 'aborted' : 'unknown')) : 'unknown';
            ctx.onLog(typeof I18n !== 'undefined' ? I18n.t('logFetchFailed', fetchErr) : `抓取对话失败: ${fetchErr}`, 'warn');
            state.failedChats.push({ id: requestedItem.id, title: requestedItem.title || requestedItem.id, error: fetchErr });
            ctx.onLog(typeof I18n !== 'undefined' ? I18n.t('logExportSkipped', requestedItem.title || requestedItem.id, fetchErr) : `[${requestedItem.title || requestedItem.id}] 导出跳过: ${fetchErr}`, 'warn');
            state.completedCount++;
            ctx.updateProgress(state.completedCount, requestedItem.title || requestedItem.id);
            return;
        }

        state.skipped += (res.skipped || 0);
        const chunkResults = res.results || (res.chat ? [res.chat] : []);
        let chat = chunkResults[0] || { id: nid, title: requestedItem.title };
        chat.id = nid;

        const listC = ctx.conversations.find((c: any) => normId(c.id) === nid) || null;
        const resolvedRes = ctx.worker && ctx.worker.resolveChat
            ? await ctx.worker.resolveChat(chat, requestedItem, listC, ctx.takeoutEngine, ctx.currentSlot, ctx.onTitleUpdated, ctx.onLog)
            : { chat, listTitle: chat.title, displayTitle: chat.title, isError: false, errMsg: null, isConfirmedDeleted: false, convsNeedSave: false };

        if (resolvedRes.convsNeedSave) state.convsNeedSave = true;

        if (resolvedRes.isError) {
            state.failedChats.push({ id: chat.id || nid, title: resolvedRes.displayTitle, error: resolvedRes.errMsg, debug: chat._debug || null, raw: chat._raw || null, isDeleted: resolvedRes.isConfirmedDeleted });
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[Gemini Exporter] export empty detail', nid, resolvedRes.errMsg, 'chat keys', Object.keys(chat || {}));
            }
            state.completedCount++;
            ctx.updateProgress(state.completedCount, resolvedRes.displayTitle);
            return;
        }

        chat = resolvedRes.chat || chat;
        const listTitle = resolvedRes.listTitle;
        chat.title = listTitle;

        const actualMsgCount = Array.isArray(chat.messages) ? chat.messages.length : (chat.messageCount || 0);
        if (listC && typeof listC === 'object' && actualMsgCount > 0 && listC.messageCount !== actualMsgCount) {
            listC.messageCount = actualMsgCount;
            state.convsNeedSave = true;
        }

        const ChatFormatter = getChatFormatter();
        const formatted = ChatFormatter && ChatFormatter.formatContent
            ? ChatFormatter.formatContent(chat, ctx.format)
            : { content: JSON.stringify(chat, null, 2), ext: 'json' };

        const content = formatted.content;
        const ext = formatted.ext;
        const safeBase = sanitizeFileName(listTitle, chat.id);
        const fileName = buildExportFileName(listTitle, chat.id, ext);

        let writeOk = true;
        if (ctx.useZip) {
            ctx.folder.file(fileName, content);
        } else {
            writeOk = await ctx.writeFileDirect(fileName, content);
        }

        let queuedAssetsForThisChat = 0;
        const chatAssetTasks: (() => Promise<void>)[] = [];
        const queueAsset = (item: any, isImage: boolean) => {
            state.totalAssets++;
            queuedAssetsForThisChat++;
            ctx.updateProgress();
            const localName = item.localName || item.fileName || (isImage ? 'image.jpg' : 'file.bin');
            const task = async () => {
                let assetRes = { saved: false, failReason: '', localName };
                if (ctx.assetPipeline) {
                    assetRes = await ctx.assetPipeline.processAsset(item, chat, { isImage, listTitle });
                }
                if (assetRes.saved) {
                    state.downloadedAssets++;
                    ctx.updateProgress();
                    const left = (state.pendingAssetsPerChat.get(nid) || 1) - 1;
                    state.pendingAssetsPerChat.set(nid, left);
                    if (left === 0) await ctx.finalizeChatExport(chat.id, listTitle);
                } else {
                    state.chatFailedAssetsSet.add(nid);
                    state.failedAttachments.push({ chatId: chat.id, chatTitle: listTitle || chat.title || chat.id, file: assetRes.localName, error: assetRes.failReason || 'CDN auth expired' });
                    const logKey = isImage ? 'logImageFailed' : 'logAssetFailed';
                    const fallbackMsg = isImage
                        ? `[${chat.title || chat.id}] 图片获取失败 (${assetRes.localName}): ${assetRes.failReason || 'CDN鉴权过期或资源不可达'}`
                        : `[${chat.title || chat.id}] 附件获取失败 (${assetRes.localName}): ${assetRes.failReason || 'CDN鉴权过期或资源不可达'}`;
                    ctx.onLog(typeof I18n !== 'undefined' ? I18n.t(logKey, chat.title || chat.id, assetRes.localName, assetRes.failReason || 'CDN auth expired') : fallbackMsg, 'warn');
                    const left = (state.pendingAssetsPerChat.get(nid) || 1) - 1;
                    state.pendingAssetsPerChat.set(nid, left);
                    if (left === 0) await ctx.finalizeChatExport(chat.id, listTitle);
                }
            };
            // P1-016: consumer safety-net metadata — if the task itself throws,
            // the consumer still decrements pendingAssetsPerChat and records it.
            (task as any).__assetMeta = { nid, chatId: chat.id, listTitle, fileName: localName };
            chatAssetTasks.push(task);
        };

        if (ctx.includeAssets && chat.messages && writeOk) {
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
                            if (ctx.useZip) {
                                try {
                                    ctx.folder.file(sanitizeZipPathOf(att.localName), att.contentMarkdown);
                                    state.totalAssets++;
                                    state.downloadedAssets++;
                                    ctx.updateProgress();
                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:chatExporter.ts]', e); }
                            } else {
                                state.totalAssets++;
                                queuedAssetsForThisChat++;
                                ctx.updateProgress();
                                const task = async () => {
                                    const ok = await ctx.writeFileDirect(att.localName || `${safeBase}_${chat.id.slice(-6)}.md`, att.contentMarkdown);
                                    if (ok) {
                                        state.downloadedAssets++;
                                        ctx.updateProgress();
                                    } else {
                                        state.chatFailedAssetsSet.add(nid);
                                    }
                                    const left = (state.pendingAssetsPerChat.get(nid) || 1) - 1;
                                    state.pendingAssetsPerChat.set(nid, left);
                                    if (left === 0) await ctx.finalizeChatExport(chat.id, listTitle);
                                };
                                (task as any).__assetMeta = { nid, chatId: chat.id, listTitle, fileName: att.localName || 'doc.md' };
                                chatAssetTasks.push(task);
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
            state.landedChats++;
            ctx.onLog(typeof I18n !== 'undefined' ? I18n.t('logExportSuccess', listTitle, fileName) : `[${listTitle}] ✓ 文本导出成功 (${fileName})`, 'info');
            if (!chat.error && !chat._empty) {
                let exportTs = listC?.timestamp || chat.timestamp || Date.now();
                if (typeof exportTs === 'string') exportTs = new Date(exportTs).getTime();
                const record = {
                    title: listTitle,
                    exportedAt: new Date().toISOString(),
                    format: ctx.options.format || 'markdown',
                    messageCount: actualMsgCount || chat.messageCount || chat.messages?.length || 0,
                    chatTime: exportTs,
                    status: 'ok'
                };
                state.chatRecordsMap.set(nid, record);
                if (queuedAssetsForThisChat === 0) {
                    await ctx.finalizeChatExport(chat.id, listTitle);
                } else {
                    state.pendingAssetsPerChat.set(nid, queuedAssetsForThisChat);
                    for (const task of chatAssetTasks) {
                        ctx.attachmentQueue.push(task);
                    }
                }
            }
        } else {
            const failReason = ctx.isAborted() ? 'Aborted due to permission revocation' : 'File write failed';
            state.failedChats.push({
                id: chat.id || nid,
                title: listTitle,
                error: failReason
            });
        }

        state.metaResults.push({
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

        state.completedCount++;
        ctx.updateProgress(state.completedCount, listTitle);

        await ctx.updateSessionStatus({
            status: 'running',
            slot: ctx.slot,
            total: ctx.totalChats,
            current: state.completedCount,
            lastChatId: chat.id,
            lastChatTitle: listTitle,
            format: ctx.format,
            useZip: ctx.useZip
        });
    } catch (e: unknown) {
        // P1-011: one bad chat must never kill the run.
        const errMsg = getErrorMessage(e);
        const title = requestedItem.title || requestedItem.id;
        ctx.onLog(`[${title}] 导出异常，已跳过: ${errMsg}`, 'error');
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[Gemini Exporter] exportSingleChat failed for', nid, e);
        }
        state.failedChats.push({ id: requestedItem.id, title, error: errMsg });
        state.completedCount++;
        try { ctx.updateProgress(state.completedCount, title); } catch (_) { /* intentional */ }
    }
}

function sanitizeZipPathOf(p?: string | null): string {
    const fn = (globalThis as any).GeminiUtils?.sanitizeRelativePath;
    if (typeof fn === 'function') {
        try { return fn(p, 'file'); } catch (_) { /* fall through */ }
    }
    return String(p || 'file');
}

/**
 * Start N attachment consumer workers draining the shared queue.
 * P1-016: a task that throws is caught here — the exception is logged and
 * recorded in failedAttachments, pendingAssetsPerChat is still decremented,
 * and finalizeChatExport still runs when the count reaches zero.
 */
export function startAttachmentConsumers(ctx: ChatExportContext, count: number): Promise<void>[] {
    const pool: Promise<void>[] = [];
    const consumerLoop = async () => {
        while (!ctx.isAborted()) {
            const task = await ctx.attachmentQueue.pop(ctx.abortSignal);
            if (!task) break;
            try {
                await task();
            } catch (e: unknown) {
                const meta = (task as any)?.__assetMeta || null;
                const errMsg = getErrorMessage(e);
                if (meta) {
                    ctx.state.chatFailedAssetsSet.add(meta.nid);
                    ctx.state.failedAttachments.push({
                        chatId: meta.chatId,
                        chatTitle: meta.listTitle,
                        file: meta.fileName,
                        error: errMsg || 'asset task threw'
                    });
                    ctx.onLog(`[${meta.listTitle || meta.chatId}] 附件任务异常，已记为失败: ${errMsg}`, 'warn');
                    const left = (ctx.state.pendingAssetsPerChat.get(meta.nid) || 1) - 1;
                    ctx.state.pendingAssetsPerChat.set(meta.nid, left);
                    if (left === 0) {
                        try { await ctx.finalizeChatExport(meta.chatId, meta.listTitle); } catch (_) { /* intentional */ }
                    }
                } else if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[Gemini Exporter] attachment consumer task threw without metadata', e);
                }
                if (ctx.abortSignal && ctx.abortSignal.aborted) break;
            }
        }
    };
    for (let i = 0; i < count; i++) {
        pool.push(consumerLoop());
    }
    return pool;
}

export function resolveAssetPipelineClass(): any {
    return getAssetPipelineClass();
}

export default { exportSingleChat, startAttachmentConsumers, createChatExportState };
