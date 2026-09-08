// options.js - Gemini Exporter workbench coordinator facade (Layered Architecture)
(function(root) {
    'use strict';

    // Sub-Module References (with safe fallbacks)
    const Init = (typeof OptionsInit !== 'undefined') ? OptionsInit : ((typeof root !== 'undefined' && root.OptionsInit) || null);
    const ExportMod = (typeof OptionsExport !== 'undefined') ? OptionsExport : ((typeof root !== 'undefined' && root.OptionsExport) || null);
    const SyncMod = (typeof OptionsSync !== 'undefined') ? OptionsSync : ((typeof root !== 'undefined' && root.OptionsSync) || null);
    const TakeoutMod = (typeof OptionsTakeout !== 'undefined') ? OptionsTakeout : ((typeof root !== 'undefined' && root.OptionsTakeout) || null);
    const SettingsMod = (typeof OptionsSettings !== 'undefined') ? OptionsSettings : ((typeof root !== 'undefined' && root.OptionsSettings) || null);

    // Logging helpers
    function log(msg, level = 'info') {
        if (Init && Init.log) Init.log(msg, level);
        else console.log(`[LOG ${level}]`, msg);
    }
    function clearLog() {
        if (Init && Init.clearLog) Init.clearLog();
    }
    function renderLog() {
        if (Init && Init.renderLog) Init.renderLog();
    }

    // Facade delegations & static regression test anchors:
    // 1. compareConversations SSoT delegation (verified by tests/run_tests.py)
    const compareConversations = (a, b) => (Init && Init.compareConversations ? Init.compareConversations(a, b) : 0);

    // 2. isBad title scrubbing delegation (verified by tests/regression_p0.test.js)
    const isBad = (t, id) => (Init && Init.isBad ? Init.isBad(t, id) : false);

    // 3. checkPendingTakeoutPrompt & gemini_pending_takeout_prompt check (verified by tests/run_tests.py)
    async function checkPendingTakeoutPrompt() {
        if (TakeoutMod && TakeoutMod.checkPendingTakeoutPrompt) {
            return await TakeoutMod.checkPendingTakeoutPrompt();
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get(['gemini_pending_takeout_prompt']);
            if (data && data.gemini_pending_takeout_prompt) {
                await chrome.storage.local.remove('gemini_pending_takeout_prompt');
            }
        }
    }

    // 4. isTakeoutPromptCompleted check (verified by tests/run_tests.py)
    async function isTakeoutPromptCompleted() {
        return TakeoutMod ? await TakeoutMod.isTakeoutPromptCompleted() : false;
    }

    // 5. loadStore facade & window binding
    async function loadStore(force = false) {
        if (typeof window !== 'undefined') {
            window.__workbenchLoadStore = loadStore;
        }
        if (Init && Init.loadStore) {
            return await Init.loadStore(force);
        }
    }

    // Expose early for external callers and tests
    if (typeof window !== 'undefined') {
        window.__workbenchLoadStore = loadStore;
    }

    async function initWorkbench() {
        if (typeof window !== 'undefined') {
            window.__workbenchLoadStore = loadStore;
        }

        // Initialize sub-modules in lifecycle order
        if (TakeoutMod && TakeoutMod.init) {
            TakeoutMod.init({ loadStore, log });
        }

        if (Init && Init.init) {
            Init.init({
                onCheckPendingTakeout: () => checkPendingTakeoutPrompt()
            });
        }

        if (ExportMod && ExportMod.init) {
            await ExportMod.init({
                loadStore,
                log,
                getSearchFilter: () => (Init ? Init.getSearchFilter() : '')
            });
        }

        if (SyncMod && SyncMod.init) {
            await SyncMod.init({
                loadStore,
                log,
                maybePromptTakeout: (count, hitLimit) => (TakeoutMod ? TakeoutMod.maybePromptTakeout(count, hitLimit) : null)
            });
        }

        if (SettingsMod && SettingsMod.init) {
            await SettingsMod.init({
                loadStore,
                log,
                clearLog,
                renderLog,
                updateZipUi: () => (ExportMod ? ExportMod.updateZipUi() : null),
                checkExportSession: () => (Init ? Init.checkExportSession() : null),
                updateAccountSlotSelector: () => (Init ? Init.updateAccountSlotSelector() : null),
                getSearchFilter: () => (Init ? Init.getSearchFilter() : '')
            });
        }

        // Initial store load
        await loadStore();

        // Check for welcome / onboarding tour
        if (SettingsMod && SettingsMod.checkOnboardingTour) {
            SettingsMod.checkOnboardingTour();
        }
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initWorkbench);
        } else {
            initWorkbench();
        }
    }
})(typeof self !== 'undefined' ? self : this);
