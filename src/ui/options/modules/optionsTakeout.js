// src/ui/options/modules/optionsTakeout.js - Takeout archive import & Google limit detection
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.OptionsTakeout = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function $(id) {
        return typeof document !== 'undefined' ? document.getElementById(id) : null;
    }

    const Store = (typeof ConversationsStore !== 'undefined') ? ConversationsStore : null;
    const Dialogs = (typeof DialogView !== 'undefined') ? DialogView : null;
    const Storage = (typeof StorageService !== 'undefined') ? StorageService : ((typeof window !== 'undefined' && window.StorageService) || null);
    const TakeoutCtrl = (typeof TakeoutController !== 'undefined') ? TakeoutController : null;

    let __loadStore = null;
    let __log = null;

    function log(msg, level = 'info') {
        if (__log) __log(msg, level);
        else console.log(`[TAKEOUT ${level}]`, msg);
    }

    async function isTakeoutPromptCompleted() {
        try {
            return (Storage && Storage.isTakeoutPromptCompleted)
                ? await Storage.isTakeoutPromptCompleted()
                : false;
        } catch {
            return false;
        }
    }

    async function maybePromptTakeout(count, hitGoogleLimit = false) {
        try {
            const isCompleted = await isTakeoutPromptCompleted();
            const hasTakeout = (Store && Store.hasTakeoutData && Store.hasTakeoutData()) ||
                (Storage && Storage.hasTakeoutData && await Storage.hasTakeoutData());
            if (!isCompleted && !hasTakeout && Dialogs && Dialogs.showTakeoutLimitPrompt) {
                Dialogs.showTakeoutLimitPrompt({
                    count: count || 600,
                    hitGoogleLimit: !!hitGoogleLimit,
                    onImportTakeout: () => $('takeoutFileInput')?.click()
                });
            }
        } catch (e) {
            console.debug('[workbench:takeout] maybePromptTakeout error', e);
        }
    }

    async function checkPendingTakeoutPrompt() {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                const data = await chrome.storage.local.get(['gemini_pending_takeout_prompt']);
                if (data && data.gemini_pending_takeout_prompt) {
                    const info = data.gemini_pending_takeout_prompt;
                    await chrome.storage.local.remove('gemini_pending_takeout_prompt');
                    await maybePromptTakeout(info.count || 600, !!info.hitGoogleLimit);
                }
            }
        } catch (e) {
            console.debug('[workbench:takeout] checkPendingTakeoutPrompt error', e);
        }
    }

    function init({ loadStore, log: logFn } = {}) {
        __loadStore = loadStore || null;
        __log = logFn || null;

        $('btnImportTakeout')?.addEventListener('click', () => $('takeoutFileInput')?.click());

        $('takeoutFileInput')?.addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (f && TakeoutCtrl) {
                const progWrap = $('progWrap');
                const bar = $('bar');
                const progText = $('progText');
                if (progWrap) progWrap.style.display = 'block';
                if (bar) bar.style.width = '15%';

                TakeoutCtrl.handleTakeoutImport(f, {
                    onProgress: (pct, txt) => {
                        if (bar) bar.style.width = `${pct}%`;
                        if (progText) progText.textContent = txt;
                    },
                    onLog: (txt, lvl) => log(txt, lvl),
                    onFinished: ({ message }) => {
                        if (progText) progText.textContent = message;
                        if (progWrap) progWrap.style.display = 'none';
                        if (__loadStore) __loadStore();
                    },
                    onError: (err, errMsg) => {
                        if (progText) progText.textContent = errMsg;
                        if (progWrap) progWrap.style.display = 'none';
                    }
                });
            }
        });
    }

    return {
        init,
        maybePromptTakeout,
        checkPendingTakeoutPrompt,
        isTakeoutPromptCompleted
    };
}));
