import { getSettings, updateSettings, type ExportFormat } from '../../../core/application/index.js';
import type { ExportProgress, FailedChat, UIExportOptions } from '../../../types/ui.js';
import type { OptionsExportOptions } from '../../../types/ui.js';
import {
    t,
    getLang,
    getStore,
    getList,
    getExportCtrl as getController,
    getConstants,
    getDialogs,
    getDirHandle,
    getStorage,
    getUtils
} from '../optionsContext.js';
import { DialogView } from '../../views/dialogView.js';
import { ProgressView } from '../../views/progressView.js';
import { getErrorMessage, isRealTitle } from '../../../core/utils/utils.js';
import { normId } from '../../state/conversationsStore.js';
import { warmLocalFontCache } from '../../../core/export/typst/fonts/localFontProvider.js';
import { $, setExportSessionBusy } from '../../uiCommon.js';

export { normId, isRealTitle };

let __loadStore: OptionsExportOptions['loadStore'] | null = null;
let __log: ((msg: string, level?: 'info' | 'warn' | 'error') => void) | null = null;
let __getSearchFilter: () => string = () => '';
let _isExporting = false;

export function getLastFailedChats(): FailedChat[] {
    const Dialogs = getDialogs();
    return (Dialogs?.getLastFailedChats?.()) ?? DialogView.getLastFailedChats();
}

export function renderExportFailureBanner(failedList: FailedChat[]): void {
    const Dialogs = getDialogs();
    if (typeof Dialogs?.renderExportFailureBanner === 'function') {
        Dialogs.renderExportFailureBanner(failedList, retryFailedExport);
    } else {
        DialogView.renderExportFailureBanner(failedList, retryFailedExport);
    }
}

export function hideExportFailureBanner(): void {
    const Dialogs = getDialogs();
    if (typeof Dialogs?.hideExportFailureBanner === 'function') {
        Dialogs.hideExportFailureBanner();
    } else {
        DialogView.hideExportFailureBanner();
    }
}



export async function retryFailedExport(): Promise<void> {
    const failedList = getLastFailedChats();
    if (!failedList.length) return;
    const List = getList();
    const Store = getStore();
    const failedIds = new Set<string>();
    for (const c of failedList) {
        if (c.id) {
            failedIds.add(c.id);
        }
    }
    if (List && typeof List.selectByIds === 'function') {
        List.selectByIds(failedIds, Store ? Store.getConversations() : undefined);
    }
    hideExportFailureBanner();
    await exportSelected();
}


export function log(msg: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (__log) __log(msg, level);
    else console.log(`[EXPORT ${level}]`, msg);
}

export function updateZipUi(): void {
    const zipCheck = $('includeZip') as HTMLInputElement | null;
    if (!zipCheck) return;
    const isZip = zipCheck.checked;
    const btnExport = $('btnExport');
    if (btnExport) {
        btnExport.textContent = isZip
            ? (typeof t === 'function' ? t('btnExportZip') : '导出选中 → ZIP')
            : (typeof t === 'function' ? t('btnExportFolder') : '导出选中 → 文件夹');
    }
    const liveToggle = $('liveSaveDiskToggle') as HTMLInputElement | null;
    const isLiveDisk = !!liveToggle?.checked;
    const dirBox = $('dirBox');
    const btnSetDir = $('btnSetDir') as HTMLButtonElement | null;
    const disableDir = isZip && !isLiveDisk;
    if (dirBox) {
        dirBox.style.opacity = disableDir ? '0.28' : '1';
        dirBox.style.pointerEvents = disableDir ? 'none' : 'auto';
        dirBox.style.filter = disableDir ? 'grayscale(0.8)' : 'none';
    }
    if (btnSetDir) {
        btnSetDir.disabled = disableDir;
    }
}

/** Refresh visible metadata from the accepted Domain; export callbacks never write it. */
export async function refreshConversationIndex(chatId: string, exportSlot?: string): Promise<void> {
    const Store = getStore();
    const slot = exportSlot || Store?.getCurrentAccountId?.() || '';
    const index = await getStorage().getIndex({ accountId: slot, conversationId: chatId });
    if (Store?.getCurrentAccountId?.() !== slot || !index) return;
    const item = Store.getConversations().find(c => normId(c.key.conversationId) === index.key.conversationId);
    if (item) Object.assign(item, index);
}

