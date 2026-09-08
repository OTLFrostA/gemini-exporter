// src/ui/options/modules/optionsSettings.js - Language, dev mode, diagnostics, and storage cleanup
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.OptionsSettings = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function $(id) {
        return typeof document !== 'undefined' ? document.getElementById(id) : null;
    }

    const Store = (typeof ConversationsStore !== 'undefined') ? ConversationsStore : null;
    const List = (typeof ListView !== 'undefined') ? ListView : null;
    const Formats = (typeof FormatStore !== 'undefined') ? FormatStore : null;
    const Storage = (typeof StorageService !== 'undefined') ? StorageService : ((typeof window !== 'undefined' && window.StorageService) || null);
    const Tour = (typeof TourGuide !== 'undefined') ? TourGuide : null;
    const Utils = (typeof GeminiUtils !== 'undefined') ? GeminiUtils : {};

    const normId = id => (Utils.normId ? Utils.normId(id) : String(id || '').replace(/^c_/, ''));
    const cleanTitle = (t) => (Utils.cleanTitle ? Utils.cleanTitle(t) : (t || '').trim());
    const resolveTitle = (chat) => (Utils.resolveTitle ? Utils.resolveTitle(chat) : { title: cleanTitle(chat?.title) || '未命名对话', source: chat?.titleSource || 'legacy' });

    let __loadStore = null;
    let __log = null;
    let __clearLog = null;
    let __renderLog = null;
    let __updateZipUi = null;
    let __checkExportSession = null;
    let __updateAccountSlotSelector = null;
    let __getSearchFilter = () => '';

    function log(msg, level = 'info') {
        if (__log) __log(msg, level);
        else console.log(`[SETTINGS ${level}]`, msg);
    }

    async function handleLangChange(targetLang) {
        console.log('[workbench] Switching language to:', targetLang);
        if (typeof I18n !== 'undefined') {
            const currentSelected = List ? List.getSelectedIds() : new Set();
            await I18n.setLang(targetLang);
            if (__updateAccountSlotSelector) __updateAccountSlotSelector();
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            if (List) {
                List.render(convs, expMap, currentSelected, __getSearchFilter());
                List.updateStat(convs);
            }
            if (__updateZipUi) __updateZipUi();
            if (__checkExportSession) await __checkExportSession();
            const syncCountEl = $('syncCount');
            if (syncCountEl && convs.length) {
                syncCountEl.textContent = I18n.t('syncedBadge', convs.length);
            }
        }
    }

    async function handleDevChange(devOn) {
        console.log('[workbench] Switching dev mode to:', devOn);
        document.body.classList.toggle('dev-mode', devOn);
        const labelDev = $('labelDevMode');
        if (labelDev) {
            labelDev.style.color = devOn ? 'var(--accent2, #06b6d4)' : 'var(--muted, #8a92b2)';
        }
        if (devOn && __renderLog) __renderLog();
        if (Formats && Formats.handleDevToggle) {
            const selectEl = $('format');
            if (selectEl) {
                const result = Formats.handleDevToggle(devOn, selectEl.value);
                if (result.changed) {
                    selectEl.value = result.format;
                    await Formats.saveFormat(result.format);
                }
            }
        }
        if (Store) await Store.setDevMode(devOn);
    }

    async function exportDiagnostics() {
        try {
            const d = await chrome.storage.local.get(['gemini_last_sync_diagnostics']);
            const diag = d.gemini_last_sync_diagnostics;
            if (!diag) {
                const noDataMsg = typeof I18n !== 'undefined' ? I18n.t('noDiagData') : 'No diagnostic data yet.';
                log(noDataMsg, 'info');
                return;
            }
            const jsonStr = JSON.stringify(diag, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gemini_diagnostics_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 3000);
            log('已生成诊断数据文件', 'info');
        } catch (e) {
            log('导出诊断失败: ' + e.message, 'error');
        }
    }

    function bindLanguageControls() {
        $('langToggle')?.addEventListener('change', (e) => {
            handleLangChange(e.target.checked ? 'en' : 'zh');
        });
        $('labelLangZh')?.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if ($('langToggle')) $('langToggle').checked = false;
            handleLangChange('zh');
        });
        $('labelLangEn')?.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if ($('langToggle')) $('langToggle').checked = true;
            handleLangChange('en');
        });
    }

    function bindDevControls() {
        $('devToggle')?.addEventListener('change', (e) => handleDevChange(e.target.checked));
        $('labelDevMode')?.addEventListener('click', () => {
            const dt = $('devToggle');
            if (dt) {
                dt.checked = !dt.checked;
                handleDevChange(dt.checked);
            }
        });
    }

    function bindLogControls() {
        $('logFilter')?.addEventListener('input', () => { if (__renderLog) __renderLog(); });
        $('logLevel')?.addEventListener('change', () => { if (__renderLog) __renderLog(); });
        $('btnClearLog')?.addEventListener('click', () => { if (__clearLog) __clearLog(); });
        $('btnCopyLog')?.addEventListener('click', async () => {
            const l = $('log');
            if (l) {
                await navigator.clipboard.writeText(l.textContent);
                $('btnCopyLog').textContent = typeof I18n !== 'undefined' ? I18n.t('copied') : '已复制!';
                setTimeout(() => $('btnCopyLog').textContent = typeof I18n !== 'undefined' ? I18n.t('btnCopyLog') : '复制', 1500);
            }
        });
        $('btnExportDiag')?.addEventListener('click', exportDiagnostics);
    }

    function bindStorageCleanup() {
        if (List && typeof List.setOnDelete === 'function') {
            List.setOnDelete(async (chatId) => {
                if (!chatId) return;
                const convs = Store ? Store.getConversations() : [];
                const targetChat = convs.find(c => normId(c.id) === normId(chatId));
                const chatTitle = targetChat ? (resolveTitle(targetChat).title || chatId) : chatId;
                const confirmMsg = typeof I18n !== 'undefined'
                    ? I18n.t('confirmDeleteChat', chatTitle)
                    : `确定从本地列表中移除会话 "${chatTitle}" 吗？`;
                if (confirm(confirmMsg)) {
                    await Store.removeConversation(chatId);
                    log(typeof I18n !== 'undefined' ? I18n.t('logChatRemoved', chatTitle) : `[${chatTitle}] 已从本地列表移除`, 'info');
                    if (__loadStore) await __loadStore(true);
                }
            });
        }

        $('btnClearExported')?.addEventListener('click', async () => {
            const slot = Store ? Store.getCurrentSlot() : 'u0';
            if (Store) await Store.clearExported(slot);
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            const currentSelected = new Set(List ? List.getSelected(convs).map(x => x.id) : []);
            if (List) {
                List.render(convs, expMap, currentSelected, __getSearchFilter());
                List.updateStat(convs);
            }
            log(typeof I18n !== 'undefined' ? I18n.t('confirmClearExported') : '已清空已导出记录', 'info');
        });

        $('btnClearAll')?.addEventListener('click', async () => {
            const confirmMsg = typeof I18n !== 'undefined' ? I18n.t('confirmClearAll') : '确定清空本地所有会话数据？';
            if (!confirm(confirmMsg)) return;
            const slot = Store ? Store.getCurrentSlot() : 'u0';
            if (Store) await Store.clearAll(slot);
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            if (List) {
                List.render(convs, expMap, null, __getSearchFilter());
                List.updateStat(convs);
            }
            log(typeof I18n !== 'undefined' ? I18n.t('confirmClearAll') : '本地会话数据已清空');
        });
    }

    async function initLanguage() {
        if (typeof I18n !== 'undefined') {
            try {
                await I18n.initLanguage();
                I18n.applyI18n();
                I18n.applyLangToggleUI();
                I18n.onLanguageChange(() => I18n.applyLangToggleUI());
            } catch (e) {
                console.warn('[workbench:settings] i18n init error', e);
            }
        }
    }

    async function initDevMode() {
        try {
            const devOn = Store ? await Store.getDevMode() : false;
            if ($('devToggle')) $('devToggle').checked = devOn;
            document.body.classList.toggle('dev-mode', devOn);
            const labelDev = $('labelDevMode');
            if (labelDev) {
                labelDev.style.color = devOn ? 'var(--accent2, #06b6d4)' : 'var(--muted, #8a92b2)';
            }
        } catch (e) {
            if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:optionsSettings]', e);
        }
    }

    function checkOnboardingTour() {
        try {
            if (typeof window === 'undefined') return;
            const urlParams = new URLSearchParams(window.location.search);
            const isWelcome = urlParams.get('welcome') === '1' || urlParams.get('onboarding') === '1' || urlParams.get('tour') === '1';
            const isExplicitTour = urlParams.get('tour') === '1';

            if (isWelcome) {
                setTimeout(async () => {
                    const tourDone = (Storage && Storage.isTourCompleted)
                        ? await Storage.isTourCompleted()
                        : false;
                    if (!tourDone || isExplicitTour) {
                        if (Tour && Tour.startTour) {
                            Tour.startTour(0);
                        }
                    }
                }, 400);
            }
        } catch (e) {
            if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:optionsSettings]', e);
        }
    }

    async function init({ loadStore, log: logFn, clearLog, renderLog, updateZipUi, checkExportSession, updateAccountSlotSelector, getSearchFilter } = {}) {
        __loadStore = loadStore || null;
        __log = logFn || null;
        __clearLog = clearLog || null;
        __renderLog = renderLog || null;
        __updateZipUi = updateZipUi || null;
        __checkExportSession = checkExportSession || null;
        __updateAccountSlotSelector = updateAccountSlotSelector || null;
        if (getSearchFilter) __getSearchFilter = getSearchFilter;

        await initLanguage();
        await initDevMode();
        bindLanguageControls();
        bindDevControls();
        bindLogControls();
        bindStorageCleanup();
    }

    return {
        init,
        handleLangChange,
        handleDevChange,
        exportDiagnostics,
        checkOnboardingTour
    };
}));
