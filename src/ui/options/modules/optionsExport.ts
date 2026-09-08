// src/ui/options/modules/optionsExport.ts - Export interaction & pipeline runner
import type { OptionsExportOptions } from '../../../types/ui.js';
import { ConversationsStore as DefaultConversationsStore } from '../../state/conversationsStore.js';
import { ListView as DefaultListView } from '../../views/listView.js';
import { ExportController as DefaultExportController } from '../../controllers/exportController.js';
import { DialogView as DefaultDialogView } from '../../views/dialogView.js';
import { DirHandleController as DefaultDirHandle } from '../../controllers/dirHandleController.js';

function $(id: string): HTMLElement | null {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

const t = (key: string, ...args: any[]): string => {
    if (typeof I18n !== 'undefined' && I18n.t) {
        return I18n.t(key, ...args);
    }
    return key;
};

const getLang = (): string => {
    if (typeof I18n !== 'undefined' && I18n.getLang) {
        return I18n.getLang();
    }
    return 'en';
};

const getStore = () => {
    if (typeof DefaultConversationsStore !== 'undefined' && DefaultConversationsStore) return DefaultConversationsStore;
    if (typeof ConversationsStore !== 'undefined') return ConversationsStore;
    return null;
};

const getList = () => {
    if (typeof DefaultListView !== 'undefined' && DefaultListView) return DefaultListView;
    if (typeof ListView !== 'undefined') return ListView;
    return null;
};

const getController = () => {
    if (typeof DefaultExportController !== 'undefined' && DefaultExportController) return DefaultExportController;
    if (typeof ExportController !== 'undefined') return ExportController;
    return null;
};

const getFormats = () => {
    if (typeof FormatStore !== 'undefined') return FormatStore;
    if (typeof globalThis !== 'undefined' && (globalThis as any).FormatStore) return (globalThis as any).FormatStore;
    return null;
};

const getDialogs = () => {
    if (typeof DefaultDialogView !== 'undefined' && DefaultDialogView) return DefaultDialogView;
    if (typeof DialogView !== 'undefined') return DialogView;
    return null;
};

const getDirHandle = () => {
    if (typeof DefaultDirHandle !== 'undefined' && DefaultDirHandle) return DefaultDirHandle;
    if (typeof DirHandleController !== 'undefined') return DirHandleController;
    return null;
};

export const normId = (id?: string | null): string => {
    if (typeof GeminiUtils !== 'undefined' && typeof GeminiUtils.normId === 'function') return GeminiUtils.normId(id);
    return String(id || '').replace(/^c_/, '');
};

export const isRealTitle = (tStr?: string | null, id?: string | null): boolean => {
    if (typeof GeminiUtils !== 'undefined' && typeof GeminiUtils.isRealTitle === 'function') return GeminiUtils.isRealTitle(tStr as string, id as string);
    return !!(tStr && String(tStr).trim().length > 1);
};

let __loadStore: ((force?: boolean) => Promise<any>) | null = null;
let __log: ((msg: string, level?: 'info' | 'warn' | 'error') => void) | null = null;
let __getSearchFilter: () => string = () => '';

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
    const dirBox = $('dirBox');
    const btnSetDir = $('btnSetDir') as HTMLButtonElement | null;
    if (dirBox) {
        dirBox.style.opacity = isZip ? '0.28' : '1';
        dirBox.style.pointerEvents = isZip ? 'none' : 'auto';
        dirBox.style.filter = isZip ? 'grayscale(0.8)' : 'none';
    }
    if (btnSetDir) {
        btnSetDir.disabled = isZip;
    }
}

