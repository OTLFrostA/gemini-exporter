// options.js - Gemini Exporter workbench UI coordinator (Layered Architecture)
(function() {
    'use strict';

    function $(id) {
        return document.getElementById(id);
    }

    // Module References (with safe fallbacks)
    const Store = (typeof ConversationsStore !== 'undefined') ? ConversationsStore : null;
    const List = (typeof ListView !== 'undefined') ? ListView : null;
    const Log = (typeof LogView !== 'undefined') ? LogView : null;
    const Controller = (typeof ExportController !== 'undefined') ? ExportController : null;
    const Formats = (typeof FormatStore !== 'undefined') ? FormatStore : null;
    const Storage = (typeof StorageService !== 'undefined') ? StorageService : ((typeof window !== 'undefined' && window.StorageService) || null);
    const Account = (typeof AccountView !== 'undefined') ? AccountView : null;
    const Dialogs = (typeof DialogView !== 'undefined') ? DialogView : null;
    const DirHandle = (typeof DirHandleController !== 'undefined') ? DirHandleController : null;
    const TakeoutCtrl = (typeof TakeoutController !== 'undefined') ? TakeoutController : null;
    const SyncCtrl = (typeof SyncController !== 'undefined') ? SyncController : null;
    const Tour = (typeof TourGuide !== 'undefined') ? TourGuide : null;

    const normId = id => (typeof GeminiUtils !== 'undefined' && GeminiUtils.normId)
        ? GeminiUtils.normId(id)
        : String(id || '').replace(/^c_/, '');

    const cleanTitle = (t) => (typeof GeminiUtils !== 'undefined' && GeminiUtils.cleanTitle)
        ? GeminiUtils.cleanTitle(t)
        : (t || '').trim();

    const isRealTitle = (t, id) => (typeof GeminiUtils !== 'undefined' && GeminiUtils.isRealTitle)
        ? GeminiUtils.isRealTitle(t, id)
        : !!(t && String(t).trim().length > 1);

    const resolveTitle = (chat) => (typeof GeminiUtils !== 'undefined' && GeminiUtils.resolveTitle)
        ? GeminiUtils.resolveTitle(chat)
        : { title: cleanTitle(chat?.title) || '未命名对话', source: chat?.titleSource || 'legacy' };

    let __workbenchDebounceTimer = null;
    let __lastRenderedSignature = '';
    let __lastRenderTime = 0;
    let __chatSearchFilter = '';

    // Logging helpers
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

    // Account slot selector update
    function updateAccountSlotSelector() {
        if (Account && Account.render && Store) {
            Account.render(Store.getAccountSlots(), Store.getCurrentSlot());
        }
    }

    // Store & List Loader
    async function loadStore(force = false) {
        try {
            window.__workbenchLoadStore = loadStore;
            if (!Store) return;
            const slot = Store.getCurrentSlot() || 'u0';
            const { conversations: incoming, exportedIds, accountSlots } = await Store.loadStore(slot);
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

            // Deduplicate and sanitize titles with resolveTitle
            const dedupMap = new Map();
            let hasDirtyTitles = false;
            (incoming || []).forEach(c => {
                if (!c || !c.id) return;
                const nid = normId(c.id);
                const u = (c.url || c.href || '').toString();
                if (/accounts\.google\.com|SignOutOptions/i.test(u)) return;

                const old = dedupMap.get(nid);
                const cleanForBad = t => String(t || '').replace(/[\u200E\u200B\uFEFF\u00A0]/g, '').trim();
                const isBad = t => !t || /^(Google\s+)?(Gemini|Bard|Google\s+AI|Google\s+Account)$/i.test(cleanForBad(t));

                if (!old) {
                    const resolved = resolveTitle(c);
                    if (isBad(c.title) || c.title !== resolved.title) {
                        hasDirtyTitles = true;
                    }
                    dedupMap.set(nid, {
                        ...c,
                        title: resolved.title,
                        titleSource: resolved.source,
                        titles: c.titles || (isRealTitle(c.title, nid) ? { [c.titleSource || 'legacy']: c.title } : {})
                    });
                } else {
                    const mergedTitles = { ...(old.titles || {}), ...(c.titles || {}) };
                    if (isRealTitle(c.title, nid) && c.titleSource) {
                        mergedTitles[c.titleSource] = c.title;
                    }
                    if (isRealTitle(old.title, nid) && old.titleSource) {
                        mergedTitles[old.titleSource] = old.title;
                    }
                    const resolved = resolveTitle({ id: nid, titles: mergedTitles, title: old.title, titleSource: old.titleSource });
                    if (isBad(old.title) || old.title !== resolved.title) {
                        hasDirtyTitles = true;
                    }
                    dedupMap.set(nid, {
                        ...old,
                        ...c,
                        titles: mergedTitles,
                        title: resolved.title,
                        titleSource: resolved.source
                    });
                }
            });

            const processed = Array.from(dedupMap.values());
            if (hasDirtyTitles && Storage) {
                Storage.setConversations(slot, processed).catch(() => {});
            }

            processed.sort((a, b) => {
                let tsA = a.timestamp;
                if (typeof tsA === 'string') tsA = new Date(tsA).getTime();
                let tsB = b.timestamp;
                if (typeof tsB === 'string') tsB = new Date(tsB).getTime();
                let valA = tsA || 0;
                let valB = tsB || 0;
                if (valA !== valB) return valB - valA;
                let lsA = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
                let lsB = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
                return lsB - lsA;
            });

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
            checkExportSession();
        } catch (e) {
            console.error('[workbench] loadStore error', e);
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
            console.debug('[workbench] checkExportSession error', e);
        }
    }

    // Export Action
    async function exportSelected() {
        const convs = Store ? Store.getConversations() : [];
        const selected = List ? List.getSelected(convs) : [];
        if (!selected.length) {
            const noSelMsg = typeof I18n !== 'undefined' ? I18n.t('noSelection') : 'Please select at least one conversation!';
            log(noSelMsg, 'warn');
            if ($('progText')) $('progText').textContent = noSelMsg;
            return;
        }

        const format = Formats ? Formats.getFormatFromSelect($('format')) : ($('format')?.value || 'markdown');
        const skip = $('skipExported')?.checked || false;
        const includeIndex = $('includeIndex')?.checked || false;
        const includeAssets = $('includeAssets') ? $('includeAssets').checked : true;
        const includeZip = $('includeZip') ? $('includeZip').checked : true;
        const dirHandle = DirHandle ? DirHandle.getDirHandle() : null;

        if (!includeZip && !dirHandle) {
            try {
                if (DirHandle) await DirHandle.requestDirHandle();
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
                    const pct = (typeof progress === 'object' && progress !== null) ? progress.pct : progress;
                    const text = (typeof progress === 'object' && progress !== null) ? (progress.title || txt) : txt;
                    if (bar && typeof pct !== 'undefined') bar.style.width = `${pct}%`;
                    if (progText && text) progText.textContent = text;
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
                        const currentSelected = List ? List.getSelectedIds() : new Set();
                        if (List) {
                            List.render(currentConvs, cur, currentSelected, __chatSearchFilter);
                            List.updateStat(currentConvs);
                        }
                    }
                }
            });

            if (result && result.aborted) {
                log(typeof I18n !== 'undefined' ? I18n.t('exportAborted') : '导出任务已被用户中止', 'warn');
                if (progText) progText.textContent = typeof I18n !== 'undefined' ? I18n.t('exportAborted') : '导出已终止';
            } else {
                const finishMsg = typeof I18n !== 'undefined'
                    ? I18n.t('exportSuccess', selected.length)
                    : `Export completed! ${selected.length} conversations exported.`;
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
            await loadStore(true);
        }
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

    // Workbench Initialization
    async function initWorkbench() {
        // 1. App Version & Header
        const verEl = $('ver');
        if (verEl) {
            try {
                verEl.textContent = 'v' + (chrome.runtime.getManifest()?.version || '1.4.1');
            } catch {}
        }

        // 2. Initialize LogView
        if (Log && Log.init) Log.init('log');

        // 3. Language Init
        if (typeof I18n !== 'undefined') {
            try {
                await I18n.initLanguage();
                I18n.applyI18n();
            } catch (e) {
                console.warn('[workbench] i18n init error', e);
            }
        }

        // 4. Dev Mode Init
        try {
            const devOn = Store ? await Store.getDevMode() : false;
            if ($('devToggle')) $('devToggle').checked = devOn;
            document.body.classList.toggle('dev-mode', devOn);
            const labelDev = $('labelDevMode');
            if (labelDev) {
                labelDev.style.color = devOn ? 'var(--accent2, #06b6d4)' : 'var(--muted, #8a92b2)';
            }
        } catch (e) {}

        // 5. Export Settings Init (ZIP & Formats)
        const zipCheck = $('includeZip');
        const updateZipUi = () => {
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
        };

        if (Formats && Formats.loadFormat) {
            await Formats.loadFormat($('format'));
            Formats.bindFormatSelect($('format'));
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

        // 6. Language Switch Handlers
        const handleLangChange = async (targetLang) => {
            console.log('[workbench] Switching language to:', targetLang);
            if (typeof I18n !== 'undefined') {
                const currentSelected = List ? List.getSelectedIds() : new Set();
                await I18n.setLang(targetLang);
                updateAccountSlotSelector();
                const convs = Store ? Store.getConversations() : [];
                const expMap = Store ? Store.getExportedIds() : {};
                if (List) {
                    List.render(convs, expMap, currentSelected, __chatSearchFilter);
                    List.updateStat(convs);
                }
                updateZipUi();
                await checkExportSession();
                const syncCountEl = $('syncCount');
                if (syncCountEl && convs.length) {
                    syncCountEl.textContent = I18n.t('syncedBadge', convs.length);
                }
            }
        };

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

        // 7. Dev Mode Switch Handlers
        const handleDevChange = async (devOn) => {
            console.log('[workbench] Switching dev mode to:', devOn);
            document.body.classList.toggle('dev-mode', devOn);
            const labelDev = $('labelDevMode');
            if (labelDev) {
                labelDev.style.color = devOn ? 'var(--accent2, #06b6d4)' : 'var(--muted, #8a92b2)';
            }
            if (devOn) renderLog();
            if (Formats && Formats.handleDevToggle) {
                await Formats.handleDevToggle(devOn, $('format'));
            }
            if (Store) await Store.setDevMode(devOn);
        };

        $('devToggle')?.addEventListener('change', (e) => handleDevChange(e.target.checked));
        $('labelDevMode')?.addEventListener('click', () => {
            const dt = $('devToggle');
            if (dt) {
                dt.checked = !dt.checked;
                handleDevChange(dt.checked);
            }
        });

        // 8. Account Slot Switch Handler
        $('accountSlotSelect')?.addEventListener('change', async (e) => {
            const newSlot = e.target.value;
            console.log('[workbench] Account slot changed to:', newSlot);
            if (Store) {
                Store.setCurrentSlot(newSlot);
                await loadStore();
            }
        });

        // 9. Search Bar Handler
        ($('chatSearchInput') || $('search'))?.addEventListener('input', (e) => {
            __chatSearchFilter = (e.target.value || '').trim();
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            const currentSelected = List ? List.getSelectedIds() : new Set();
            if (List) List.render(convs, expMap, currentSelected, __chatSearchFilter);
        });

        // 10. List Selection Filter Buttons
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

        // 11. Directory Selection Buttons
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

        // 12. Export Execution & Cancellation
        $('btnExport')?.addEventListener('click', exportSelected);
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

        // 13. Local Takeout Archive Import
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
                        loadStore();
                    },
                    onError: (err, errMsg) => {
                        if (progText) progText.textContent = errMsg;
                        if (progWrap) progWrap.style.display = 'none';
                    }
                });
            }
        });

        // 14. Sync Actions
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
                        loadStore();
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
                    onFinished: ({ message }) => {
                        if (bar) bar.style.width = '100%';
                        if (progText) progText.textContent = message;
                        setTimeout(() => {
                            if (progWrap) progWrap.style.display = 'none';
                            if (bar) bar.style.width = '0%';
                            if (progText) progText.textContent = '';
                        }, 2500);
                        loadStore();
                    },
                    onError: (err, errMsg) => {
                        if (progText) progText.textContent = errMsg;
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

        // 15. Clear Cache
        $('btnClearExported')?.addEventListener('click', async () => {
            const slot = Store ? Store.getCurrentSlot() : 'u0';
            if (Store) await Store.clearExported(slot);
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            const currentSelected = new Set(List ? List.getSelected(convs).map(x => x.id) : []);
            if (List) {
                List.render(convs, expMap, currentSelected, __chatSearchFilter);
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
                List.render(convs, expMap, null, __chatSearchFilter);
                List.updateStat(convs);
            }
            log(typeof I18n !== 'undefined' ? I18n.t('confirmClearAll') : '本地会话数据已清空');
        });

        // 16. Logs & Diagnostics
        $('logFilter')?.addEventListener('input', renderLog);
        $('logLevel')?.addEventListener('change', renderLog);
        $('btnClearLog')?.addEventListener('click', clearLog);
        $('btnCopyLog')?.addEventListener('click', async () => {
            const l = $('log');
            if (l) {
                await navigator.clipboard.writeText(l.textContent);
                $('btnCopyLog').textContent = typeof I18n !== 'undefined' ? I18n.t('copied') : '已复制!';
                setTimeout(() => $('btnCopyLog').textContent = typeof I18n !== 'undefined' ? I18n.t('btnCopyLog') : '复制', 1500);
            }
        });
        $('btnExportDiag')?.addEventListener('click', exportDiagnostics);

        // 17. Broadcast Listener for Progress & Live Updates
        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.action === 'scanProgress') {
                const progWrap = $('progWrap');
                const bar = $('bar');
                const progText = $('progText');
                if (progWrap) progWrap.style.display = 'block';
                let pct = typeof msg.percent === 'number' ? msg.percent : 50;
                if (bar) bar.style.width = Math.min(Math.max(pct, 5), 100) + '%';
                if (progText && msg.title) progText.textContent = msg.title;
                if (msg.title) log(msg.title);
            }
            if (msg.action === 'syncUpdate') {
                loadStore(true);
            }
        });

        // 18. Initial Data & Directory Restore
        if (DirHandle) {
            const savedHandle = await DirHandle.restoreSavedDirHandle();
            if (savedHandle) {
                const dirLabel = $('dirLabel');
                if (dirLabel) dirLabel.textContent = typeof I18n !== 'undefined' ? I18n.t('dirCurrent', savedHandle.name) : `已选目录: ${savedHandle.name}`;
                log(typeof I18n !== 'undefined' ? I18n.t('logDirRestored', savedHandle.name) : `已恢复保存的导出目录: ${savedHandle.name}`);
            }
        }

        // Auto-detect active slot from current Gemini tab if available
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
        } catch {}

        $('btnTourGuide')?.addEventListener('click', () => {
            if (Tour && Tour.startTour) {
                Tour.startTour(0);
            }
        });

        try { window.__workbenchLoadStore = loadStore; } catch {}
        await loadStore();

        // Check for welcome / onboarding tour
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const isWelcome = urlParams.get('welcome') === '1' || urlParams.get('onboarding') === '1';
            const tourCompleted = Storage && Storage.isTourCompleted ? await Storage.isTourCompleted() : false;

            if (isWelcome || !tourCompleted) {
                setTimeout(() => {
                    if (Tour && Tour.startTour) {
                        Tour.startTour(0);
                    }
                }, 500);
            }
        } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWorkbench);
    } else {
        initWorkbench();
    }
})();
