// src/ui/options/modules/optionsInit.js - Workbench initialization & state loader
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.OptionsInit = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function $(id) {
        return typeof document !== 'undefined' ? document.getElementById(id) : null;
    }

    const Store = (typeof ConversationsStore !== 'undefined') ? ConversationsStore : null;
    const List = (typeof ListView !== 'undefined') ? ListView : null;
    const Log = (typeof LogView !== 'undefined') ? LogView : null;
    const Dialogs = (typeof DialogView !== 'undefined') ? DialogView : null;
    const Account = (typeof AccountView !== 'undefined') ? AccountView : null;
    const Controller = (typeof ExportController !== 'undefined') ? ExportController : null;
    const Tour = (typeof TourGuide !== 'undefined') ? TourGuide : null;
    const Storage = (typeof StorageService !== 'undefined') ? StorageService : ((typeof window !== 'undefined' && window.StorageService) || null);
    const Utils = (typeof GeminiUtils !== 'undefined') ? GeminiUtils : {};

    const normId = id => (Utils.normId ? Utils.normId(id) : String(id || '').replace(/^c_/, ''));
    const cleanTitle = (t) => (Utils.cleanTitle ? Utils.cleanTitle(t) : (t || '').trim());
    const isRealTitle = (t, id) => (Utils.isRealTitle ? Utils.isRealTitle(t, id) : !!(t && String(t).trim().length > 1));
    const isBad = (t, id) => !isRealTitle(t, id);
    const resolveTitle = (chat) => (Utils.resolveTitle ? Utils.resolveTitle(chat) : { title: cleanTitle(chat?.title) || '未命名对话', source: chat?.titleSource || 'legacy' });
    const getEffectiveTime = (conv) => (Utils.getEffectiveTimestamp ? Utils.getEffectiveTimestamp(conv) : (conv ? ((typeof (conv.updatedAt || conv.timestamp || 0) === 'string') ? new Date(conv.updatedAt || conv.timestamp).getTime() : (conv.updatedAt || conv.timestamp || 0)) : 0));
    const compareConversations = (a, b) => (Utils.compareConversations ? Utils.compareConversations(a, b) : 0);

    let __lastRenderedSignature = '';
    let __lastRenderTime = 0;
    let __chatSearchFilter = '';
    let __searchDebounceTimer = null;
    let __pendingTakeoutChecker = null;

    function log(msg, level = 'info') {
        console.log(`[LOG ${level}]`, msg);
        if (Log && Log.log) Log.log(msg, level);
    }

    function clearLog() {
        if (Log && Log.clear) Log.clear();
    }

    function renderLog() {
        if (Log && Log.render) Log.render();
    }

    function getSearchFilter() {
        return __chatSearchFilter;
    }

    function setSearchFilter(filter) {
        __chatSearchFilter = filter || '';
    }

    function updateAccountSlotSelector() {
        if (Account && Account.render && Store) {
            Account.render(Store.getAccountSlots(), Store.getCurrentSlot());
        }
    }

    async function checkExportSession() {
        try {
            if (!Dialogs || !Dialogs.renderExportBanner) return;
            const isRunning = Controller ? Controller.isRunning() : false;
            const { gemini_last_export_session: session } = await chrome.storage.local.get(['gemini_last_export_session']);
            const slot = Store ? Store.getCurrentSlot() : 'u0';
            Dialogs.renderExportBanner(session, slot, isRunning);
        } catch (e) {
            console.debug('[workbench:init] checkExportSession error', e);
        }
    }

    async function loadStore(force = false) {
        try {
            if (typeof window !== 'undefined') {
                window.__workbenchLoadStore = loadStore;
            }
            if (!Store) return;
            const slot = Store.getCurrentSlot() || 'u0';
            const { conversations: incoming, exportedIds } = await Store.loadStore(slot);
            updateAccountSlotSelector();

            let prevSelected = null;
            try {
                if (List && Store.getConversations().length > 0) {
                    prevSelected = List.getSelectedIds();
                }
            } catch {
                prevSelected = null;
            }

            const syncInfo = await Store.getLastSync(slot);
            const lastSyncVal = syncInfo.timestamp;

            const incomingSig = Store.getSignature(incoming);
            const currentList = Store.getConversations();
            const sameSig = (incomingSig === __lastRenderedSignature && incoming.length === currentList.length && currentList.length > 0);

            if (!force && sameSig && Date.now() - __lastRenderTime < 500) {
                const lastSyncElFast = $('lastSync');
                if (lastSyncElFast && lastSyncVal) {
                    const syncFmtFast = typeof I18n !== 'undefined'
                        ? I18n.t('lastSync', new Date(lastSyncVal).toLocaleString(), incoming.length)
                        : `Last sync: ${new Date(lastSyncVal).toLocaleString()} | Total: ${incoming.length}`;
                    lastSyncElFast.textContent = syncFmtFast;
                }
                return;
            }

            // Deduplicate and sanitize titles via ConversationsStore (scrubs isBad titles and sorts with compareConversations)
            const { processed, hasDirtyTitles } = Store.normalizeAndDeduplicate
                ? Store.normalizeAndDeduplicate(incoming)
                : { processed: (incoming || []).slice().sort(compareConversations), hasDirtyTitles: false };

            if (hasDirtyTitles && Storage) {
                Storage.setConversations(slot, processed).catch(() => {});
            }

            Store.setConversations(processed);

            const lastSyncEl = $('lastSync');
            if (lastSyncEl) {
                if (lastSyncVal) {
                    lastSyncEl.textContent = typeof I18n !== 'undefined'
                        ? I18n.t('lastSync', new Date(lastSyncVal).toLocaleString(), processed.length)
                        : `Last sync: ${new Date(lastSyncVal).toLocaleString()} | Total: ${processed.length}`;
                } else {
                    lastSyncEl.textContent = processed.length ? (typeof I18n !== 'undefined' ? I18n.t('selectedStat', 0, processed.length) : `${processed.length} total`) : '';
                }
            }

            const syncCountEl = $('syncCount');
            if (syncCountEl && processed.length) {
                syncCountEl.textContent = typeof I18n !== 'undefined' ? I18n.t('syncedBadge', processed.length) : `Synced: ${processed.length}`;
            }

            if (List) {
                List.render(processed, exportedIds, prevSelected, __chatSearchFilter);
                List.updateStat(processed);
            }

            __lastRenderedSignature = Store.getSignature(processed);
            __lastRenderTime = Date.now();
            await checkExportSession();
            if (__pendingTakeoutChecker) {
                await __pendingTakeoutChecker();
            }
        } catch (e) {
            console.error('[workbench:init] loadStore error', e);
        }
    }

    function bindSearchAndSelection() {
        // Search bar handler
        ($('chatSearchInput') || $('search'))?.addEventListener('input', (e) => {
            __chatSearchFilter = (e.target.value || '').trim();
            const doFilter = () => {
                const convs = Store ? Store.getConversations() : [];
                const expMap = Store ? Store.getExportedIds() : {};
                const currentSelected = List ? List.getSelectedIds() : new Set();
                if (List) List.render(convs, expMap, currentSelected, __chatSearchFilter);
            };
            const convs = Store ? Store.getConversations() : [];
            if (convs && convs.length > 100) {
                clearTimeout(__searchDebounceTimer);
                __searchDebounceTimer = setTimeout(doFilter, 100);
            } else {
                doFilter();
            }
        });

        // List Selection Filter Buttons
        $('btnSelectAll')?.addEventListener('click', () => {
            const convs = Store ? Store.getConversations() : [];
            if (List) List.selectAll(convs);
        });
        ($('btnSelectNone') || $('btnDeselectAll'))?.addEventListener('click', () => {
            const convs = Store ? Store.getConversations() : [];
            if (List) List.deselectAll(convs);
        });
        ($('btnSelectUnexported') || $('btnFilterNew'))?.addEventListener('click', () => {
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            if (List) List.selectUnexported(convs, expMap);
        });
        ($('btnSelectUpdated') || $('btnFilterNeedsUpdate'))?.addEventListener('click', () => {
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            if (List) List.selectNeedsUpdate(convs, expMap);
        });

        // Account Slot Switch Handler
        $('accountSlotSelect')?.addEventListener('change', async (e) => {
            const newSlot = e.target.value;
            console.log('[workbench] Account slot changed to:', newSlot);
            if (Store) {
                Store.setCurrentSlot(newSlot);
                await loadStore();
            }
        });

        // Tour guide trigger
        $('btnTourGuide')?.addEventListener('click', () => {
            if (Tour && Tour.startTour) {
                Tour.startTour(0);
            }
        });
    }

    function initHeaderVersion() {
        const verEl = $('ver');
        if (verEl) {
            try {
                verEl.textContent = 'v' + (chrome.runtime.getManifest()?.version || '1.4.1');
            } catch (e) {
                if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:optionsInit]', e);
            }
        }
    }

    function init({ onCheckPendingTakeout } = {}) {
        if (typeof window !== 'undefined') {
            window.__workbenchLoadStore = loadStore;
        }
        __pendingTakeoutChecker = onCheckPendingTakeout || null;
        initHeaderVersion();
        if (Log && Log.init) Log.init('log');
        bindSearchAndSelection();
    }

    return {
        init,
        loadStore,
        updateAccountSlotSelector,
        checkExportSession,
        getSearchFilter,
        setSearchFilter,
        log,
        clearLog,
        renderLog,
        compareConversations,
        isBad,
        normId,
        cleanTitle,
        isRealTitle,
        resolveTitle,
        getEffectiveTime
    };
}));