export async function startExportPipeline(
    selected: any[],
    format: string,
    skip: boolean,
    includeIndex: boolean,
    includeAssets: boolean,
    includeZip: boolean,
    dirHandle: any
): Promise<void> {
    const Store = getStore();
    const Controller = getController();
    const DirHandle = getDirHandle();
    const List = getList();

    const convs = Store ? Store.getConversations() : [];
    if (!includeZip && !dirHandle) {
        try {
            if (DirHandle) dirHandle = await DirHandle.requestDirHandle();
        } catch (err: any) {
            log(typeof t === 'function' ? t('dirCancelled', err.message) : `未选择导出目录: ${err.message}`, 'warn');
            return;
        }
    }

    const progWrap = $('progWrap');
    const bar = $('bar');
    const progText = $('progText');
    if (progWrap) progWrap.style.display = 'block';
    if (bar) bar.style.width = '2%';
    if (progText) progText.textContent = typeof t === 'function' ? t('startExport') : 'Preparing export...';

    log(typeof t === 'function'
        ? t('exportStartingDetail', selected.length, format.toUpperCase(), includeZip ? 'ZIP' : (typeof t === 'function' ? t('folder') : 'Folder'), includeAssets ? 'ON' : 'OFF')
        : `Starting export: ${selected.length} chats | Format: ${format.toUpperCase()} | Target: ${includeZip ? 'ZIP' : 'Folder'}`);

    if (!Controller) {
        log('ExportController not available', 'error');
        return;
    }

    try {
        const currentSlot = Store ? Store.getCurrentSlot() : 'u0';
        const exportedIds = Store ? Store.getExportedIds() : {};
        const takeoutEngine = (typeof TakeoutEngine !== 'undefined' ? TakeoutEngine : null)
            || (typeof globalThis !== 'undefined' ? (globalThis as any).TakeoutEngine : null);

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
            onProgress: (progress: any, txt: string) => {
                const isEn = typeof getLang === 'function' && getLang() === 'en';
                const formatted = (typeof GeminiUtils !== 'undefined' && typeof GeminiUtils.formatExportProgress === 'function')
                    ? GeminiUtils.formatExportProgress(progress, txt, isEn)
                    : { text: txt || '', pct: typeof progress === 'number' ? progress : (progress?.pct || 0) };

                if (bar && typeof formatted.pct !== 'undefined') {
                    bar.style.width = `${Math.min(Math.max(formatted.pct, 2), 100)}%`;
                }
                if (progText && formatted.text) {
                    progText.textContent = formatted.text;
                }
            },
            onLog: (msg: string, lvl: 'info' | 'warn' | 'error') => log(msg, lvl),
            onTitleUpdated: (chatId: string, newTitle: string, source: string) => {
                const currentConvs = Store ? Store.getConversations() : [];
                const item = currentConvs.find((c: any) => normId(c.id) === normId(chatId));
                if (item && isRealTitle(newTitle, chatId)) {
                    if (typeof GeminiUtils !== 'undefined' && typeof GeminiUtils.setTitleBySource === 'function') {
                        GeminiUtils.setTitleBySource(item, source || 'rpc', newTitle);
                    } else {
                        item.title = newTitle;
                        (item as any).titleSource = source || 'rpc';
                    }
                }
            },
            onItemExported: async (chatId: string, titleOrRecord: any, maybeRecord: any) => {
                const exportRecord = (maybeRecord && typeof maybeRecord === 'object')
                    ? maybeRecord
                    : ((titleOrRecord && typeof titleOrRecord === 'object') ? titleOrRecord : null);
                if (Store && exportRecord) {
                    const cur = Store.getExportedIds();
                    cur[chatId] = exportRecord;
                    cur['c_' + normId(chatId)] = exportRecord;
                    cur[normId(chatId)] = exportRecord;
                    Store.setExportedIds(cur);
                    const cSlot = Store.getCurrentSlot()!;
                    await Store!.saveExportedIds(cSlot, cur);
                    const currentConvs = Store.getConversations();
                    if (List) {
                        if (typeof List.updateItemExportStatus === 'function') {
                            List.updateItemExportStatus(chatId, exportRecord);
                        } else {
                            const currentSelected = List.getSelectedIds() || new Set<string>();
                            List.render(currentConvs, cur, currentSelected, __getSearchFilter());
                        }
                        List.updateStat(currentConvs);
                    }
                }
            }
        });

        if (result && result.aborted) {
            log(typeof t === 'function' ? t('exportAborted') : '导出任务已被用户中止', 'warn');
            if (progText) progText.textContent = typeof t === 'function' ? t('exportAborted') : '导出已终止';
        } else {
            let finishMsg = '';
            const totalExported = selected.length;
            if (typeof t === 'function') {
                const translated = t('exportSuccess', totalExported);
                if (translated && translated !== 'exportSuccess') {
                    finishMsg = translated;
                }
            }
            if (!finishMsg) {
                const isEn = typeof getLang === 'function' && getLang() === 'en';
                finishMsg = isEn
                    ? `Export completed! ${totalExported} conversations exported.`
                    : `导出完成！已导出 ${totalExported} 篇对话。`;
            }
            log(finishMsg, 'info');
            if (bar) bar.style.width = '100%';
            if (progText) progText.textContent = finishMsg;
        }
    } catch (err: any) {
        log(typeof t === 'function' ? t('exportFailed', err.message) : `Export failed: ${err.message}`, 'error');
        if (progText) progText.textContent = `Error: ${err.message}`;
    } finally {
        setTimeout(() => {
            if (progWrap) progWrap.style.display = 'none';
            if (bar) bar.style.width = '0%';
        }, 3000);
        if (__loadStore) await __loadStore(true);
    }
}

