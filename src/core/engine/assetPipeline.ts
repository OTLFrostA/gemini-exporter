import { getDomainResource, cacheDomainResource, storageIdentity } from '../storage/domain/domainStore.js';
import type { IExportWriter } from "./writers/writerInterface.js";
import type { ResourceRequest } from '../resources/resourceAcquisition.js';
import { attemptResource, missingResource, type ResourceResult, type ResourceBytes, type ResourceDelivery } from '../resources/resourceResult.js';
import type { TakeoutEngineModule, TakeoutResourceLookup } from "./takeoutEngine.js";
import type { DownloadAssetDirectMessage } from "../../types/messages.js";

export interface ProcessAssetOptions {
    localOnly?: boolean;
    isImage?: boolean;
    listTitle?: string;
    timeoutMs?: number;
    signal?: AbortSignal | null;
    maxRetries?: number;
}

interface AssetDownloadResponse {
    success?: boolean;
    ok?: boolean;
    error?: string;
    dataBuffer?: ArrayBuffer | ArrayBufferView | null;
    dataBase64?: string | null;
    blobBase64?: string | null;
    dataUrl?: string | null;
    mimeType?: string | null;
    mime?: string | null;
}

interface AssetTabWithId {
    id: number;
}

type AssetTabCandidate = chrome.tabs.Tab | { id?: number };

function hasAssetTabId(tab: AssetTabCandidate | null | undefined): tab is AssetTabWithId {
    return !!tab && typeof tab.id === 'number';
}

export interface TabAssetRequestExtra {
    fileName?: string;
    candidates?: string[];
}

export interface AssetPipelineChat {
    id: string;
    title?: string | null;
}

export interface FetchAssetParams {
    url: string;
    referer: string;
    preferBuffer: boolean;
    timeoutMs: number;
    slot: string;
    chat: AssetPipelineChat;
    item: ResourceRequest;
    signal?: AbortSignal | null;
    fileName?: string;
    candidates?: string[];
}

export interface AssetPipelineTakeoutEngine {
    getTakeoutFallbackMedia?: (
        chatId: string,
        lookup: TakeoutResourceLookup,
        slot?: string | null
    ) => Promise<Uint8Array | null>;
}

export interface AssetPipelineOptions {
    currentSlot?: string;
    useZip?: boolean;
    writer?: IExportWriter | null;
    writeFileDirect?: (path: string, content: Uint8Array) => Promise<void>;
    takeoutEngine?: AssetPipelineTakeoutEngine | TakeoutEngineModule | null;
    getGeminiTab?: (slot?: string) => Promise<AssetTabCandidate | null | undefined>;
    sendToGeminiTab?: (
        message: DownloadAssetDirectMessage,
        slot?: string,
        timeoutMs?: number
    ) => Promise<unknown>;
    fetchAssetDelegate?: (params: FetchAssetParams) => Promise<unknown>;
    fetchAsset?: (params: FetchAssetParams) => Promise<unknown>;
    onLog?: (msg: string, level?: string) => void;
    downloadTimeoutMs?: number;
}

export interface AssetPipelineClass {
    new (options?: AssetPipelineOptions): AssetPipelineInstance;
    sanitizeZipPath?: (p?: string | null) => string;
}

export interface AssetPipelineInstance {
    currentSlot: string;
    useZip: boolean;

    writer: IExportWriter | null;
    writeFileDirect: ((path: string, content: Uint8Array) => Promise<void>) | null;
    takeoutEngine: AssetPipelineTakeoutEngine | TakeoutEngineModule | null;
    getGeminiTab: ((slot?: string) => Promise<AssetTabCandidate | null | undefined>) | null;
    sendToGeminiTab: ((message: DownloadAssetDirectMessage, slot?: string, timeoutMs?: number) => Promise<unknown>) | null;
    fetchAssetDelegate: ((params: FetchAssetParams) => Promise<unknown>) | null;
    onLog: (msg: string, level?: string) => void;
    downloadTimeoutMs: number;
    acquireAssetBytes: (item: ResourceRequest, chat: AssetPipelineChat, opts?: ProcessAssetOptions) => Promise<ResourceResult<ResourceBytes>>;
    processAsset: (item: ResourceRequest, chat: AssetPipelineChat, opts?: ProcessAssetOptions) => Promise<ResourceResult<ResourceDelivery>>;
}

