import { persistNativeConversation } from '../core/storage/domain/nativePersistence.js';
import type { ResourceConversationParseResult } from '../core/parsers/parsingResult.js';
import { decodeDataUrlAsset } from '../core/export/assets/dataUrl.js';
import type { ApplicationProvider } from "./providerCompatibility.js";
import type { AIProvider } from "../core/provider/aiProvider.js";
import { StorageService } from '../core/storage/storageService.js';
import { detectSlotFromUrl } from '../core/utils/pathUtils.js';
import { contentContext } from './contentContext.js';
import { LiveStorageManager, isLiveSaveFormatSupported } from '../core/storage/liveStorageManager.js';
import { DomScraper } from './domScraper.js';
import { ChatFormatter } from '../core/engine/chatFormatter.js';
import { FsWriter } from '../core/engine/writers/fsWriter.js';
import { buildExportFileName, shortId, normId, sanitizeFileName } from '../core/utils/pathUtils.js';
import type { ContentConversationDetail, DetailClient, DomDetail } from '../types/detailTransport.js';
import { resolveProvider } from '../core/provider/providerResolver.js';
import { BadgeView } from './badgeView.js';
import { AssetFetcher, inferImageExt, type FetchedImageAsset } from './assetFetcher.js';
import { createLiveSaveWriter, writeLiveSaveMarkdown, type LiveSaveWriter } from '../core/engine/liveSaveWriter.js';
import { GeminiUtils } from '../core/utils/utils.js';
import { completeConversationExport } from '../core/engine/export/exportCompletion.js';
import type { LiveSaveConfig } from '../types/liveSave.js';
import type { DirectoryHandle } from '../types/ui.js';
import type { LiveSaveAsset, LiveSaveViaHandleMessage, LiveSaveViaHandlePayload } from '../types/messages.js';
import type { LiveSaveResult } from '../background/liveSaveHandler.js';
import { getErrorMessage } from '../core/utils/messaging.js';

interface LiveSaveBadge {
    showLiveSaveWarning?: (message?: string, isZh?: boolean) => void;
    showLiveSaveFeedback?: (title?: string, isZh?: boolean) => void;
}

interface LiveSaveAssetFetcher {
    fetchImageBuffer(url: string, timeoutMs?: number): Promise<FetchedImageAsset | { buffer: ArrayBuffer | Uint8Array; ext?: string; mimeType?: string; base64?: string } | null>;
}

interface LiveSaveStorageManager {
    getLiveConfig: () => Promise<LiveSaveConfig>;
    setLiveConfig: (patch: Partial<LiveSaveConfig>) => Promise<LiveSaveConfig>;
    getLiveDirHandle: () => Promise<DirectoryHandle | FileSystemDirectoryHandle | null>;
    saveLiveDirHandle?: (handle: DirectoryHandle | FileSystemDirectoryHandle | null) => Promise<boolean>;
}

interface LiveSaveScraper {
    parseDoc: (doc: Document | null, id: string) => DomDetail | null;
}

interface LiveSaveImageWriter {
    writeFile(subDir: string, fileName: string, data: Uint8Array): Promise<unknown>;
}

interface LiveSaveCoordinatorDeps {
    storageManager?: LiveSaveStorageManager;
    exportRecordStore?: Pick<typeof StorageService, 'saveExportRecord'> & Partial<Pick<typeof StorageService, 'finalizeConversationExport'>>;
    completeExport?: typeof completeConversationExport;
    scraper?: LiveSaveScraper | typeof DomScraper;
    formatter?: typeof ChatFormatter;
    fsWriterClass?: typeof FsWriter;
    utils?: typeof GeminiUtils;
    clientClass?: (new () => DetailClient) | null;
    badge?: LiveSaveBadge;
    assetFetcher?: LiveSaveAssetFetcher;
}

interface CollectedLiveSaveAsset {
    fileName: string;
    subDir: string;
    buffer?: ArrayBuffer;
    base64?: string;
}

interface RawFailedAsset {
    file: string;
    error: string;
}

let _deps: LiveSaveCoordinatorDeps = {};
let _isSaving = false;
let _saveQueue: Promise<boolean> = Promise.resolve(false);

