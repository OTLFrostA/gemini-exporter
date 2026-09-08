// src/ui/options/modules/optionsSync.js - Cloud synchronization, background progress & pruning
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.OptionsSync = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function $(id) {
        return typeof document !== 'undefined' ? document.getElementById(id) : null;
    }

    const Store = (typeof ConversationsStore !== 'undefined') ? ConversationsStore : null;
    const Controller = (typeof ExportController !== 'undefined') ? ExportController : null;
    const SyncCtrl = (typeof SyncController !== 'undefined') ? SyncController : null;

    let __loadStore = null;
    let __log = null;
    let __maybePromptTakeout = null;

    function log(msg, level = 'info') {
        if (__log) __log(msg, level);
        else console.log(`[SYNC ${level}]`, msg);
    }

    function bindSyncButtons() {
        $('btnIncrementalScan')?.addEventListener('click', () => {
            if (Controller && Controller.isRunning()) return;
            const progWrap = $('progWrap');
            const bar = $('bar');
            const progText = $('progText');
            const slot = Store ? Store.getCurrentSlot() : 'u0';

            if (SyncCtrl) {
                SyncCtrl.startIncrementalScan(slot, {
                    onStart: () => {
                        if (progWrap) progWrap.style.display = 'block';
                        if (bar) bar.style.width = '5%';
                        if (progText) progText.textContent = typeof I18n !== 'undefined' ? I18n.t('syncingLatest') : '正在同步最新会话...';
                    },
                    onLog: (txt, lvl) => log(txt, lvl),
                    onFinished: ({ message }) => {
                        if (bar) bar.style.width = '100%';
                        if (progText) progText.textContent = message;
                        setTimeout(() => {
                            if (progWrap) progWrap.style.display = 'none';
                            if (bar) bar.style.width = '0%';
                            if (progText) progText.textContent = '';
                        }, 2500);
                        if (__loadStore) __loadStore();
                    },
                    onError: (err, errMsg) => {
                        if (progText) progText.textContent = errMsg;
                    }
                });
            }
        });

        $('btnDeepScan')?.addEventListener('click', () => {
            if (Controller && Controller.isRunning()) return;
            const progWrap = $('progWrap');
            const bar = $('bar');
            const progText = $('progText');
            const slot = Store ? Store.getCurrentSlot() : 'u0';

            if (SyncCtrl) {
                SyncCtrl.startDeepScan(slot, {
                    onStart: () => {
                        if (progWrap) progWrap.style.display = 'block';
                        if (bar) bar.style.width = '5%';
                        if (progText) progText.textContent = typeof I18n !== 'undefined' ? I18n.t('deepSyncing') : '正在全量扫描历史...';
                    },
                    onLog: (txt, lvl) => log(txt, lvl),
                    onFinished: async ({ message, res, count, hitGoogleLimit }) => {
                        if (bar) bar.style.width = '100%';
                        if (progText) progText.textContent = message;
                        setTimeout(() => {
                            if (progWrap) progWrap.style.display = 'none';
                            if (bar) bar.style.width = '0%';
                            if (progText) progText.textContent = '';
                        }, 2500);
                        if (__loadStore) __loadStore();
                        const currentCount = count || res?.count || (Store && Store.getAllConversations ? Store.getAllConversations().length : 0);
                        const slidingLimit = (typeof GeminiProtocol !== 'undefined' && GeminiProtocol.LIMITS?.SLIDING_WINDOW) || 600;
                        const isLimit = hitGoogleLimit || (currentCount >= slidingLimit);
                        if (isLimit && __maybePromptTakeout) {
                            await __maybePromptTakeout(currentCount, !!hitGoogleLimit);
                        }
                    },
                    onError: async (err, errMsg, details) => {
                        if (progText) progText.textContent = errMsg;
                        const slidingLimit = (typeof GeminiProtocol !== 'undefined' && GeminiProtocol.LIMITS?.SLIDING_WINDOW) || 600;
                        const currentCount = (Store && Store.getAllConversations) ? Store.getAllConversations().length : 0;
                        const isLimit = details?.hitGoogleLimit || (currentCount >= slidingLimit) || (details?.count >= slidingLimit);
                        if (isLimit && __maybePromptTakeout) {
                            await __maybePromptTakeout(currentCount || details?.count || slidingLimit, !!details?.hitGoogleLimit);
                        }
                    }
                });
            }
        });

        $('btnStopScan')?.addEventListener('click', () => {
            const slot = Store ? Store.getCurrentSlot() : 'u0';
            if (SyncCtrl) {
                SyncCtrl.stopScan(slot, {
                    onLog: (txt, lvl) => log(txt, lvl),
                    onStopped: ({ message }) => {
                        const progText = $('progText');
                        if (progText) progText.textContent = message;
                    }
                });
            }
        });

        $('btnPruneDeleted')?.addEventListener('click', async () => {
            if (Controller && Controller.isRunning()) return;
            const btn = $('btnPruneDeleted');
            if (btn) btn.disabled = true;
            log(typeof I18n !== 'undefined' ? I18n.t('logPruneStarted') : '正在检测云端存活会话并清理本地失效会话...', 'info');
            try {
                let C = (typeof GeminiAPIClient !== 'undefined') ? GeminiAPIClient : window.GeminiAPIClient;
                if (!C) throw new Error('GeminiAPIClient not loaded');
                let client = new C();
                let all = await client.getAllConversations(2000, null, null, { incremental: false });
                if (all && all.conversations) {
                    const recRes = await Store.reconcileWithCloud(all.conversations, { keepTakeout: true });
                    if (recRes && recRes.removed > 0) {
                        const msg = typeof I18n !== 'undefined'
                            ? I18n.t('logPruneFinished', recRes.removed, recRes.kept)
                            : `清理完成: 成功剔除 ${recRes.removed} 条已删除会话，保留 ${recRes.kept} 条有效会话`;
                        log(msg, 'info');
                    } else {
                        const msg = typeof I18n !== 'undefined'
                            ? I18n.t('logPruneClean')
                            : '所有本地会话均与云端状态一致，无失效残留会话';
                        log(msg, 'info');
                    }
                    if (__loadStore) await __loadStore(true);
                }
            } catch (err) {
                log((typeof I18n !== 'undefined' ? I18n.t('syncFailed', err.message || err) : `清理失败: ${err.message || err}`), 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        });
    }

    function bindBroadcastListeners() {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;

        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.action === 'scanProgress') {
                const progWrap = $('progWrap');
                const bar = $('progBar') || $('bar');
                const progText = $('progText');
                if (progWrap) progWrap.style.display = 'block';
                let pct = typeof msg.percent === 'number' ? msg.percent : 50;
                if (bar) bar.style.width = Math.min(Math.max(pct, 5), 100) + '%';
                if (progText && msg.title) progText.textContent = msg.title;
                if (msg.title) log(msg.title);

                const slidingLimit = (typeof GeminiProtocol !== 'undefined' && GeminiProtocol.LIMITS?.SLIDING_WINDOW) || 600;
                if ((msg.percent === 100 || msg.done === 1) && (msg.hitGoogleLimit || (msg.count >= slidingLimit))) {
                    if (__maybePromptTakeout) {
                        __maybePromptTakeout(msg.count || slidingLimit, !!msg.hitGoogleLimit);
                    }
                }
            }
            if (msg.action === 'syncUpdate') {
                if (__loadStore) __loadStore(true);
            }
        });
    }

    async function autoDetectActiveSlot() {
        try {
            if (typeof TabService !== 'undefined' && TabService.getGeminiTab) {
                const tab = await TabService.getGeminiTab();
                if (tab && tab.url) {
                    const m = tab.url.match(/\/u\/(\d+)(?:\/|$)/);
                    if (m && Store) {
                        Store.setCurrentSlot('u' + m[1]);
                    }
                }
            }
        } catch (e) {
            if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:optionsSync]', e);
        }
    }

    async function init({ loadStore, log: logFn, maybePromptTakeout } = {}) {
        __loadStore = loadStore || null;
        __log = logFn || null;
        __maybePromptTakeout = maybePromptTakeout || null;

        bindSyncButtons();
        bindBroadcastListeners();
        await autoDetectActiveSlot();
    }

    return {
        init,
        bindBroadcastListeners,
        autoDetectActiveSlot
    };
}));