import { sanitizeRelativePath } from "../utils/utils.js";
import { I18n as I18nStatic } from "../utils/i18n.js";
import { __resolveModule } from "../utils/moduleOverrides.js";
import { calculateBackoff, abortableSleep } from "../utils/retryUtils.js";
import { getErrorMessage } from "../utils/messaging.js";

export function sanitizeZipPath(p?: string | null): string {
    if (!p) return '';
    return sanitizeRelativePath(p, 'file');
}

function resourceName(item: ResourceRequest, isImage: boolean): string {
    return item.localName || item.fileName || item.title || (isImage ? 'image.jpg' : 'file.bin');
}

function hasValidBuffer(r: AssetDownloadResponse | null | undefined): boolean {
    if (!r || !r.dataBuffer) return false;
    const buf = r.dataBuffer;
    if (typeof ArrayBuffer !== 'undefined' && buf instanceof ArrayBuffer) {
        return buf.byteLength > 0;
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(buf)) {
        return buf.byteLength > 0;
    }
    return false;
}

function hasValidB64(r: AssetDownloadResponse | null | undefined): boolean {
    return !!(r && (r.dataBase64 || r.blobBase64 || (typeof r.dataUrl === 'string' && r.dataUrl.includes(','))));
}

function decodeBase64ToBytes(b64: string): Uint8Array {
    const clean = b64.replace(/\s+/g, '');
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        const buf = Buffer.from(clean, 'base64');
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    const binStr = atob(clean);
    const len = binStr.length;
    const out = new Uint8Array(len);
    for (let k = 0; k < len; k++) out[k] = binStr.charCodeAt(k);
    return out;
}

function normalizeDownloadResponse(val: unknown): AssetDownloadResponse {
    if (!val || typeof val !== 'object') {
        return {};
    }
    const r: AssetDownloadResponse = {};
    if ('success' in val && typeof val.success === 'boolean') {
        r.success = val.success;
    }
    if ('ok' in val && typeof val.ok === 'boolean') {
        r.ok = val.ok;
    }
    if ('error' in val && val.error != null) {
        r.error = String(val.error);
    }
    if ('dataBuffer' in val && val.dataBuffer && typeof val.dataBuffer === 'object') {
        if (typeof ArrayBuffer !== 'undefined' && val.dataBuffer instanceof ArrayBuffer) {
            r.dataBuffer = val.dataBuffer;
        } else if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(val.dataBuffer)) {
            r.dataBuffer = val.dataBuffer;
        }
    }
    if ('dataBase64' in val && typeof val.dataBase64 === 'string') {
        r.dataBase64 = val.dataBase64;
    }
    if ('blobBase64' in val && typeof val.blobBase64 === 'string') {
        r.blobBase64 = val.blobBase64;
    }
    if ('dataUrl' in val && typeof val.dataUrl === 'string') {
        r.dataUrl = val.dataUrl;
    }
    if ('mimeType' in val && typeof val.mimeType === 'string') {
        r.mimeType = val.mimeType;
    }
    if ('mime' in val && typeof val.mime === 'string') {
        r.mime = val.mime;
    }
    return r;
}

function sendTabAssetRequest(
    tabId: number,
    url: string,
    chatId: string,
    preferBuffer: boolean,
    timeoutMs: number,
    timeoutMsg: string,
    signal?: AbortSignal | null,
    extra?: TabAssetRequestExtra
): Promise<AssetDownloadResponse> {
    return new Promise(resolve => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let settled = false;
        const onAbort = () => done({ success: false, error: 'aborted' });
        const done = (val: AssetDownloadResponse) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            try { signal?.removeEventListener?.("abort", onAbort); } catch { /* noop */ }
            resolve(val);
        };

        if (signal?.aborted) {
            done({ success: false, error: 'aborted' });
            return;
        }
        if (signal && typeof signal.addEventListener === "function") {
            signal.addEventListener("abort", onAbort, { once: true });
        }

        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                done({ success: false, error: `${timeoutMsg} after ${timeoutMs}ms` });
            }, timeoutMs);
        }

        chrome.tabs.sendMessage(tabId, {
            action: 'downloadAssetDirect',
            url,
            referer: `https://gemini.google.com/app/${chatId}`,
            preferBuffer,
            fileName: extra?.fileName,
            candidates: extra?.candidates
        }, (resp: unknown) => {
            if (chrome.runtime && chrome.runtime.lastError) {
                done({ success: false, error: chrome.runtime.lastError.message });
            } else {
                done(normalizeDownloadResponse(resp));
            }
        });
    });
}