function getStorage(): LiveSaveStorageManager {
    return _deps.storageManager || LiveStorageManager;
}

function getScraper(): LiveSaveScraper | typeof DomScraper {
    return _deps.scraper || DomScraper;
}

function getFormatter(): typeof ChatFormatter {
    return _deps.formatter || ChatFormatter;
}

function getFsWriterClass(): typeof FsWriter {
    return _deps.fsWriterClass || FsWriter;
}

function getUtils(): typeof GeminiUtils {
    return _deps.utils || GeminiUtils;
}

function getBadge(): LiveSaveBadge {
    return _deps.badge || BadgeView;
}

function getAssetFetcher(): LiveSaveAssetFetcher {
    return _deps.assetFetcher || AssetFetcher;
}

function isDev(): boolean {
    return contentContext.isDevMode();
}

function notifyLiveSaveWarning(errorType: 'dir_deleted' | 'permission_not_granted' | 'no_dir_handle' | 'payload_too_large' | 'permission_prompt_needed' | 'assets_partial'): void {
    const isZh = contentContext.isZh();
    const badge = getBadge();
    let warnMsg = isZh ? '⚠ 目标目录已删除，实时同步已暂停' : '⚠ Folder deleted, sync paused';
    if (errorType === 'permission_not_granted') {
        warnMsg = isZh ? '⚠ 目录未授权，实时同步已暂停' : '⚠ Folder permission denied, sync paused';
    } else if (errorType === 'permission_prompt_needed') {
        warnMsg = isZh ? '⚠ 目录权限待续期，已暂存下载目录' : '⚠ Folder permission degraded, saved to Downloads';
    } else if (errorType === 'no_dir_handle') {
        warnMsg = isZh ? '⚠ 目录未就绪，实时同步已暂停' : '⚠ Folder not ready, sync paused';
    } else if (errorType === 'payload_too_large') {
        warnMsg = isZh ? '⚠ 实时保存载荷过大，已跳过本次保存' : '⚠ Live-save payload too large, save skipped';
    } else if (errorType === 'assets_partial') {
        warnMsg = isZh ? '⚠ 部分附件保存失败，下次增量同步将重试' : '⚠ Some attachments failed to save, will retry on next incremental sync';
    }
    if (badge && typeof badge.showLiveSaveWarning === 'function') {
        badge.showLiveSaveWarning(warnMsg, isZh);
    } else if (badge && typeof badge.showLiveSaveFeedback === 'function') {
        badge.showLiveSaveFeedback(warnMsg);
    }
}

export function init(deps: LiveSaveCoordinatorDeps = {}): void {
    _deps = deps;
    if (isDev()) console.log('[LiveSaveCoordinator] Initialized');
}

function isApplicationProvider(provider: AIProvider | null | undefined): provider is ApplicationProvider {
    return provider !== null && provider !== undefined && typeof provider.fetchConversationDetail === 'function' && provider.id === 'gemini';
}

export async function resolveConversationDetail(cid: string): Promise<ContentConversationDetail | null> {
    const nid = normId(cid);
    // DI seam kept: an explicitly injected client class still uses the legacy
    // construction path. Default now resolves through the provider registry.
    const InjectedClass = typeof _deps.clientClass !== 'undefined' ? _deps.clientClass : null;
    const provider = Object.hasOwn(_deps, 'clientClass') ? null : resolveProvider();

    if (InjectedClass) {
        try {
            const detail = await new InjectedClass().getConversationDetail(nid);
            if (detail && Array.isArray(detail.conversation.messages) && detail.conversation.messages.length > 0) {
                await persistNativeConversation(detectSlotFromUrl(typeof location !== 'undefined' ? location.href : undefined), detail);
                return detail;
            }
        } catch (e) {
            if (isDev()) console.debug('[LiveSaveCoordinator] RPC fetch detail fallback to DOM:', e);
        }
    } else if (isApplicationProvider(provider)) {
        try {
            const detail = await provider.fetchConversationDetail(nid);
            if (detail && Array.isArray(detail.conversation.messages) && detail.conversation.messages.length > 0) {
                await persistNativeConversation(detectSlotFromUrl(typeof location !== 'undefined' ? location.href : undefined), detail);
                return detail;
            }
        } catch (e) {
            if (isDev()) console.debug('[LiveSaveCoordinator] RPC fetch detail fallback to DOM:', e);
        }
    }

    const Scraper = getScraper();
    if (Scraper && typeof Scraper.parseDoc === 'function') {
        const doc = typeof document !== 'undefined' ? document : null;
        try {
            const docResult = Scraper.parseDoc(doc, nid);
            if (docResult && Array.isArray(docResult.conversation.messages) && docResult.conversation.messages.length > 0) {
                await persistNativeConversation(detectSlotFromUrl(typeof location !== 'undefined' ? location.href : undefined), docResult);
                return docResult;
            }
        } catch {
            /* intentional */
        }
    }

    return null;
}