export async function exportSelected(overrideFormat: string | null = null): Promise<void> {
    const Store = getStore();
    const List = getList();
    const Formats = getFormats();
    const Dialogs = getDialogs();
    const DirHandle = getDirHandle();

    const convs = Store ? Store.getConversations() : [];
    const selected = List ? List.getSelected(convs) : [];
    if (!selected.length) {
        const noSelMsg = typeof t === 'function' ? t('noSelection') : 'Please select at least one conversation!';
        log(noSelMsg, 'warn');
        const progTextEl = $('progText');
        if (progTextEl) progTextEl.textContent = noSelMsg;
        return;
    }

    const formatSelect = $('format') as HTMLSelectElement | null;
    const format = overrideFormat || (Formats ? Formats.getCurrentFormat(document.body.classList.contains('dev-mode'), formatSelect?.value) : (formatSelect?.value || 'markdown'));
    const skipCheck = $('skipExported') as HTMLInputElement | null;
    const skip = skipCheck ? skipCheck.checked : false;
    const indexCheck = $('includeIndex') as HTMLInputElement | null;
    const includeIndex = indexCheck ? indexCheck.checked : false;
    const assetsCheck = $('includeAssets') as HTMLInputElement | null;
    const includeAssets = assetsCheck ? assetsCheck.checked : true;
    const zipCheck = $('includeZip') as HTMLInputElement | null;
    const includeZip = zipCheck ? zipCheck.checked : true;
    const dirHandle = DirHandle ? DirHandle.getDirHandle() : null;

    const threshold = (typeof GeminiConstants !== 'undefined' && GeminiConstants.DIRECT_WRITE_THRESHOLD) ? GeminiConstants.DIRECT_WRITE_THRESHOLD : 50;
    if (includeZip && !dirHandle && selected.length >= threshold && Dialogs && Dialogs.showDirectWritePrompt) {
        const suppressKey = (typeof GeminiConstants !== 'undefined' && GeminiConstants.STORAGE_KEYS?.SUPPRESS_DIRECT_WRITE_PROMPT) || 'gemini_suppress_direct_write_prompt';
        let isSuppressed = false;
        try {
            const d = await chrome.storage.local.get([suppressKey]);
            isSuppressed = !!d[suppressKey];
        } catch (e) {
            console.warn('[GemExporter:storage] Storage operation failed:', e);
        }

        if (!isSuppressed) {
            try {
                await chrome.storage.local.set({ [suppressKey]: true });
            } catch (e) {
                console.warn('[GemExporter:storage] Storage operation failed:', e);
            }

            Dialogs.showDirectWritePrompt(
                selected.length,
                async () => {
                    try {
                        let newHandle: any = null;
                        if (DirHandle) {
                            newHandle = await DirHandle.requestDirHandle();
                            const dirLabel = $('dirLabel');
                            if (dirLabel) dirLabel.textContent = typeof t === 'function' ? t('dirCurrent', newHandle.name) : `已选目录: ${newHandle.name}`;
                            log(typeof t === 'function' ? t('logFolderSelected', newHandle.name) : `已选择保存目录: ${newHandle.name}`);
                        }
                        const zipCh = $('includeZip') as HTMLInputElement | null;
                        if (zipCh) {
                            zipCh.checked = false;
                            updateZipUi();
                            try {
                                await chrome.storage.local.set({ gemini_export_zip: false });
                            } catch (e) {
                                console.warn('[GemExporter:storage] Storage operation failed:', e);
                            }
                        }
                        await startExportPipeline(selected, format, skip, includeIndex, includeAssets, false, newHandle);
                    } catch (err: any) {
                        log(typeof t === 'function' ? t('dirCancelled', err.message) : `未选择导出目录: ${err.message}`, 'warn');
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

export async function init({ loadStore, log: logFn, getSearchFilter }: OptionsExportOptions = {}): Promise<void> {
    __loadStore = loadStore || null;
    __log = logFn || null;
    if (getSearchFilter) __getSearchFilter = getSearchFilter;

    const Formats = getFormats();
    const DirHandle = getDirHandle();
    const Controller = getController();
    const Dialogs = getDialogs();
    const Store = getStore();
    const List = getList();

    // Export Settings Init (ZIP & Formats)
    const zipCheck = $('includeZip') as HTMLInputElement | null;
    if (Formats && Formats.loadFormat) {
        const { format } = await Formats.loadFormat();
        const fmtSelect = $('format') as HTMLSelectElement | null;
        if (fmtSelect) fmtSelect.value = format;
        fmtSelect?.addEventListener('change', (e: Event) => Formats.saveFormat((e.target as HTMLSelectElement).value));
    }

    if (zipCheck) {
        const d = await chrome.storage.local.get(['gemini_export_zip']);
        if (typeof (d as any).gemini_export_zip !== 'undefined') {
            zipCheck.checked = (d as any).gemini_export_zip as boolean;
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
                if (dirLabel) dirLabel.textContent = typeof t === 'function' ? t('dirCurrent', handle.name) : `已选目录: ${handle.name}`;
                log(typeof t === 'function' ? t('logFolderSelected', handle.name) : `已选择保存目录: ${handle.name}`);
            }
        } catch (err: any) {
            log(typeof t === 'function' ? t('dirCancelled', err.message) : `选择目录失败: ${err.message}`, 'warn');
        }
    });

    // Directory restore on load
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

    // Export Buttons
    $('btnExport')?.addEventListener('click', () => exportSelected());
    $('btnExportJson')?.addEventListener('click', () => exportSelected('json'));
    $('btnCancel')?.addEventListener('click', () => {
        if (Controller) Controller.abort();
        log(typeof t === 'function' ? t('stoppingExport') : '正在终止导出任务...', 'warn');
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

export const OptionsExport = {
    init,
    exportSelected,
    startExportPipeline,
    updateZipUi
};

if (typeof module === 'object' && module.exports) {
    module.exports = OptionsExport;
}
if (typeof globalThis !== 'undefined') {
    (globalThis as any).OptionsExport = OptionsExport;
}
