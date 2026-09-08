// progressReporter.js - Progress calculation, logging callbacks, and session state persistence
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ProgressReporter = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function calculateProgress(current, total, downloadedAssets = 0, totalAssets = 0) {
        const totalChats = Number(total) || 0;
        const currentChats = Math.min(Number(current) || 0, totalChats);
        let pct = totalChats ? Math.floor((currentChats / totalChats) * 100) : 0;

        if (totalAssets > 0 && downloadedAssets > 0 && pct < 100) {
            const chatWeight = 0.75;
            const assetWeight = 0.25;
            const chatFraction = totalChats ? (currentChats / totalChats) : 0;
            const assetFraction = Math.min(1, downloadedAssets / totalAssets);
            pct = Math.min(99, Math.floor((chatFraction * chatWeight + assetFraction * assetWeight) * 100));
        }
        return pct;
    }

    async function updateStorageSession(sessionData) {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                await chrome.storage.local.set({
                    gemini_last_export_session: {
                        ...sessionData,
                        updatedAt: Date.now()
                    }
                });
            }
        } catch (e) {
            if (typeof console !== 'undefined' && console.debug) {
                console.debug('[GemExporter:progressReporter.js]', e);
            }
        }
    }

    class ProgressReporter {
        constructor({ totalChats = 0, onProgress = null, onLog = null } = {}) {
            this.totalChats = totalChats;
            this.currentExportIdx = 0;
            this.currentExportTitle = '';
            this.onProgress = onProgress || (() => {});
            this.onLog = onLog || (() => {});
        }

        log(message, level = 'info') {
            try {
                this.onLog(message, level);
            } catch (e) {
                if (typeof console !== 'undefined' && console.debug) {
                    console.debug('[GemExporter:progressReporter.js] log callback error', e);
                }
            }
        }

        update(chatIdx, chatTitle, { downloadedAssets = 0, totalAssets = 0 } = {}) {
            if (typeof chatIdx === 'number') this.currentExportIdx = chatIdx;
            if (typeof chatTitle === 'string' && chatTitle) this.currentExportTitle = chatTitle;

            const current = Math.min(this.currentExportIdx, this.totalChats);
            const pct = calculateProgress(current, this.totalChats, downloadedAssets, totalAssets);

            try {
                this.onProgress({
                    current,
                    total: this.totalChats,
                    pct,
                    title: this.currentExportTitle,
                    assetsDownloaded: downloadedAssets,
                    assetsTotal: totalAssets
                });
            } catch (e) {
                if (typeof console !== 'undefined' && console.debug) {
                    console.debug('[GemExporter:progressReporter.js] progress callback error', e);
                }
            }
            return pct;
        }

        async updateSession(data) {
            await updateStorageSession(data);
        }
    }

    return {
        ProgressReporter,
        calculateProgress,
        updateStorageSession
    };
}));