function isFailedAsset(item: unknown): item is RawFailedAsset {
    return (
        item !== null &&
        typeof item === 'object' &&
        'file' in item &&
        'error' in item &&
        typeof item.file === 'string' &&
        typeof item.error === 'string'
    );
}

function normalizeLiveSaveResult(raw: unknown): LiveSaveResult | null {
    if (!raw || typeof raw !== 'object') return null;
    const ok = 'ok' in raw && typeof raw.ok === 'boolean' ? raw.ok : undefined;
    if (typeof ok !== 'boolean') return null;
    const result: LiveSaveResult = { ok };
    if ('handleName' in raw && typeof raw.handleName === 'string') {
        result.handleName = raw.handleName;
    }
    if ('targetFile' in raw && typeof raw.targetFile === 'string') {
        result.targetFile = raw.targetFile;
    }
    if ('error' in raw && typeof raw.error === 'string') {
        result.error = raw.error;
    }
    if ('details' in raw && typeof raw.details === 'string') {
        result.details = raw.details;
    }
    if ('failedAssets' in raw && Array.isArray(raw.failedAssets)) {
        result.failedAssets = raw.failedAssets.filter(isFailedAsset).map((f) => ({ file: f.file, error: f.error }));
    }
    return result;
}

function hasNonEmptyBytes(buf: unknown): boolean {
    if (!buf) return false;
    if (buf instanceof ArrayBuffer) return buf.byteLength > 0;
    if (ArrayBuffer.isView(buf)) return buf.byteLength > 0;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) return buf.length > 0;
    if (typeof buf === 'object' && 'byteLength' in buf && typeof buf.byteLength === 'number') {
        return buf.byteLength > 0;
    }
    if (typeof buf === 'object' && 'length' in buf && typeof buf.length === 'number') {
        return buf.length > 0;
    }
    return false;
}

function getByteLength(buf: unknown): number {
    if (!buf) return 0;
    if (buf instanceof ArrayBuffer) return buf.byteLength;
    if (ArrayBuffer.isView(buf)) return buf.byteLength;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) return buf.length;
    if (typeof buf === 'object' && 'byteLength' in buf && typeof buf.byteLength === 'number') {
        return buf.byteLength;
    }
    if (typeof buf === 'object' && 'length' in buf && typeof buf.length === 'number') {
        return buf.length;
    }
    return 0;
}