export async function startExportPipeline(
    selected: Array<Exclude<UIExportOptions['selected'][number], string>>,
    format: string,
    skip: boolean,
    includeIndex: boolean,
    includeAssets: boolean,
    includeZip: boolean,
    dirHandle: UIExportOptions['dirHandle']
): Promise<void> {
    const Store = getStore();
    const Controller = getController();
    const DirHandle = getDirHandle();
    const List = getList();
    const accountId = Store?.getCurrentAccountId?.() || '';
    if (selected.some(item => item.key && item.key.accountId !== accountId)) return;

    const convs = Store ? Store.getConversations() : [];

    if (includeZip) {
        const estimatedMb = (Controller && typeof Controller.estimateMemoryUsage === 'function')
            ? Controller.estimateMemoryUsage(selected, convs)
            : Math.round((selected.length * 0.05));
        if (estimatedMb >= 300) {
            const warnMsg = typeof t === 'function'
                ? t('exportLargeMemoryWarn', estimatedMb)
                : `当前导出预估包含较多媒体资源 (约 ${estimatedMb}MB)。ZIP 模式将在内存中全量缓冲，若遇到内存限制推荐切换为【文件夹直写】模式以避免内存压力。`;
            log(warnMsg, 'warn');
        }
    }

    if (!includeZip && !dirHandle) {
        try {
            if (DirHandle) {
                dirHandle = await DirHandle.requestDirHandle();
                const dirLabel = $('dirLabel');
                if (dirLabel && dirHandle) dirLabel.textContent = typeof t === 'function' ? t('dirCurrent', dirHandle.name) : `已选目录: ${dirHandle.name}`;
            }
        } catch (err: unknown) {
            const errMsg = getErrorMessage(err);
            log(typeof t === 'function' ? t('dirCancelled', errMsg) : `未选择导出目录: ${errMsg}`, 'warn');
            return;
        }
    }

    if (Store?.getCurrentAccountId() !== accountId) return;
    hideExportFailureBanner();
    ProgressView.show(2, typeof t === 'function' ? t('startExport') : 'Preparing export...');

    log(typeof t === 'function'
        ? t('exportStartingDetail', selected.length, format.toUpperCase(), includeZip ? 'ZIP' : (typeof t === 'function' ? t('folder') : 'Folder'), includeAssets ? 'ON' : 'OFF')
        : `Starting export: ${selected.length} chats | Format: ${format.toUpperCase()} | Target: ${includeZip ? 'ZIP' : 'Folder'}`);

    if (!Controller) {
        log(typeof t === 'function' ? t('exportControllerUnavailable') : 'ExportController not available', 'error');
        return;
    }

    let remainingSelected: Set<string> | null = null;
    try {
        const result = await Controller.runExport({
            selected,
            format,
            skip,
            includeIndex,
            includeAssets,
            useZip: includeZip,
            dirHandle: dirHandle || (DirHandle ? DirHandle.getDirHandle() : null),
            accountId,

        }, {
            onProgress: (progress: ExportProgress, txt?: string) => {
                const isEn = typeof getLang === 'function' && getLang() === 'en';
                const utils = getUtils();
                const formatted = (utils && typeof utils.formatExportProgress === 'function')
                    ? utils.formatExportProgress(progress, txt, isEn)
                    : { text: txt || '', pct: typeof progress === 'number' ? progress : (progress?.pct || 0) };

                const pct = typeof formatted.pct !== 'undefined' ? Math.max(formatted.pct, 2) : 2;
                if (Store?.getCurrentAccountId?.() === accountId) ProgressView.update(pct, formatted.text);
            },

            onLog: (msg: string, lvl?: 'info' | 'warn' | 'error') => {
                if (Store?.getCurrentAccountId?.() === accountId) log(msg, lvl);
            },

        });

        if (Store?.getCurrentAccountId?.() !== accountId) return;
        if (result && result.aborted) {
            log(typeof t === 'function' ? t('exportAborted') : '导出任务已被用户中止', 'warn');
            ProgressView.complete(typeof t === 'function' ? t('exportAborted') : '导出已终止');
        } else {
            const failedList = Array.isArray(result?.failedChats) ? result.failedChats : [];
            const failedCount = failedList.length;
            const failedAttachmentCount = Array.isArray(result?.failedAttachments) ? result.failedAttachments.length : 0;
            const successCount = typeof result?.landedChats === 'number'
                ? result.landedChats
                : (typeof result?.exportedCount === 'number' ? result.exportedCount : Math.max(0, selected.length - failedCount));

            let finishMsg = '';
            if (failedCount > 0 || failedAttachmentCount > 0 || (result.partial || 0) > 0) {
                if (typeof t === 'function') {
                    const translated = t('exportCompletedPartial', Math.max(0, successCount - (result.partial || 0)), failedCount);
                    if (translated && translated !== 'exportCompletedPartial') {
                        finishMsg = translated;
                    }
                }
                if (!finishMsg) {
                    const isEn = typeof getLang === 'function' && getLang() === 'en';
                    finishMsg = isEn
                        ? `Export finished: ${successCount} succeeded, ${failedCount} failed.`
                        : `导出完成：成功 ${successCount} 篇，失败 ${failedCount} 篇。`;
                }
                if (result.partial) finishMsg += ` ${t('exportPartialCount', result.partial)}`;
                if (failedAttachmentCount > 0) finishMsg += ` ${t('exportAttachmentsFailed', failedAttachmentCount)}`;
                log(finishMsg, 'warn');
                renderExportFailureBanner(failedList);
            } else if (successCount === 0 && (result?.skipped || 0) > 0) {
                const skippedCount = result.skipped;
                if (typeof t === 'function') {
                    const translated = t('exportSkippedAll', skippedCount);
                    if (translated && translated !== 'exportSkippedAll') {
                        finishMsg = translated;
                    }
                }
                if (!finishMsg) {
                    const isEn = typeof getLang === 'function' && getLang() === 'en';
                    finishMsg = isEn
                        ? `Export completed: All ${skippedCount} selected conversations skipped (already exported and up-to-date).`
                        : `导出完成：所选 ${skippedCount} 篇对话均已导出且无更新，已全部跳过。`;
                }
                log(finishMsg, 'info');
                hideExportFailureBanner();
            } else {
                const skippedCount = result?.skipped || 0;
                if (skippedCount > 0 && typeof t === 'function') {
                    const translated = t('exportSuccessWithSkipped', successCount, skippedCount);
                    if (translated && translated !== 'exportSuccessWithSkipped') {
                        finishMsg = translated;
                    }
                }
                if (!finishMsg) {
                    const isEn = typeof getLang === 'function' && getLang() === 'en';
                    if (skippedCount > 0) {
                        finishMsg = isEn
                            ? `Export completed! ${successCount} conversations exported, ${skippedCount} skipped.`
                            : `导出完成！已导出 ${successCount} 篇对话，跳过 ${skippedCount} 篇已导出对话。`;
                    } else if (typeof t === 'function') {
                        const translated = t('exportSuccess', successCount);
                        if (translated && translated !== 'exportSuccess') {
                            finishMsg = translated;
                        }
                    }
                }
                if (!finishMsg) {
                    const isEn = typeof getLang === 'function' && getLang() === 'en';
                    finishMsg = isEn
                        ? `Export completed! ${successCount} conversations exported.`
                        : `导出完成！已导出 ${successCount} 篇对话。`;
                }
                log(finishMsg, 'info');
                hideExportFailureBanner();
            }
            ProgressView.complete(finishMsg);

            // Compute updated selection: deselect ONLY successfully exported conversations
            const currentRecords = await getStorage().listExportRecords(accountId);
            if (Store.getCurrentAccountId() !== accountId) return;
            const failedSet = new Set(failedList.map((f: any) => normId(typeof f === 'string' ? f : (f?.id || f?.chatId))));
            remainingSelected = List ? List.getSelectedIds() : new Set<string>();
            for (const chat of selected) {
                const nid = normId(chat.id);
                if (!failedSet.has(nid) && currentRecords[nid]?.status !== 'partial') {
                    remainingSelected.delete(chat.id);
                    remainingSelected.delete(nid);
                }
            }
            if (List && typeof List.setSelectedIds === 'function') {
                List.setSelectedIds(remainingSelected);
            }
        }
    } catch (err: unknown) {
        const errMsg = getErrorMessage(err);
        if (Store?.getCurrentAccountId?.() === accountId) {
            log(typeof t === 'function' ? t('exportFailed', errMsg) : `Export failed: ${errMsg}`, 'error');
            ProgressView.complete(typeof t === 'function' ? t('exportFailedWithMessage', errMsg) : `Error: ${errMsg}`);
        }
    } finally {
        if (Store?.getCurrentAccountId?.() === accountId) {
            ProgressView.hide(3000);
            if (__loadStore) await __loadStore(true, remainingSelected || undefined);
        }
    }
}