class AssetPipeline implements AssetPipelineInstance {
    currentSlot: string;
    useZip: boolean;
    writer: IExportWriter | null;
    writeFileDirect: ((path: string, content: Uint8Array) => Promise<void>) | null;
    takeoutEngine: AssetPipelineTakeoutEngine | TakeoutEngineModule | null;
    getGeminiTab: ((slot?: string) => Promise<chrome.tabs.Tab | { id?: number } | null | undefined>) | null;
    sendToGeminiTab: ((message: DownloadAssetDirectMessage, slot?: string, timeoutMs?: number) => Promise<unknown>) | null;
    fetchAssetDelegate: ((params: FetchAssetParams) => Promise<unknown>) | null;
    onLog: (msg: string, level?: string) => void;
    downloadTimeoutMs: number;

    static sanitizeZipPath = sanitizeZipPath;

    constructor(options: AssetPipelineOptions = {}) {
        this.currentSlot = options.currentSlot || 'u0';
        this.useZip = options.useZip !== false;
        this.writer = options.writer || null;
        this.writeFileDirect = options.writeFileDirect || null;
        this.takeoutEngine = options.takeoutEngine || null;
        this.getGeminiTab = options.getGeminiTab || null;
        this.sendToGeminiTab = options.sendToGeminiTab || null;
        this.fetchAssetDelegate = options.fetchAssetDelegate || options.fetchAsset || null;
        this.onLog = options.onLog || (() => {});
        this.downloadTimeoutMs = options.downloadTimeoutMs || 15000;
    }