export async function executeLiveSave(cid: string, reason = 'turn_complete', options: { mockMode?: boolean } = {}): Promise<boolean> {
    if (!cid) return false;
    const nid = normId(cid);

    // Serialize live save operations to prevent I/O race conditions
    _saveQueue = _saveQueue.catch(() => false).then(async () => {
        try {
            _isSaving = true;
            if (!await isLiveSaveFormatSupported()) return false;

            // In mockMode (e.g. headless/test environments without native filesystem handles), simulate live save feedback
            if (options.mockMode) {
                const chat = await resolveConversationDetail(nid);
                const rawTitle = chat?.conversation.title || (typeof document !== 'undefined' ? document.title : '') || 'Untitled';
                const Utils = getUtils();
                const safeTitle = Utils?.cleanTitle ? Utils.cleanTitle(rawTitle) : rawTitle.trim();
                const badge = getBadge();
                if (badge && typeof badge.showLiveSaveFeedback === 'function') {
                    badge.showLiveSaveFeedback(safeTitle);
                }
                return true;
            }

            const storage = getStorage();
            const config: LiveSaveConfig = await storage.getLiveConfig();

            if (!config.enabledDisk) {
                return false;
            }

            const chat = await resolveConversationDetail(nid);
            if (!chat || !Array.isArray(chat.conversation.messages) || chat.conversation.messages.length === 0) {
                if (isDev()) console.warn('[LiveSaveCoordinator] No messages extracted for', nid);
                return false;
            }

            const Utils = getUtils();
            const rawTitle = chat.conversation.title || (typeof document !== 'undefined' ? document.title : '') || 'Untitled';
            const safeTitle = Utils?.cleanTitle ? Utils.cleanTitle(rawTitle) : rawTitle.trim();
            let failedAssets: Array<{ file: string; error: string }> = [];

            let writeSucceeded = false;
            const dirHandle = await storage.getLiveDirHandle();

            if (dirHandle) {
                try {
                    failedAssets = await writeConversationToDisk(chat, safeTitle, nid, dirHandle, config);
                    writeSucceeded = true;
                } catch (err: unknown) {
                    const isNotFound = (err instanceof Error && err.name === 'NotFoundError') ||
                        getErrorMessage(err).includes('not found') ||
                        getErrorMessage(err).includes('could not be found');
                    if (isNotFound) {
                        console.warn('[LiveSaveCoordinator] Native directory handle is dead (NotFoundError). Clearing handle.');
                        try {
                            const storageInstance = getStorage();
                            if (storageInstance.saveLiveDirHandle) {
                                await storageInstance.saveLiveDirHandle(null);
                            }
                            await storageInstance.setLiveConfig({ enabledDisk: false, dirName: '', dirError: 'not_found' });
                        } catch { /* best effort */ }
                        notifyLiveSaveWarning('dir_deleted');
                        return false;
                    }
                    throw err;
                }
            } else {
                if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    try {
                        let collectedAssets: CollectedLiveSaveAsset[] = [];
                        if (config.includeAssets !== false) {
                            collectedAssets = await processAndSaveImages(chat, nid, null, failedAssets);
                        }
                        const assetsPayload: LiveSaveAsset[] = collectedAssets.map((a) => ({
                            fileName: a.fileName,
                            subDir: a.subDir || 'assets',
                            base64: a.base64 || (a.buffer ? arrayBufferToBase64(a.buffer) : '')
                        }));
                        // Payload size cap to prevent message serialization failure
                        const LIVE_SAVE_PAYLOAD_CAP = 48 * 1024 * 1024;
                        let estPayloadSize = 0;
                        try {
                            estPayloadSize = JSON.stringify(chat).length;
                            for (const a of assetsPayload) {
                                estPayloadSize += (a.base64 || '').length + (a.fileName || '').length + 64;
                            }
                        } catch {
                            estPayloadSize = Number.MAX_SAFE_INTEGER;
                        }
                        if (estPayloadSize > LIVE_SAVE_PAYLOAD_CAP) {
                            const sizeMb = (estPayloadSize / 1024 / 1024).toFixed(1);
                            console.warn(`[LiveSaveCoordinator] live-save payload ~${sizeMb}MB exceeds ${(LIVE_SAVE_PAYLOAD_CAP / 1024 / 1024).toFixed(0)}MB cap; refusing to send oversized message for ${nid}`);
                            notifyLiveSaveWarning('payload_too_large');
                            return false;
                        }
                        const conversationChat: ResourceConversationParseResult = {
                            ...chat,
                            conversation: { ...chat.conversation, id: nid, title: chat.conversation.title || safeTitle }
                        };
                        const resp = await new Promise<LiveSaveResult | null>((resolve) => {
                            const message: LiveSaveViaHandleMessage = {
                                action: 'liveSaveViaHandle',
                                payload: {
                                    chat: conversationChat,
                                    safeTitle,
                                    nid,
                                    config,
                                    assets: assetsPayload,
                                    failedAssets
                                }
                            };
                            chrome.runtime.sendMessage(message, (response: unknown) => {
                                if (chrome.runtime.lastError || !response || typeof response !== 'object') {
                                    resolve(null);
                                    return;
                                }
                                resolve(normalizeLiveSaveResult(response));
                            });
                        });
                        if (resp && resp.ok) {
                            writeSucceeded = true;
                            if (isDev()) {
                                console.log(`[LiveSaveCoordinator] Conversation ${nid} persisted via options handle (${resp.handleName || ''})`);
                            }
                        } else if (resp && resp.ok === false && Array.isArray(resp.failedAssets) && resp.failedAssets.length > 0) {
                            // Phase A (P1-2): 主 md 已落盘、部分附件失败 -> partial。
                            // 本次视为已保存（partial 记录已写，下次增量 checkIsUpdated 判 true 重试），打 badge 警告。
                            writeSucceeded = true;
                            notifyLiveSaveWarning('assets_partial');
                            // CodeQL js/tainted-format-string: 污点数据（nid 等）不进 format string，做独立参数
                            if (isDev()) console.warn('[LiveSaveCoordinator] live-saved with failed assets:', nid, resp.failedAssets.length, resp.failedAssets);
                        } else if (resp && (resp.error === 'dir_not_found' || resp.error === 'permission_not_granted' || resp.error === 'permission_prompt_needed' || (resp.error === 'no_dir_handle' && config.dirName))) {
                            console.warn(`[LiveSaveCoordinator] Directory handle unavailable (${resp.error}).`);
                            const errType = (resp.error === 'permission_not_granted' || resp.error === 'permission_prompt_needed')
                                ? 'permission_prompt_needed'
                                : (resp.error === 'no_dir_handle' ? 'no_dir_handle' : 'dir_deleted');
                            notifyLiveSaveWarning(errType);
                            return false;
                        }
                    } catch (e) {
                        if (isDev()) console.warn('[LiveSaveCoordinator] liveSaveViaHandle error:', e);
                    }
                }
            }

            if (!writeSucceeded) {
                return false;
            }

            // 3. Update configuration metadata if direct disk write occurred (background updates its own)
            if (dirHandle) {
                const now = Date.now();
                const records = _deps.exportRecordStore || StorageService;
                const slot = detectSlotFromUrl(typeof location !== 'undefined' ? location.href : undefined);
                const doComplete = _deps.completeExport || completeConversationExport;
                try {
                    await doComplete(
                        records,
                        slot,
                        {
                            conversation: chat.conversation,
                            conversationId: nid,
                            format: 'markdown',
                            exportedAt: now,
                            failedAssets,
                            titleCandidate: safeTitle,
                            titleProvenance: chat?.conversation.titleSource,
                            titles: chat?.conversation.titles
                        }
                    );
                } catch (err) {
                    console.warn('[LiveSaveCoordinator] Failed to complete conversation export:', err);
                }
                if (failedAssets.length) notifyLiveSaveWarning('assets_partial');
                await storage.setLiveConfig({
                    lastSavedAt: now,
                    lastSavedTitle: safeTitle
                });
            }

            const badge = getBadge();
            if (badge && typeof badge.showLiveSaveFeedback === 'function') {
                badge.showLiveSaveFeedback(safeTitle);
            }

            if (isDev()) {
                console.log(`[LiveSaveCoordinator] Successfully live-saved conversation ${nid} ("${safeTitle}")`);
            }
            return true;
        } catch (err) {
            console.error('[LiveSaveCoordinator] executeLiveSave failed for', nid, err);
            return false;
        } finally {
            _isSaving = false;
        }
    });

    return _saveQueue;
}