export async function exportSelected(overrideFormat: string | null = null, forceLocalCopies = false): Promise<void> {
    if (_isExporting) return;
    _isExporting = true;
    try {
        setExportSessionBusy(true);
        const Store = getStore();
        const List = getList();
        const Dialogs = getDialogs();
        const DirHandle = getDirHandle();

    const capturedAccountId = Store?.getCurrentAccountId() || '';
    const convs = Store ? Store.getConversations() : [];
    const selected = List ? List.getSelected(convs) : [];
    if (!selected.length) {
        const noSelMsg = typeof t === 'function' ? t('noSelection') : 'Please select at least one conversation!';
        log(noSelMsg, 'warn');
        ProgressView.update(0, noSelMsg);
        return;
    }


    const formatSelect = $('format') as HTMLSelectElement | null;
    const format = overrideFormat || formatSelect?.value || (await getSettings()).defaultFormat;
    const skipCheck = $('skipExported') as HTMLInputElement | null;
    const skip = forceLocalCopies ? false : (skipCheck ? skipCheck.checked : false);
    const includeIndex = false;
    const assetsCheck = $('includeAssets') as HTMLInputElement | null;
    const includeAssets = assetsCheck ? assetsCheck.checked : true;
    const zipCheck = $('includeZip') as HTMLInputElement | null;
    const includeZip = zipCheck ? zipCheck.checked : true;
    const dirHandle = DirHandle ? DirHandle.getDirHandle() : null;

    const constants = getConstants();
    const threshold = (constants && constants.DIRECT_WRITE_THRESHOLD) ? constants.DIRECT_WRITE_THRESHOLD : 20;
    if (includeZip && !dirHandle && selected.length > threshold && Dialogs && Dialogs.showDirectWritePrompt) {
        const Storage = getStorage();
        const isSuppressed = (await getSettings()).directWritePromptShown;

        if (!isSuppressed && Store.getCurrentAccountId() === capturedAccountId) {
            // Hold the export mutex until the user actually decides.
            // showDirectWritePrompt is fire-and-forget (returns void) and its
            // Escape / X-close paths invoke NEITHER callback, so wrap both
            // callbacks in a decision promise and also settle when the modal
            // is hidden without a decision — otherwise _isExporting could be
            // released while the dialog is still open, or locked forever.
            // Guard with a synchronously-set decisionMade flag: the observer
            // only settles on Esc/X closes (no decision made).
            let decisionMade = false;
            let resolveDecision: (() => void) | null = null;
            const decisionPromise = new Promise<void>((resolve) => { resolveDecision = resolve; });
            const settleDecision = () => {
                if (resolveDecision) {
                    const r = resolveDecision;
                    resolveDecision = null;
                    r();
                }
            };
            let modalObserver: MutationObserver | null = null;
            let modalEl: HTMLElement | null = null;
            try {
                modalEl = typeof document !== 'undefined' ? document.getElementById('directWriteModal') : null;
                if (modalEl && typeof MutationObserver !== 'undefined') {
                    modalObserver = new MutationObserver(() => {
                        if (modalEl && modalEl.style.display === 'none' && !decisionMade) settleDecision();
                    });
                    modalObserver.observe(modalEl, { attributes: true, attributeFilter: ['style'] });
                }
            } catch (e) {
                console.warn('[GemExporter:storage] Storage operation failed:', e);
            }

            try {
                Dialogs.showDirectWritePrompt(
                    selected.length,
                    async () => {
                        decisionMade = true;
                        try {
                            if (Store.getCurrentAccountId() !== capturedAccountId) return;
                            let newHandle: UIExportOptions['dirHandle'] = null;
                            if (DirHandle) {
                                newHandle = await DirHandle.requestDirHandle();
                                const dirLabel = $('dirLabel');
                                if (dirLabel) dirLabel.textContent = typeof t === 'function' ? t('dirCurrent', newHandle.name) : `已选目录: ${newHandle.name}`;
                                log(typeof t === 'function' ? t('logFolderSelected', newHandle.name) : `已选择保存目录: ${newHandle.name}`);
                            }
                            await startExportPipeline(selected.map(item => ({ ...item, id: item.key.conversationId })), format, skip, includeIndex, includeAssets, false, newHandle);
                        } catch (err: unknown) {
                            const errMsg = getErrorMessage(err);
                            log(typeof t === 'function' ? t('dirCancelled', errMsg) : `未选择导出目录: ${errMsg}`, 'warn');
                        } finally {
                            settleDecision();
                        }
                    },
                    async () => {
                        decisionMade = true;
                        try {
                            if (Store.getCurrentAccountId() !== capturedAccountId) return;
                            await startExportPipeline(selected.map(item => ({ ...item, id: item.key.conversationId })), format, skip, includeIndex, includeAssets, true, null);
                        } catch (err: unknown) {
                            const errMsg = getErrorMessage(err);
                            log(typeof t === 'function' ? t('exportFailed', errMsg) : `导出失败: ${errMsg}`, 'error');
                        } finally {
                            settleDecision();
                        }
                    }
                );
            } catch (promptErr) {
                settleDecision();
                throw promptErr;
            }
            const shown = !!modalEl && modalEl.style.display === 'flex';
            if (shown) await updateSettings({ directWritePromptShown: true });
            // If the prompt never actually showed (missing modal / early
            // return), don't wait forever.
            if (!shown) settleDecision();
            try {
                await decisionPromise;
            } finally {
                if (modalObserver) modalObserver.disconnect();
            }
            if (shown) return;
        }
    }

    if (Store.getCurrentAccountId() !== capturedAccountId) return;
    await startExportPipeline(selected.map(item => ({ ...item, id: item.key.conversationId })), format, skip, includeIndex, includeAssets, includeZip, dirHandle);
    } finally {
        _isExporting = false;
        setExportSessionBusy(false);
    }
}