    private async downloadOnce(
        targetUrl: string,
        chat: AssetPipelineChat,
        item: ResourceRequest,
        timeoutMs: number,
        signal: AbortSignal | null
    ): Promise<AssetDownloadResponse | null> {
        let r: AssetDownloadResponse | null = null;
        // Search thumbnails are public media. Fetch from the extension origin,
        // whose host permission avoids Gemini page CORS restrictions.
        let mediaUrl: URL;
        try { mediaUrl = new URL(targetUrl); } catch { return { success: false, error: 'Invalid asset URL' }; }
        if (mediaUrl.protocol === 'http:' && /(^|\.)(googleusercontent\.com|gstatic\.com|usercontent\.google\.com)$/.test(mediaUrl.hostname)) {
            mediaUrl.protocol = 'https:';
            targetUrl = mediaUrl.href;
        }
        if (/^encrypted-tbn[0-3]\.gstatic\.com$/.test(mediaUrl.hostname)
            && ['http:', 'https:'].includes(mediaUrl.protocol)) {
            mediaUrl.protocol = 'https:';
            try {
                const timeout = AbortSignal.timeout(timeoutMs);
                const response = await fetch(mediaUrl.href, {
                    credentials: 'omit',
                    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();
                if (!blob.size || !blob.type.startsWith('image/')) throw new Error(`Invalid image response: ${blob.type}`);
                return { success: true, dataBuffer: await blob.arrayBuffer(), mimeType: blob.type };
            } catch (error) {
                if (signal?.aborted) return { success: false, error: 'aborted' };
                r = { success: false, error: `Extension image fetch failed: ${getErrorMessage(error)}` };
            }
        }

        const extensionFailure = r?.error;
        const extra: TabAssetRequestExtra = {
            fileName: item.fileName || item.title,
            candidates: item.candidates
        };
        const chatId = chat.id;
        const requestFromTab = async (preferBuffer: boolean): Promise<AssetDownloadResponse | null> => {
            const tab = this.getGeminiTab ? await this.getGeminiTab(this.currentSlot) : null;
            let response: AssetDownloadResponse | null = (hasAssetTabId(tab) && targetUrl && typeof chrome !== 'undefined' && chrome.tabs)
                ? await sendTabAssetRequest(tab.id, targetUrl, chatId, preferBuffer, timeoutMs, 'tabs.sendMessage timed out', signal, extra)
                : null;
            const noReceiver = response && !response.success &&
                /Receiving end does not exist|Could not establish connection/i.test(String(response.error || ''));
            if (targetUrl && (!tab || noReceiver) && this.sendToGeminiTab && !signal?.aborted) {
                try {
                    const raw = await this.sendToGeminiTab({
                        action: 'downloadAssetDirect',
                        url: targetUrl,
                        referer: `https://gemini.google.com/app/${chatId}`,
                        preferBuffer,
                        ...extra
                    }, this.currentSlot, timeoutMs);
                    response = normalizeDownloadResponse(raw);
                } catch (e) {
                    response = { success: false, error: getErrorMessage(e) };
                }
            }
            return signal?.aborted ? { success: false, error: 'aborted' } : response;
        };

        if (this.fetchAssetDelegate && targetUrl) {
            const raw = await this.fetchAssetDelegate({
                url: targetUrl,
                referer: `https://gemini.google.com/app/${chatId}`,
                preferBuffer: true,
                timeoutMs,
                slot: this.currentSlot,
                chat,
                item,
                signal,
                ...extra
            });
            r = normalizeDownloadResponse(raw);
        } else {
            r = await requestFromTab(true);
        }

        // In Chrome extension IPC, ArrayBuffers passed via chrome.tabs.sendMessage get collapsed to {}
        // If dataBuffer is not a valid ArrayBuffer or lacks byteLength, and no base64 was sent, fall back to requesting Base64
        if (r && (r.success || r.ok) && !hasValidBuffer(r) && !hasValidB64(r) && typeof chrome !== 'undefined' && chrome.tabs) {
            r = await requestFromTab(false);
        }
        if (extensionFailure && !r?.success && !r?.ok) {
            return { success: false, error: `${extensionFailure}; page fallback: ${r?.error || 'unavailable'}` };
        }
        return r;
    }

    private extractDownloadPayload(resourceId: string, r: AssetDownloadResponse | null | undefined, isImage: boolean): ResourceResult<ResourceBytes> {
        const defaultFail = isImage ? 'image direct download failed' : 'downloadAssetDirect failed';
        if (!r || (!r.success && !r.ok)) return missingResource(resourceId, r?.error || defaultFail);
        const mediaType = r.mimeType || r.mime || undefined;
        if (hasValidBuffer(r) && r.dataBuffer) {
            const bytes = r.dataBuffer instanceof ArrayBuffer ? new Uint8Array(r.dataBuffer)
                : new Uint8Array(r.dataBuffer.buffer, r.dataBuffer.byteOffset, r.dataBuffer.byteLength);
            return { ok: true, resourceId, value: { bytes, mediaType } };
        }
        const base64 = r.dataBase64 || r.blobBase64 || (r.dataUrl?.includes(',') ? r.dataUrl.split(',')[1] : undefined);
        if (base64) {
            try {
                const bytes = decodeBase64ToBytes(base64);
                if (bytes.length) return { ok: true, resourceId, value: { bytes, mediaType } };
            } catch { /* Report malformed payloads through the same failure contract. */ }
        }
        return missingResource(resourceId, r.error || 'Empty or unparseable binary/base64 payload');
    }

    private logTakeoutRecovery(chat: AssetPipelineChat, localName: string, isImage: boolean): void {
        const logKey = isImage ? 'logTakeoutImageRecovered' : 'logTakeoutAssetRecovered';
        const I18n = __resolveModule('I18n', I18nStatic);
        this.onLog(I18n.t(logKey, chat.title || chat.id, localName), 'info');
    }

    async acquireAssetBytes(item: ResourceRequest, chat: AssetPipelineChat, opts: ProcessAssetOptions = {}): Promise<ResourceResult<ResourceBytes>> {
        const isImage = !!opts.isImage;
        const url = item.url;
        const sourceUrl = item.sourceUrl;
        const resolvedUrl = item.resolvedUrl;
        const src = item.src;
        const rawCandidates = [url, sourceUrl, src].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
        const nonThumbCandidates = rawCandidates.filter((u: string) => !u.includes('/viewer/thumb'));
        const targetUrl = isImage
            ? (resolvedUrl || sourceUrl || url || src)
            : (nonThumbCandidates[0] || rawCandidates[0]);
        const localName = resourceName(item, isImage);
        const signal = opts.signal || null;
        const maxRetries = (typeof opts.maxRetries === "number" && opts.maxRetries >= 0) ? Math.floor(opts.maxRetries) : 3;
        const timeoutMs = opts.timeoutMs || this.downloadTimeoutMs;
        let failReason = '';

        const isRemoteTarget = typeof targetUrl === 'string' && /^(https?:|blob:|data:)/i.test(targetUrl);
        const canAttemptRemote = !opts.localOnly && Boolean(targetUrl && (this.fetchAssetDelegate || isRemoteTarget));

        signal?.throwIfAborted();
        const stored = await getDomainResource(storageIdentity('gemini', this.currentSlot, chat.id), item.assetId);
        signal?.throwIfAborted();
        if (stored?.byteLength) return { ok: true, resourceId: item.assetId, value: { bytes: stored, name: localName } };

        if (canAttemptRemote && targetUrl) {
            try {
                let attempt = 0;
                for (;;) {
                    signal?.throwIfAborted();
                    const r = await this.downloadOnce(targetUrl, chat, item, timeoutMs, signal);
                    signal?.throwIfAborted();
                    const extracted = this.extractDownloadPayload(item.assetId, r, isImage);
                    if (extracted.ok) {
                        if (sourceUrl || url || src) {
                            try { await cacheDomainResource(storageIdentity('gemini', this.currentSlot, chat.id), item.assetId, sourceUrl || url || src || '', extracted.value.bytes); }
                            catch (error) { this.onLog(`[${chat.title || chat.id}] Resource downloaded but durable cache write failed: ${getErrorMessage(error)}`, 'warn'); }
                        }
                        signal?.throwIfAborted();
                        return { ...extracted, value: { ...extracted.value, name: localName } };
                    }
                    failReason = extracted.reason;
                    if (attempt >= maxRetries) break;
                    const delayMs = calculateBackoff(attempt, { initialDelayMs: 1000, maxDelayMs: 10000, jitterMs: 500 });
                    this.onLog(`[${chat.title || chat.id}] 附件下载失败，${delayMs}ms 后重试 (${attempt + 1}/${maxRetries}): ${localName}`, 'warn');
                    if (await abortableSleep(delayMs, signal)) signal?.throwIfAborted();
                    attempt++;
                }
            } catch (e: unknown) {
                signal?.throwIfAborted();
                if (e instanceof Error && e.name === 'AbortError') throw e;
                failReason = getErrorMessage(e);
            }
        } else {
            failReason = opts.localOnly ? 'Resource unavailable in local Domain / Takeout archive'
                : isImage ? 'image direct download failed' : 'downloadAssetDirect failed';
        }

        if (!(signal && signal.aborted) && this.takeoutEngine && typeof this.takeoutEngine.getTakeoutFallbackMedia === 'function') {
            try {
                const offlineBin = await this.takeoutEngine.getTakeoutFallbackMedia(chat.id, {
                    assetId: item.assetId,
                    sourceUri: sourceUrl ?? url ?? src,
                    generation: item.generation,
                }, this.currentSlot);
                if (offlineBin && offlineBin.length > 0) {
                    signal?.throwIfAborted();
                    this.logTakeoutRecovery(chat, localName, isImage);
                    return { ok: true, resourceId: item.assetId, value: { bytes: offlineBin, name: localName } };
                }
            } catch (e) {
                signal?.throwIfAborted();
                if (e instanceof Error && e.name === 'AbortError') throw e;
                if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:assetPipeline.ts]", e);
            }
        }

        signal?.throwIfAborted();
        return missingResource(item.assetId, failReason);
    }

    async processAsset(item: ResourceRequest, chat: AssetPipelineChat, opts: ProcessAssetOptions = {}): Promise<ResourceResult<ResourceDelivery>> {
        const acquired = await this.acquireAssetBytes(item, chat, opts);
        if (!acquired.ok) return acquired;
        const localName = sanitizeZipPath(resourceName(item, !!opts.isImage));
        const delivered = await attemptResource(item.assetId, async () => {
            if (this.writer) {
                const written = await this.writer.writeFile(localName, acquired.value.bytes);
                return { path: typeof written === 'string' && written ? written : localName };
            }
            if (!this.writeFileDirect) throw new Error('Resource writer is unavailable');
            await this.writeFileDirect(localName, acquired.value.bytes);
            return { path: localName };
        }, opts.signal);
        // A failed write never triggers another download.
        if (!delivered.ok) this.onLog(`[${chat.title || chat.id}] 附件写入本地失败 (${localName}): ${delivered.reason}`, 'warn');
        return delivered;
    }
}

export {
    AssetPipeline
};

export default AssetPipeline;
