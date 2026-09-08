// src/ui/options/modules/optionsExport.js - Export interaction & pipeline runner
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.OptionsExport = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function $(id) {
        return typeof document !== 'undefined' ? document.getElementById(id) : null;
    }

    const Store = (typeof ConversationsStore !== 'undefined') ? ConversationsStore : null;
    const List = (typeof ListView !== 'undefined') ? ListView : null;
    const Controller = (typeof ExportController !== 'undefined') ? ExportController : null;
    const Formats = (typeof FormatStore !== 'undefined') ? FormatStore : null;
    const Dialogs = (typeof DialogView !== 'undefined') ? DialogView : null;
    const DirHandle = (typeof DirHandleController !== 'undefined') ? DirHandleController : null;
    const Utils = (typeof GeminiUtils !== 'undefined') ? GeminiUtils : {};

    const normId = id => (Utils.normId ? Utils.normId(id) : String(id || '').replace(/^c_/, ''));
    const isRealTitle = (t, id) => (Utils.isRealTitle ? Utils.isRealTitle(t, id) : !!(t && String(t).trim().length > 1));

    let __loadStore = null;
    let __log = null;
    let __getSearchFilter = () => '';

    function log(msg, level = 'info') {
        if (__log) __log(msg, level);
        else console.log(`[EXPORT ${level}]`, msg);
    }

    function updateZipUi() {
        const zipCheck = $('includeZip');
        if (!zipCheck) return;
        const isZip = zipCheck.checked;
        const btnExport = $('btnExport');
        if (btnExport) {
            btnExport.textContent = isZip
                ? (typeof I18n !== 'undefined' ? I18n.t('btnExportZip') : '导出选中 → ZIP')
                : (typeof I18n !== 'undefined' ? I18n.t('btnExportFolder') : '导出选中 → 文件夹');
        }
        const dirBox = $('dirBox');
        const btnSetDir = $('btnSetDir');
        if (dirBox) {
            dirBox.style.opacity = isZip ? '0.28' : '1';
            dirBox.style.pointerEvents = isZip ? 'none' : 'auto';
            dirBox.style.filter = isZip ? 'grayscale(0.8)' : 'none';
        }
        if (btnSetDir) {
            btnSetDir.disabled = isZip;
        }
    }

    async function startExportPipeline(selected, format, skip, includeIndex, includeAssets, includeZip, dirHandle) {
        const convs = Store ? Store.getConversations() : [];
        if (!includeZip && !dirHandle) {
            try {
                if (DirHandle) dirHandle = await DirHandle.requestDirHandle();
            } catch (err) {
                log(typeof I18n !== 'undefined' ? I18n.t('dirCancelled', err.message) : `未选择导出目录: ${err.message}`, 'warn');
                return;
            }
        }

        const progWrap = $('progWrap');
        const bar = $('bar');
        const progText = $('progText');
        if (progWrap) progWrap.style.display = 'block';
        if (bar) bar.style.width = '2%';
        if (progText) progText.textContent = typeof I18n !== 'undefined' ? I18n.t('startExport') : 'Preparing export...';

        log(typeof I18n !== 'undefined'
            ? I18n.t('exportStartingDetail', selected.length, format.toUpperCase(), includeZip ? 'ZIP' : (typeof I18n !== 'undefined' ? I18n.t('folder') : 'Folder'), includeAssets ? 'ON' : 'OFF')
            : `Starting export: ${selected.length} chats | Format: ${format.toUpperCase()} | Target: ${includeZip ? 'ZIP' : 'Folder'}`);

        if (!Controller) {
            log('ExportController not available', 'error');
            return;
        }

        try {
            const currentSlot = Store ? Store.getCurrentSlot() : 'u0';
            const exportedIds = Store ? Store.getExportedIds() : {};
            const takeoutEngine = typeof TakeoutEngine !== 'undefined' ? TakeoutEngine : null;

            const result = await Controller.runExport({
                selected,
                format,
                skip,
                includeIndex,
                includeAssets,
                useZip: includeZip,
                dirHandle: DirHandle ? DirHandle.getDirHandle() : null,
                currentSlot,
                conversations: convs,
                exportedIds,
                takeoutEngine
            }, {
                onProgress: (progress, txt) => {
                    const isEn = typeof I18n !== 'undefined' && I18n.getLang && I18n.getLang() === 'en';
                    const formatted = (typeof GeminiUtils !== 'undefined' && GeminiUtils.formatExportProgress)
                        ? GeminiUtils.formatExportProgress(progress, txt, isEn)
                        : { text: txt || '', pct: typeof progress === 'number' ? progress : (progress?.pct || 0) };

                    if (bar && typeof formatted.pct !== 'undefined') {
                        bar.style.width = `${Math.min(Math.max(formatted.pct, 2), 100)}%`;
                    }
                    if (progText && formatted.text) {
                        progText.textContent = formatted.text;
                    }
                },
                onLog: (msg, level) => log(msg, level),
                onTitleUpdated: (chatId, newTitle, source) => {
                    const currentConvs = Store ? Store.getConversations() : [];
                    const item = currentConvs.find(c => normId(c.id) === normId(chatId));
                    if (item && isRealTitle(newTitle, chatId)) {
                        if (typeof GeminiUtils !== 'undefined' && GeminiUtils.setTitleBySource) {
                            GeminiUtils.setTitleBySource(item, source || 'rpc', newTitle);
                        } else {
                            item.title = newTitle;
                            item.titleSource = source || 'rpc';
                        }
                    }
                },
                onItemExported: async (chatId, titleOrRecord, maybeRecord) => {
                    const exportRecord = (maybeRecord && typeof maybeRecord === 'object') ? maybeRecord : ((titleOrRecord && typeof titleOrRecord === 'object') ? titleOrRecord : null);
                    if (Store && exportRecord) {
                        const cur = Store.getExportedIds();
                        cur[chatId] = exportRecord;
                        cur['c_' + normId(chatId)] = exportRecord;
                        cur[normId(chatId)] = exportRecord;
                        Store.setExportedIds(cur);
                        const cSlot = Store.getCurrentSlot();
                        await Store.saveExportedIds(cSlot, cur);
                        const currentConvs = Store.getConversations();
                        if (List) {
                            if (typeof List.updateItemExportStatus === 'function') {
                                List.updateItemExportStatus(chatId, exportRecord);
                            } else {
                                const currentSelected = List.getSelectedIds() || new Set();
                                List.render(currentConvs, cur, currentSelected, __getSearchFilter());
                            }
                            List.updateStat(currentConvs);
                        }
                    }
                }
            });

            if (result && result.aborted) {
                log(typeof I18n !== 'undefined' ? I18n.t('exportAborted') : '导出任务已被用户中止', 'warn');
                if (progText) progText.textContent = typeof I18n !== 'undefined' ? I18n.t('exportAborted') : '导出已终止';
            } else {
                let finishMsg = '';
                const totalExported = selected.length;
                if (typeof I18n !== 'undefined') {
                    const translated = I18n.t('exportSuccess', totalExported);
                    if (translated && translated !== 'exportSuccess') {
                        finishMsg = translated;
                    }
                }
                if (!finishMsg) {
                    const isEn = typeof I18n !== 'undefined' && I18n.getLang && I18n.getLang() === 'en';
                    finishMsg = isEn
                        ? `Export completed! ${totalExported} conversations exported.`
                        : `导出完成！已导出 ${totalExported} 篇对话。`;
                }
                log(finishMsg, 'info');
                if (bar) bar.style.width = '100%';
                if (progText) progText.textContent = finishMsg;
            }
        } catch (err) {
            log(typeof I18n !== 'undefined' ? I18n.t('exportFailed', err.message) : `Export failed: ${err.message}`, 'error');
            if (progText) progText.textContent = `Error: ${err.message}`;
        } finally {
            setTimeout(() => {
                if (progWrap) progWrap.style.display = 'none';
                if (bar) bar.style.width = '0%';
            }, 3000);
            if (__loadStore) await __loadStore(true);
        }
    }

    async function exportSelected(overrideFormat = null) {
        const convs = Store ? Store.getConversations() : [];
        const selected = List ? List.getSelected(convs) : [];
        if (!selected.length) {
            const noSelMsg = typeof I18n !== 'undefined' ? I18n.t('noSelection') : 'Please select at least one conversation!';
            log(noSelMsg, 'warn');
            if ($('progText')) $('progText').textContent = noSelMsg;
            return;
        }

        const format = overrideFormat || (Formats ? Formats.getCurrentFormat(document.body.classList.contains('dev-mode'), $('format')?.value) : ($('format')?.value || 'markdown'));
        const skip = $('skipExported')?.checked || false;
        const includeIndex = $('includeIndex')?.checked || false;
        const includeAssets = $('includeAssets') ? $('includeAssets').checked : true;
        const includeZip = $('includeZip') ? $('includeZip').checked : true;
        const dirHandle = DirHandle ? DirHandle.getDirHandle() : null;

        const threshold = (typeof GeminiConstants !== 'undefined' && GeminiConstants.DIRECT_WRITE_THRESHOLD) ? GeminiConstants.DIRECT_WRITE_THRESHOLD : 50;
        if (includeZip && !dirHandle && selected.length >= threshold && Dialogs && Dialogs.showDirectWritePrompt) {
            const suppressKey = (typeof GeminiConstants !== 'undefined' && GeminiConstants.STORAGE_KEYS?.SUPPRESS_DIRECT_WRITE_PROMPT) || 'gemini_suppress_direct_write_prompt';
            let isSuppressed = false;
            try {
                const d = await chrome.storage.local.get([suppressKey]);
                isSuppressed = !!d[suppressKey];
            } catch (e) { console.warn('[GemExporter:storage] Storage operation failed:', e); }

            if (!isSuppressed) {
                try { await chrome.storage.local.set({ [suppressKey]: true }); } catch (e) { console.warn('[GemExporter:storage] Storage operation failed:', e); }

                Dialogs.showDirectWritePrompt(
                    selected.length,
                    async () => {
                        try {
                            let newHandle = null;
                            if (DirHandle) {
                                newHandle = await DirHandle.requestDirHandle();
                                const dirLabel = $('dirLabel');
                                if (dirLabel) dirLabel.textContent = typeof I18n !== 'undefined' ? I18n.t('dirCurrent', newHandle.name) : `已选目录: ${newHandle.name}`;
                                log(typeof I18n !== 'undefined' ? I18n.t('logFolderSelected', newHandle.name) : `已选择保存目录: ${newHandle.name}`);
                            }
                            const zipCheck = $('includeZip');
                            if (zipCheck) {
                                zipCheck.checked = false;
                                updateZipUi();
                                try { await chrome.storage.local.set({ gemini_export_zip: false }); } catch (e) { console.warn('[GemExporter:storage] Storage operation failed:', e); }
                            }
                            await startExportPipeline(selected, format, skip, includeIndex, includeAssets, false, newHandle);
                        } catch (err) {
                            log(typeof I18n !== 'undefined' ? I18n.t('dirCancelled', err.message) : `未选择导出目录: ${err.message}`, 'warn');
                        }
                    },
                    async () => {
                        await startExportPipeline(selected, format, skip, includeIndex, includeAssets, true, null);
                    }
                );
                return;
            }
        }

        await startExportPipeline(selected, format, skip, includeIndex, includeAssets, includeZip, dirHandle);
    }

    async function init({ loadStore, log: logFn, getSearchFilter } = {}) {
        __loadStore = loadStore || null;
        __log = logFn || null;
        if (getSearchFilter) __getSearchFilter = getSearchFilter;

        // Export Settings Init (ZIP & Formats)
        const zipCheck = $('includeZip');
        if (Formats && Formats.loadFormat) {
            const { format } = await Formats.loadFormat();
            if ($('format')) $('format').value = format;
            $('format')?.addEventListener('change', e => Formats.saveFormat(e.target.value));
        }

        if (zipCheck) {
            const d = await chrome.storage.local.get(['gemini_export_zip']);
            if (typeof d.gemini_export_zip !== 'undefined') {
                zipCheck.checked = d.gemini_export_zip;
            } else {
                zipCheck.checked = true;
            }
            updateZipUi();
            zipCheck.addEventListener('change', () => {
                updateZipUi();
                chrome.storage.local.set({ gemini_export_zip: zipCheck.checked });
            });
        }

        // Directory selection
        $('btnSetDir')?.addEventListener('click', async () => {
            try {
                if (DirHandle) {
                    const handle = await DirHandle.requestDirHandle();
                    const dirLabel = $('dirLabel');
                    if (dirLabel) dirLabel.textContent = typeof I18n !== 'undefined' ? I18n.t('dirCurrent', handle.name) : `已选目录: ${handle.name}`;
                    log(typeof I18n !== 'undefined' ? I18n.t('logFolderSelected', handle.name) : `已选择保存目录: ${handle.name}`);
                }
            } catch (err) {
                log(typeof I18n !== 'undefined' ? I18n.t('dirCancelled', err.message) : `选择目录失败: ${err.message}`, 'warn');
            }
        });

        // Directory restore on load
        if (DirHandle) {
            try {
                const savedHandle = await DirHandle.restoreSavedDirHandle();
                if (savedHandle) {
                    const dirLabel = $('dirLabel');
                    if (dirLabel) dirLabel.textContent = typeof I18n !== 'undefined' ? I18n.t('dirCurrent', savedHandle.name) : `已选目录: ${savedHandle.name}`;
                    log(typeof I18n !== 'undefined' ? I18n.t('logDirRestored', savedHandle.name) : `已恢复保存的导出目录: ${savedHandle.name}`);
                }
            } catch (e) {
                console.debug('[workbench:export] restoreSavedDirHandle error', e);
            }
        }

        // Export Buttons
        $('btnExport')?.addEventListener('click', () => exportSelected());
        $('btnExportJson')?.addEventListener('click', () => exportSelected('json'));
        $('btnCancel')?.addEventListener('click', () => {
            if (Controller) Controller.abort();
            log(typeof I18n !== 'undefined' ? I18n.t('stoppingExport') : '正在终止导出任务...', 'warn');
        });
        $('btnResumeExport')?.addEventListener('click', () => {
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            if (List) List.selectUnexported(convs, expMap);
            exportSelected();
        });
        $('btnDismissExportBanner')?.addEventListener('click', () => {
            if (Dialogs) Dialogs.dismissExportBanner();
        });
    }

    return {
        init,
        exportSelected,
        startExportPipeline,
        updateZipUi
    };
}));