export async function init({ loadStore, log: logFn, getSearchFilter }: OptionsExportOptions = {}): Promise<void> {
    __loadStore = loadStore || null;
    __log = logFn || null;
    if (getSearchFilter) __getSearchFilter = getSearchFilter;

    const DirHandle = getDirHandle();
    const Controller = getController();
    const Dialogs = getDialogs();
    const Store = getStore();
    const List = getList();
    const settings = await getSettings();
    const formatSelect = $('format') as HTMLSelectElement | null;
    if (formatSelect) {
        formatSelect.value = settings.defaultFormat;
        formatSelect.addEventListener('change', () => {
            void updateSettings({ defaultFormat: formatSelect.value as ExportFormat });
        });
    }
    for (const [id, field] of [['includeZip', 'useZip'], ['includeAssets', 'includeAssets'], ['skipExported', 'skipExported']] as const) {
        const control = $(id) as HTMLInputElement | null;
        if (!control) continue;
        control.checked = settings[field];
        control.addEventListener('change', () => {
            void updateSettings({ [field]: control.checked });
            updateZipUi();
        });
    }
    updateZipUi();

    $('btnSetDir')?.addEventListener('click', async () => {
        try {
            if (DirHandle) {
                const handle = await DirHandle.requestDirHandle();
                const dirLabel = $('dirLabel');
                if (dirLabel) dirLabel.textContent = typeof t === 'function' ? t('dirCurrent', handle.name) : `已选目录: ${handle.name}`;
                log(typeof t === 'function' ? t('logFolderSelected', handle.name) : `已选择保存目录: ${handle.name}`);
            }
        } catch (err: unknown) {
            const errMsg = getErrorMessage(err);
            log(typeof t === 'function' ? t('dirCancelled', errMsg) : `选择目录失败: ${errMsg}`, 'warn');
        }
    });

    if (DirHandle) {
        try {
            const savedHandle = await DirHandle.restoreSavedDirHandle();
            if (savedHandle) {
                const dirLabel = $('dirLabel');
                if (dirLabel) dirLabel.textContent = typeof t === 'function' ? t('dirCurrent', savedHandle.name) : `已选目录: ${savedHandle.name}`;
                log(typeof t === 'function' ? t('logDirRestored', savedHandle.name) : `已恢复保存的导出目录: ${savedHandle.name}`);
            }
        } catch (e) {
            console.debug('[workbench:export] restoreSavedDirHandle error', e);
        }
    }

    $('btnExport')?.addEventListener('click', async () => {
        const fmtSelect = $('format') as HTMLSelectElement | null;
        if (fmtSelect?.value === 'pdf') {
            await warmLocalFontCache();
        }
        await exportSelected();
    });
    $('btnExportJson')?.addEventListener('click', () => exportSelected('json'));
    $('btnCancel')?.addEventListener('click', () => {
        if (Controller) Controller.abort();
        log(typeof t === 'function' ? t('stoppingExport') : '正在终止导出任务...', 'warn');
    });
    $('btnResumeExport')?.addEventListener('click', () => {
        const convs = Store ? Store.getConversations() : [];
        const expMap = Store ? Store.getExportedIds() : {};
        if (List) List.selectUnexported(convs, expMap);
        void exportSelected();
    });
    $('btnDismissExportBanner')?.addEventListener('click', () => {
        if (Dialogs) Dialogs.dismissExportBanner();
    });
}

export const OptionsExport = {
    init,
    exportSelected,
    startExportPipeline,
    refreshConversationIndex,
    updateZipUi,
    getLastFailedChats,
    renderExportFailureBanner,
    hideExportFailureBanner,
    retryFailedExport
};



export default OptionsExport;
