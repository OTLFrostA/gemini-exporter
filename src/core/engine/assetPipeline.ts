// src/core/engine/assetPipeline.ts - Dedicated Asset Download & Persistence Pipeline

export interface ProcessAssetOptions {
    isImage?: boolean;
    listTitle?: string;
    timeoutMs?: number;
    /** Abort signal honored between attempts and during backoff. */
    signal?: AbortSignal | null;
    /** Max retries after the first attempt (default 3). */
    maxRetries?: number;
}

export interface ProcessAssetResult {
    saved: boolean;
    failReason: string;
    recoveredFromTakeout: boolean;
    localName: string;
}

export interface AssetPipelineOptions {
    currentSlot?: string;
    useZip?: boolean;
    folder?: any;
    writeFileDirect?: (path: string, content: any) => Promise<boolean>;
    takeoutEngine?: any;
    getGeminiTab?: (slot?: string) => Promise<any>;
    fetchAssetDelegate?: (params: any) => Promise<any>;
    fetchAsset?: (params: any) => Promise<any>;
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
    folder: any;
    writeFileDirect: ((path: string, content: any) => Promise<boolean>) | null;
    takeoutEngine: any;
    getGeminiTab: ((slot?: string) => Promise<any>) | null;
    fetchAssetDelegate: ((params: any) => Promise<any>) | null;
    onLog: (msg: string, level?: string) => void;
    downloadTimeoutMs: number;
    processAsset: (item: any, chat: any, opts?: ProcessAssetOptions) => Promise<ProcessAssetResult>;
}

import { sanitizeRelativePath } from "../utils/utils.js";
import { I18n as I18nStatic } from "../utils/i18n.js";
import { __resolveModule } from "../utils/moduleOverrides.js";
import { calculateBackoff } from "./export/rateLimiter.js";
import { interruptibleSleep } from "../api/client/retryPolicy.js";

export function sanitizeZipPath(p?: string | null): string {
    if (!p) return '';
    return sanitizeRelativePath(p, 'file');
}

function hasValidBuffer(r: any): boolean {
    return !!(r && r.dataBuffer && (
        (typeof ArrayBuffer !== 'undefined' && r.dataBuffer instanceof ArrayBuffer && r.dataBuffer.byteLength > 0) ||
        (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(r.dataBuffer) && (r.dataBuffer as any).byteLength > 0)
    ));
}

function hasValidB64(r: any): boolean {
    return !!(r && (r.dataBase64 || r.blobBase64 || (typeof r.dataUrl === 'string' && r.dataUrl.includes(','))));
}

