// src/core/engine/assetPipeline.js - Dedicated Asset Download & Persistence Pipeline
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AssetPipeline = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function sanitizeZipPath(p) {
        // Single source: GeminiUtils.sanitizeRelativePath (load order guarantees utils first).
        if (!p) return p;
        if (typeof GeminiUtils !== 'undefined' && GeminiUtils.sanitizeRelativePath) {
            return GeminiUtils.sanitizeRelativePath(p, 'file');
        }
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils?.sanitizeRelativePath) {
            return globalThis.GeminiUtils.sanitizeRelativePath(p, 'file');
        }
        if (typeof require !== 'undefined') {
            try {
                const u = require('../utils/utils.js');
                if (u && u.sanitizeRelativePath) return u.sanitizeRelativePath(p, 'file');
            } catch { /* intentional: require fallback in browser context */ }
        }
        throw new Error('GeminiUtils.sanitizeRelativePath unavailable — check module load order');
    }

    class AssetPipeline {
        constructor(options = {}) {
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
         * Download and persist an asset (image or attachment file)
         * @param {Object} item - The asset item (att or img)
         * @param {Object} chat - The conversation object
         * @param {Object} opts - Additional options { isImage, listTitle, timeoutMs }
         * @returns {Promise<{ saved: boolean, failReason: string, recoveredFromTakeout: boolean, localName: string }>}
         */
        async processAsset(item, chat, opts = {}) {
            const isImage = !!opts.isImage;
            const targetUrl = isImage ? (item.resolvedUrl || item.sourceUrl || item.url) : ([item.url, item.sourceUrl, item.src].filter(Boolean)[0]);
            const localName = item.localName || item.fileName || item.title || (isImage ? 'image.jpg' : 'file.bin');
            let saved = false;
            let failReason = '';
            let recoveredFromTakeout = false;

            try {
                let r = null;
                const timeoutMs = opts.timeoutMs || this.downloadTimeoutMs;

                if (this.fetchAssetDelegate && targetUrl) {
                    r = await this.fetchAssetDelegate({
                        url: targetUrl,
                        referer: `https://gemini.google.com/app/${chat.id}`,
                        preferBuffer: true,
                        timeoutMs,
                        slot: this.currentSlot,
                        chat,
                        item
                    });
                } else {
                    const tab = this.getGeminiTab ? await this.getGeminiTab(this.currentSlot) : null;
                    if (tab && targetUrl && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
                        r = await new Promise(resolve => {
                            let timer = null;
                            let settled = false;

                            if (timeoutMs > 0) {
                                timer = setTimeout(() => {
                                    if (!settled) {
                                        settled = true;
                                        resolve({ success: false, error: `tabs.sendMessage timed out after ${timeoutMs}ms` });
                                    }
                                }, timeoutMs);
                            }

                            chrome.tabs.sendMessage(tab.id, {
                                action: 'downloadAssetDirect',
                                url: targetUrl,
                                referer: `https://gemini.google.com/app/${chat.id}`,
                                preferBuffer: true
                            }, (resp) => {
                                if (timer) clearTimeout(timer);
                                if (!settled) {
                                    settled = true;
                                    if (chrome.runtime && chrome.runtime.lastError) {
                                        resolve({ success: false, error: chrome.runtime.lastError.message });
                                    } else {
                                        resolve(resp);
                                    }
                                }
                            });
                        });
                    }
                }

                    if (r && r.success && (r.dataBuffer || r.dataBase64 || r.blobBase64)) {
                        const isValidBuffer = r.dataBuffer && (
                            (typeof ArrayBuffer !== 'undefined' && r.dataBuffer instanceof ArrayBuffer && r.dataBuffer.byteLength > 0) ||
                            (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(r.dataBuffer) && r.dataBuffer.byteLength > 0)
                        );
                        const bytes = isValidBuffer ? new Uint8Array(r.dataBuffer.buffer || r.dataBuffer) : null;
                        const b64 = r.dataBase64 || r.blobBase64;

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
                    } else {
                        failReason = r ? r.error : (isImage ? 'image direct download failed' : 'downloadAssetDirect failed');
                    }
            } catch (e) {
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
                            this.onLog(typeof I18n !== 'undefined' ? I18n.t(logKey, chat.title || chat.id, localName) : defaultMsg, 'info');
                        }
                    }
                } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:assetPipeline.js]", e); }
            }

            return { saved, failReason, recoveredFromTakeout, localName };
        }
    }

    return AssetPipeline;
}));