interface ImageDownloadTarget {
    assetId: string;
    inlineData?: string;
    url: string;
    fileName: string;
    localName: string;
    alt: string;
    saved?: boolean;
}

function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

export function arrayBufferToBase64(buffer: unknown): string {
    if (!buffer) return '';
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer)) {
        return buffer.toString('base64');
    }
    let bytes: Uint8Array;
    if (buffer instanceof Uint8Array) {
        bytes = buffer;
    } else if (buffer instanceof ArrayBuffer) {
        bytes = new Uint8Array(buffer);
    } else if (ArrayBuffer.isView(buffer)) {
        bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
        return '';
    }

    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }

    const chunkSize = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
}

/**
 * Sniff, download, and persist all multimodal images to assets/ subfolder,
 * and rewrite references in chat to local relative paths.
 */
export async function processAndSaveImages(
    chat: ResourceConversationParseResult | null | undefined,
    nid: string,
    writer?: LiveSaveImageWriter | null,
    failures: Array<{ file: string; error: string }> = []
): Promise<CollectedLiveSaveAsset[]> {
    if (!chat || !Array.isArray(chat.conversation.messages) || chat.conversation.messages.length === 0) return [];

    const Utils = getUtils();
    const cid6 = Utils?.shortId ? Utils.shortId(nid) : shortId(nid);
    const targets = new Map<string, ImageDownloadTarget>();
    const allocatedNames = new Set<string>();

    let imgCounter = 0;

    const registerTarget = (assetId: string, rawUrl: string, candidateName?: string, turnIndex = 0, inlineData?: string) => {
        if (!rawUrl && !inlineData) return;
        if (targets.has(assetId)) return;

        imgCounter++;
        const hash4 = Math.abs(hashString(rawUrl)).toString(36).slice(0, 4);
        let ext = inferImageExt('', rawUrl);

        let finalName = '';
        if (candidateName && candidateName.trim() && !/^(?:image|photo|picture|img|file)(?:\.[a-z0-9]+)?$/i.test(candidateName.trim())) {
            const sanitized = (Utils?.sanitizeFileName || sanitizeFileName)(candidateName.trim());
            const dotIdx = sanitized.lastIndexOf('.');
            if (dotIdx !== -1) {
                ext = sanitized.slice(dotIdx + 1).toLowerCase();
                finalName = `${cid6}_t${turnIndex + 1}_${sanitized}`;
            } else {
                finalName = `${cid6}_t${turnIndex + 1}_${sanitized}.${ext}`;
            }
        } else {
            finalName = `${cid6}_t${turnIndex + 1}_img${imgCounter}_${hash4}.${ext}`;
        }

        if (allocatedNames.has(finalName)) {
            const dotIdx = finalName.lastIndexOf('.');
            const base = dotIdx !== -1 ? finalName.slice(0, dotIdx) : finalName;
            const fileExt = dotIdx !== -1 ? finalName.slice(dotIdx) : '';
            finalName = `${base}_${hash4}${fileExt}`;
            let dedupeIdx = 1;
            while (allocatedNames.has(finalName)) {
                finalName = `${base}_${dedupeIdx}${fileExt}`;
                dedupeIdx++;
            }
        }
        allocatedNames.add(finalName);

        targets.set(assetId, {
            assetId, inlineData, url: rawUrl,
            fileName: finalName,
            localName: `assets/${finalName}`,
            alt: candidateName || 'Image'
        });
    };

    // Domain asset identity owns resources; two assets sharing a URL remain distinct.
    for (const asset of chat.conversation.assets) {
        if (asset.kind !== 'image') continue;
        const source = chat.acquisitionHints[asset.id];
        const url = source?.resolvedUrl || source?.url || source?.sourceUrl || asset.source?.uri || '';
        const inlineData = asset.dataBase64 ? `data:${asset.mediaType || 'image/png'};base64,${asset.dataBase64}`
            : url.startsWith('data:') ? url : undefined;
        const turn = chat.conversation.messages.findIndex(message => {
            if (message.attachmentIds?.includes(asset.id)) return true;
            const contains = (value: unknown): boolean => {
                if (!value || typeof value !== 'object') return false;
                if (Array.isArray(value)) return value.some(contains);
                return Object.entries(value).some(([key, child]) => key === 'assetId' ? child === asset.id : contains(child));
            };
            return contains(message.content) || contains(message.reasoning);
        });
        registerTarget(asset.id, url, asset.name, Math.max(0, turn), inlineData);
    }

    if (targets.size === 0) return [];

    // 2. Fetch and persist images with bounded concurrency.
    const IMAGE_FETCH_CONCURRENCY = 4;
    const targetList = Array.from(targets.values());
    const fetcher = getAssetFetcher();
    const collectedAssets: CollectedLiveSaveAsset[] = [];

    const processOneTarget = async (target: ImageDownloadTarget): Promise<void> => {
        try {
            const decoded = target.inlineData ? await decodeDataUrlAsset(target.inlineData) : null;
            const res = decoded
                ? decoded.ok ? { buffer: decoded.bytes, ext: inferImageExt(decoded.mimeType, target.url) } : null
                : await fetcher.fetchImageBuffer(target.url, 12000);

            const buf = res?.buffer;
            const hasBytes = hasNonEmptyBytes(buf);

            if (res && hasBytes) {
                if (res.ext && !target.fileName.toLowerCase().endsWith(`.${res.ext}`)) {
                    const previous = target.fileName;
                    allocatedNames.delete(previous);
                    const desired = previous.replace(/\.[a-z0-9]+$/i, `.${res.ext}`);
                    let final = desired;
                    let suffix = 2;
                    while (allocatedNames.has(final)) final = desired.replace(/(\.[^/.]+)$/, `_${suffix++}$1`);
                    allocatedNames.add(final);
                    target.fileName = final;
                    target.localName = `assets/${target.fileName}`;
                }
                const fileBytes: Uint8Array = res.buffer instanceof Uint8Array
                    ? res.buffer
                    : new Uint8Array(res.buffer);
                if (writer && typeof writer.writeFile === 'function') {
                    await writer.writeFile('assets', target.fileName, fileBytes);
                }
                let b64 = '';
                if ('base64' in res && typeof res.base64 === 'string' && res.base64) {
                    b64 = res.base64;
                } else if (res.buffer) {
                    b64 = arrayBufferToBase64(res.buffer);
                }
                collectedAssets.push({
                    fileName: target.fileName,
                    subDir: 'assets',
                    buffer: res.buffer instanceof ArrayBuffer ? res.buffer : undefined,
                    base64: b64
                });
                target.saved = true;
                if (isDev()) {
                    console.log(`[LiveSaveCoordinator] Saved image asset ${target.fileName} (${getByteLength(res.buffer)} bytes)`);
                }
            } else {
                failures.push({ file: target.fileName, error: 'image download returned no bytes' });
                console.warn('[LiveSaveCoordinator] Failed to fetch image asset, skipping relative rewrite:', target.fileName);
            }
        } catch (err) {
            failures.push({ file: target.fileName, error: err instanceof Error ? err.message : String(err) });
            if (isDev()) {
                console.warn('[LiveSaveCoordinator] Error saving image asset:', target.url, err);
            }
        }
    };

    {
        let next = 0;
        const workers: Promise<void>[] = [];
        const workerCount = Math.min(IMAGE_FETCH_CONCURRENCY, targetList.length);
        for (let w = 0; w < workerCount; w++) {
            workers.push((async () => {
                while (next < targetList.length) {
                    const target = targetList[next++];
                    await processOneTarget(target);
                }
            })());
        }
        await Promise.allSettled(workers);
    }

    // Export paths are preparation context; source URIs and semantic blocks stay intact.
    for (const target of targetList) {
        if (target.saved) chat.resourceHints = { ...chat.resourceHints,
            [target.assetId]: { ...chat.resourceHints[target.assetId], archivePath: target.localName } };
    }
    return collectedAssets;

}

async function writeConversationToDisk(
    chat: ResourceConversationParseResult,
    safeTitle: string,
    nid: string,
    dirHandle: DirectoryHandle | FileSystemDirectoryHandle,
    config: LiveSaveConfig
): Promise<Array<{ file: string; error: string }>> {
    const Utils = getUtils();
    const failures: Array<{ file: string; error: string }> = [];

    const writer = await createLiveSaveWriter(dirHandle, { fsWriterClass: getFsWriterClass() });

    if (config.includeAssets !== false) {
        await processAndSaveImages(chat, nid, writer, failures);
    }

    await writeLiveSaveMarkdown(
        writer,
        { chat, safeTitle, nid },
        { formatter: getFormatter(), buildFileName: Utils?.buildExportFileName || buildExportFileName }
    );
    return failures;
}

export function isCurrentlySaving(): boolean {
    return _isSaving;
}

export const LiveSaveCoordinator = {
    init,
    resolveConversationDetail,
    executeLiveSave,
    processAndSaveImages,
    arrayBufferToBase64,
    isCurrentlySaving
};

export default LiveSaveCoordinator;