function sendTabAssetRequest(tabId: number, url: string, chatId: string, preferBuffer: boolean, timeoutMs: number, timeoutMsg: string, signal?: AbortSignal | null): Promise<any> {
    return new Promise(resolve => {
        let timer: any = null;
        let settled = false;
        const onAbort = () => done({ success: false, error: 'aborted' });
        const done = (val: any) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            try { signal?.removeEventListener?.("abort", onAbort); } catch (_) { /* noop */ }
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
            preferBuffer
        }, (resp: any) => {
            if (chrome.runtime && chrome.runtime.lastError) {
                done({ success: false, error: chrome.runtime.lastError.message });
            } else {
                done(resp);
            }
        });
    });
}

    class AssetPipeline implements AssetPipelineInstance {
        currentSlot: string;
        useZip: boolean;
        folder: any;
        writeFileDirect: ((path: string, content: any) => Promise<boolean>) | null;
        takeoutEngine: any;
        getGeminiTab: ((slot?: string) => Promise<any>) | null;
        fetchAssetDelegate: ((params: any) => Promise<any>) | null;
        onLog: (msg: string, level?: string) => void;
        downloadTimeoutMs: number;

        static sanitizeZipPath = sanitizeZipPath;

        constructor(options: AssetPipelineOptions = {}) {
            this.currentSlot = options.currentSlot || 'u0';
            this.useZip = options.useZip !== false;
            this.folder = options.folder || null;
            this.writeFileDirect = options.writeFileDirect || null;
            this.takeoutEngine = options.takeoutEngine || null;
            this.getGeminiTab = options.getGeminiTab || null;
            this.fetchAssetDelegate = options.fetchAssetDelegate || options.fetchAsset || null;
            this.onLog = options.onLog || (() => {});
            this.downloadTimeoutMs = options.downloadTimeoutMs || 15000;
        }

        /**
         * A single download attempt, abort-aware.
         */
        private async downloadOnce(targetUrl: string, chat: any, item: any, timeoutMs: number, signal: AbortSignal | null): Promise<any> {
            let r: any = null;

            if (this.fetchAssetDelegate && targetUrl) {
                r = await this.fetchAssetDelegate({
                    url: targetUrl,
                    referer: `https://gemini.google.com/app/${chat.id}`,
                    preferBuffer: true,
                    timeoutMs,
                    slot: this.currentSlot,
                    chat,
                    item,
                    signal
                });
            } else {
                const tab = this.getGeminiTab ? await this.getGeminiTab(this.currentSlot) : null;
                if (tab && targetUrl && typeof chrome !== 'undefined' && chrome.tabs) {
                    r = await sendTabAssetRequest(tab.id, targetUrl, chat.id, true, timeoutMs, 'tabs.sendMessage timed out', signal);
                }
            }

            // In Chrome extension IPC, ArrayBuffers passed via chrome.tabs.sendMessage get collapsed to {}
            // If dataBuffer is not a valid ArrayBuffer or lacks byteLength, and no base64 was sent, fall back to requesting Base64
            if (r && r.success && !hasValidBuffer(r) && !hasValidB64(r) && typeof chrome !== 'undefined' && chrome.tabs) {
                const fallbackTab = this.getGeminiTab ? await this.getGeminiTab(this.currentSlot) : null;
                if (fallbackTab && fallbackTab.id) {
                    r = await sendTabAssetRequest(fallbackTab.id, targetUrl, chat.id, false, timeoutMs, 'tabs.sendMessage fallback timed out', signal);
                }
            }
            return r;
        }

        /**
         * Validate the download payload and persist it (zip folder or direct file write).
         */
        private async persistDownload(r: any, localName: string, isImage: boolean): Promise<{ saved: boolean; failReason: string }> {
            let saved = false;
            let failReason = '';
            if (r && r.success) {
                const isValidBuffer = hasValidBuffer(r);
                const bytes = isValidBuffer ? (
                    typeof ArrayBuffer !== 'undefined' && r.dataBuffer instanceof ArrayBuffer
                        ? new Uint8Array(r.dataBuffer)
                        : (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(r.dataBuffer)
                            ? new Uint8Array(r.dataBuffer.buffer, r.dataBuffer.byteOffset, r.dataBuffer.byteLength)
                            : new Uint8Array(r.dataBuffer))
                ) : null;
                const b64 = (r.dataBase64 || r.blobBase64 || (typeof r.dataUrl === 'string' && r.dataUrl.includes(',') ? r.dataUrl.split(',')[1] : null));

                if (this.useZip) {
                    if (this.folder) {
                        if (bytes && bytes.length > 0) {
                            this.folder.file(sanitizeZipPath(localName), bytes);
                            saved = true;
                        } else if (b64 && typeof b64 === 'string' && b64.length > 0) {
                            this.folder.file(sanitizeZipPath(localName), b64, { base64: true });
                            saved = true;
                        }
                    }
                } else if (this.writeFileDirect) {
                    if (bytes && bytes.length > 0) {
                        saved = await this.writeFileDirect(localName, bytes);
                    } else if (b64 && typeof b64 === 'string' && b64.length > 0) {
                        const binStr = atob(b64);
                        const len = binStr.length;
                        const b = new Uint8Array(len);
                        for (let k = 0; k < len; k++) b[k] = binStr.charCodeAt(k);
                        saved = await this.writeFileDirect(localName, b);
                    }
                }

                if (!saved) {
                    failReason = r.error || 'Empty or unparseable binary/base64 payload';
                }
            } else {
                failReason = r ? r.error : (isImage ? 'image direct download failed' : 'downloadAssetDirect failed');
            }
            return { saved, failReason };
        }

        /**
         * Download and persist an asset (image or attachment file) with retries and backoff.
         */
        async processAsset(item: any, chat: any, opts: ProcessAssetOptions = {}): Promise<ProcessAssetResult> {
            const isImage = !!opts.isImage;
            const targetUrl = isImage ? (item.resolvedUrl || item.sourceUrl || item.url) : ([item.url, item.sourceUrl, item.src].filter(Boolean)[0]);
            const localName = item.localName || item.fileName || item.title || (isImage ? 'image.jpg' : 'file.bin');
            const signal = opts.signal || null;
            const maxRetries = (typeof opts.maxRetries === "number" && opts.maxRetries >= 0) ? Math.floor(opts.maxRetries) : 3;
            const timeoutMs = opts.timeoutMs || this.downloadTimeoutMs;
            let saved = false;
            let failReason = '';
            let recoveredFromTakeout = false;

            try {
                let attempt = 0;
                for (;;) {
                    if (signal && signal.aborted) { failReason = 'aborted'; break; }
                    const r = await this.downloadOnce(targetUrl, chat, item, timeoutMs, signal);
                    if (signal && signal.aborted) { failReason = 'aborted'; break; }
                    const persisted = await this.persistDownload(r, localName, isImage);
                    if (persisted.saved) { saved = true; failReason = ''; break; }
                    failReason = persisted.failReason;
                    if (attempt >= maxRetries) break;
                    const delayMs = calculateBackoff(attempt, { initialDelayMs: 1000, maxDelayMs: 10000, jitterMs: 500 });
                    this.onLog(`[${chat.title || chat.id}] 附件下载失败，${delayMs}ms 后重试 (${attempt + 1}/${maxRetries}): ${localName}`, 'warn');
                    if (await interruptibleSleep(delayMs, signal)) { failReason = 'aborted'; break; }
                    attempt++;
                }
            } catch (e: any) {
                failReason = e.message;
            }

            // Fallback: Takeout Offline Media Pool
            if (!saved && this.takeoutEngine) {
                try {
                    const offlineBin = await this.takeoutEngine.getTakeoutFallbackMedia(chat.id, localName, this.currentSlot);
                    if (offlineBin && offlineBin.length > 0) {
                        if (this.useZip && this.folder) {
                            this.folder.file(sanitizeZipPath(localName), offlineBin);
                            saved = true;
                        } else if (this.writeFileDirect) {
                            saved = await this.writeFileDirect(localName, offlineBin);
                        }
                        if (saved) {
                            recoveredFromTakeout = true;
                            const logKey = isImage ? 'logTakeoutImageRecovered' : 'logTakeoutAssetRecovered';
                            const defaultMsg = isImage
                                ? `[${chat.title || chat.id}] ⚡ 图片从 Takeout 离线池补全成功: ${localName}`
                                : `[${chat.title || chat.id}] ⚡ 附件从 Takeout 离线池补全成功: ${localName}`;
                            const I18n = __resolveModule('I18n', I18nStatic);
                            this.onLog(I18n.t(logKey, chat.title || chat.id, localName), 'info');
                        }
                    }
                } catch (e) {
                    if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:assetPipeline.ts]", e);
                }
            }

            return { saved, failReason, recoveredFromTakeout, localName };
        }
    }

export {
    AssetPipeline
};

export default AssetPipeline;
