// src/ui/options/modules/optionsSettings.ts - Language, dev mode, diagnostics, and storage cleanup
import type { OptionsSettingsOptions } from '../../../types/ui.js';
import {
    getI18n,
    t,
    getStore,
    getList,
    getFormats,
    getStorage,
    getTour,
    getUtils,
    getDirHandle as getDirHandleController,
    getLiveStorage,
    getFsWriter,
    getChatFormatter
} from '../optionsContext.js';
import { getLatestEligibleFeature } from '../../tour/featureReleases.js';
import { $ } from '../../uiCommon.js';
import { normId } from '../../../core/utils/pathUtils.js';
import { cleanTitle, resolveTitle } from '../../../core/utils/utils.js';

export { normId, cleanTitle, resolveTitle };

let __loadStore: ((force?: boolean) => Promise<any> | void) | null = null;
let __log: ((msg: string, level?: 'info' | 'warn' | 'error') => void) | null = null;
let __clearLog: (() => void) | null = null;
let __renderLog: (() => void) | null = null;
let __updateZipUi: (() => void) | null = null;
let __checkExportSession: (() => Promise<void> | void) | null = null;
let __updateAccountSlotSelector: (() => void) | null = null;
let __getSearchFilter: () => string = () => '';

export function log(msg: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (__log) __log(msg, level);
    else console.log(`[SETTINGS ${level}]`, msg);
}

export async function handleLangChange(targetLang: 'zh' | 'en'): Promise<void> {
    console.log('[workbench] Switching language to:', targetLang);
    const List = getList();
    const Store = getStore();
    const currentSelected = List ? List.getSelectedIds() : new Set<string>();

    const i18n = getI18n();
    if (i18n && i18n.setLang) {
        await i18n.setLang(targetLang);
    }

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
        syncCountEl.textContent = typeof t === 'function' ? t('syncedBadge', convs.length) : `Synced: ${convs.length}`;
    }
}

export async function handleDevChange(devOn: boolean): Promise<void> {
    console.log('[workbench] Switching dev mode to:', devOn);
    document.body.classList.toggle('dev-mode', devOn);
    const labelDev = $('labelDevMode');
    if (labelDev) {
        labelDev.style.color = devOn ? 'var(--accent2, #06b6d4)' : 'var(--muted, #8a92b2)';
    }
    if (devOn && __renderLog) __renderLog();

    const Formats = getFormats();
    if (Formats && Formats.handleDevToggle) {
        const selectEl = $('format') as HTMLSelectElement | null;
        if (selectEl) {
            const result = Formats.handleDevToggle(devOn, selectEl.value);
            if (result.changed) {
                selectEl.value = result.format;
                await Formats.saveFormat(result.format);
            }
        }
    }
    const Store = getStore();
    if (Store) await Store.setDevMode(devOn);
}

export async function exportDiagnostics(): Promise<void> {
    try {
        const d = await chrome.storage.local.get(['gemini_last_sync_diagnostics']);
        const diag = d.gemini_last_sync_diagnostics;
        if (!diag) {
            const noDataMsg = typeof t === 'function' ? t('noDiagData') : 'No diagnostic data yet.';
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
    } catch (e: any) {
        log('导出诊断失败: ' + e.message, 'error');
    }
}

function bindLanguageControls(): void {
    $('langToggle')?.addEventListener('change', (e: Event) => {
        handleLangChange((e.target as HTMLInputElement).checked ? 'en' : 'zh');
    });
    $('labelLangZh')?.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const toggle = $('langToggle') as HTMLInputElement | null;
        if (toggle) toggle.checked = false;
        handleLangChange('zh');
    });
    $('labelLangEn')?.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const toggle = $('langToggle') as HTMLInputElement | null;
        if (toggle) toggle.checked = true;
        handleLangChange('en');
    });
}

function bindDevControls(): void {
    $('devToggle')?.addEventListener('change', (e: Event) => handleDevChange((e.target as HTMLInputElement).checked));
    $('labelDevMode')?.addEventListener('click', () => {
        const dt = $('devToggle') as HTMLInputElement | null;
        if (dt) {
            dt.checked = !dt.checked;
            handleDevChange(dt.checked);
        }
    });
}

function bindLogControls(): void {
    $('logFilter')?.addEventListener('input', () => { if (__renderLog) __renderLog(); });
    $('logLevel')?.addEventListener('change', () => { if (__renderLog) __renderLog(); });
    $('btnClearLog')?.addEventListener('click', () => { if (__clearLog) __clearLog(); });
    $('btnCopyLog')?.addEventListener('click', async () => {
        const l = $('log');
        const copyBtn = $('btnCopyLog');
        if (l) {
            await navigator.clipboard.writeText(l.textContent || '');
            if (copyBtn) copyBtn.textContent = typeof t === 'function' ? t('copied') : '已复制!';
            setTimeout(() => {
                if (copyBtn) copyBtn.textContent = typeof t === 'function' ? t('btnCopyLog') : '复制';
            }, 1500);
        }
    });
    $('btnExportDiag')?.addEventListener('click', exportDiagnostics);
}

function bindStorageCleanup(): void {
    const List = getList();
    const Store = getStore();

    $('btnClearExported')?.addEventListener('click', async () => {
        const slot = Store ? Store.getCurrentSlot() : 'u0';
        if (Store) await Store.clearExported(slot);
        const convs = Store ? Store.getConversations() : [];
        const expMap = Store ? Store.getExportedIds() : {};
        const currentSelected = new Set(List ? List.getSelected(convs).map((x: any) => x.id) : []);
        if (List) {
            List.render(convs, expMap, currentSelected, __getSearchFilter());
            List.updateStat(convs);
        }
        log(typeof t === 'function' ? t('confirmClearExported') : '已清空已导出记录', 'info');
    });

    $('btnClearAll')?.addEventListener('click', async () => {
        const confirmMsg = typeof t === 'function' ? t('confirmClearAll') : '确定清空本地所有会话数据？';
        if (!confirm(confirmMsg)) return;
        const slot = Store ? Store.getCurrentSlot() : 'u0';
        if (Store) await Store.clearAll(slot);
        const convs = Store ? Store.getConversations() : [];
        const expMap = Store ? Store.getExportedIds() : {};
        if (List) {
            List.render(convs, expMap, null, __getSearchFilter());
            List.updateStat(convs);
        }
        log(typeof t === 'function' ? t('confirmClearAll') : '本地会话数据已清空');
    });
}

async function initLanguage(): Promise<void> {
    try {
        const i18n = getI18n();
        if (i18n) {
            if (i18n.initLanguage) await i18n.initLanguage();
            if (i18n.applyI18n) i18n.applyI18n();
            if (i18n.applyLangToggleUI) i18n.applyLangToggleUI();
            if (i18n.onLanguageChange) i18n.onLanguageChange(() => {
                if (i18n.applyLangToggleUI) i18n.applyLangToggleUI();
            });
        }
    } catch (e) {
        console.warn('[workbench:settings] i18n init error', e);
    }
}

async function initDevMode(): Promise<void> {
    try {
        const Store = getStore();
        const devOn = Store ? await Store.getDevMode() : false;
        const devToggle = $('devToggle') as HTMLInputElement | null;
        if (devToggle) devToggle.checked = devOn;
        document.body.classList.toggle('dev-mode', devOn);
        const labelDev = $('labelDevMode');
        if (labelDev) {
            labelDev.style.color = devOn ? 'var(--accent2, #06b6d4)' : 'var(--muted, #8a92b2)';
        }
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:optionsSettings]', e);
    }
}

export function checkWalkthroughOnOpen(): void {
    try {
        if (typeof window === 'undefined') return;
        const urlParams = new URLSearchParams(window.location.search);
        const isExplicitTour = urlParams.get('tour') === '1';

        setTimeout(async () => {
            const Storage = getStorage();
            const Tour = getTour();
            if (!Tour) return;

            const tourDone = (Storage && Storage.isTourCompleted)
                ? await Storage.isTourCompleted()
                : false;

            // Track A: Explicit request (?tour=1) or new user onboarding (first time, tour not completed)
            if (isExplicitTour || !tourDone) {
                if (Tour.startTour) Tour.startTour(0);
                return;
            }

            // 4. Track B: Returning user major feature spotlight (on normal workbench open)
            const currentAppVersion = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '1.5.0';
            const lastSeenVersion = (Storage && Storage.getLastSeenFeatureVersion)
                ? await Storage.getLastSeenFeatureVersion()
                : '';

            const eligibleFeature = getLatestEligibleFeature(lastSeenVersion, currentAppVersion);
            if (eligibleFeature && Tour.startFeatureSpotlight) {
                Tour.startFeatureSpotlight(eligibleFeature.stepId, eligibleFeature.version);
            }
        }, 400);
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:optionsSettings]', e);
    }
}

export const checkOnboardingTour = checkWalkthroughOnOpen;

export async function init({
    loadStore,
    log: logFn,
    clearLog: clearFn,
    renderLog: renderFn,
    updateZipUi: zipFn,
    checkExportSession: expSessFn,
    updateAccountSlotSelector: slotSelFn,
    getSearchFilter: filterFn
}: OptionsSettingsOptions = {}): Promise<void> {
    __loadStore = loadStore || null;
    __log = logFn || null;
    __clearLog = clearFn || null;
    __renderLog = renderFn || null;
    __updateZipUi = zipFn || null;
    __checkExportSession = expSessFn || null;
    __updateAccountSlotSelector = slotSelFn || null;
    if (filterFn) __getSearchFilter = filterFn;

    await initLanguage();
    await initDevMode();
    bindLanguageControls();
    bindDevControls();
    bindLogControls();
    bindStorageCleanup();
    await initLiveSaveSettings();
    if (__updateZipUi) __updateZipUi();
}

export async function initLiveSaveSettings(): Promise<void> {
    const liveStorage = getLiveStorage();
    if (!liveStorage) return;

    const diskToggle = $('liveSaveDiskToggle') as HTMLInputElement | null;
    const dirLabel = $('dirLabel');
    const statusTag = $('liveSaveStatusTag');
    const DirHandle = getDirHandleController();

    try {
        const cfg = await liveStorage.getLiveConfig();
        if (diskToggle) diskToggle.checked = !!cfg.enabledDisk;

        let savedHandle = DirHandle ? DirHandle.getDirHandle() : null;
        if (!savedHandle && DirHandle && typeof DirHandle.restoreSavedDirHandle === 'function') {
            savedHandle = await DirHandle.restoreSavedDirHandle();
        }
        if (savedHandle && dirLabel) {
            dirLabel.textContent = typeof t === 'function' ? t('dirCurrent', savedHandle.name || cfg.dirName || 'Folder') : `已选目录: ${savedHandle.name || cfg.dirName || 'Folder'}`;
            if (dirLabel.style) dirLabel.style.color = '';
        } else if (cfg.dirError === 'not_found' || (!savedHandle && cfg.dirName)) {
            if (diskToggle) diskToggle.checked = false;
            if (dirLabel) {
                dirLabel.textContent = typeof t === 'function' ? t('dirNotFound') : '所选目录已被删除或失效，请重新选择';
                if (dirLabel.style) dirLabel.style.color = '#f59e0b';
            }
        }

        if (statusTag && cfg.lastSavedAt) {
            const timeStr = new Date(cfg.lastSavedAt).toLocaleTimeString();
            statusTag.textContent = `${t('liveSaveActive')} (${timeStr})`;
        }
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[OptionsSettings] initLiveSaveSettings error:', e);
    }

    if (diskToggle && !diskToggle.dataset.bound) {
        diskToggle.dataset.bound = 'true';
        diskToggle.addEventListener('change', async () => {
            if (diskToggle.checked) {
                let handle = DirHandle ? DirHandle.getDirHandle() : null;
                if (!handle && DirHandle && typeof DirHandle.restoreSavedDirHandle === 'function') {
                    handle = await DirHandle.restoreSavedDirHandle();
                }

                if (!handle) {
                    try {
                        if (DirHandle && typeof DirHandle.requestDirHandle === 'function') {
                            handle = await DirHandle.requestDirHandle();
                        }
                    } catch (err: any) {
                        diskToggle.checked = false;
                        if (err?.name === 'AbortError') {
                            log(typeof t === 'function' ? t('dirCancelled', '用户取消选择') : '未选择导出目录: 用户取消选择', 'warn');
                        } else {
                            log(typeof t === 'function' ? t('dirCancelled', err?.message || '') : `选择目录失败: ${err?.message || ''}`, 'warn');
                        }
                        if (__updateZipUi) __updateZipUi();
                        return;
                    }
                }

                if (handle) {
                    if (dirLabel) {
                        dirLabel.textContent = typeof t === 'function' ? t('dirCurrent', handle.name) : `已选目录: ${handle.name}`;
                        if (dirLabel.style) dirLabel.style.color = '';
                    }
                    await liveStorage.setLiveConfig({ enabledDisk: true, dirName: handle.name, dirError: null });
                    log(typeof t === 'function' ? t('logFolderSelected', handle.name) : `已开启实时落盘: ${handle.name}`);
                } else {
                    diskToggle.checked = false;
                    await liveStorage.setLiveConfig({ enabledDisk: false });
                }
            } else {
                await liveStorage.setLiveConfig({ enabledDisk: false });
                log('[LiveSave] Live disk sync disabled');
            }
            if (__updateZipUi) __updateZipUi();
        });
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged && !(globalThis as any).__liveSaveStorageWatcherBound) {
        (globalThis as any).__liveSaveStorageWatcherBound = true;
        chrome.storage.onChanged.addListener((changes: any, area: string) => {
            if (area === 'local' && changes.live_save_config?.newValue) {
                const val = changes.live_save_config.newValue;
                if (val.dirError === 'not_found') {
                    if (diskToggle) diskToggle.checked = false;
                    if (dirLabel) {
                        dirLabel.textContent = typeof t === 'function' ? t('dirNotFound') : '所选目录已被删除或失效，请重新选择';
                        if (dirLabel.style) dirLabel.style.color = '#f59e0b';
                    }
                    log(typeof t === 'function' ? t('dirNotFound') : '所选目录已被删除或失效，实时落盘已暂停', 'warn');
                } else if (val.lastSavedAt && val.lastSavedTitle) {
                    const statusTagEl = $('liveSaveStatusTag');
                    if (statusTagEl) {
                        const timeStr = new Date(val.lastSavedAt).toLocaleTimeString();
                        statusTagEl.textContent = `${t('liveSaveActive')} (${timeStr})`;
                    }
                    log(`[实时落盘] 自动保存成功: ${val.lastSavedTitle}`);
                }
            }
            if (area === 'local' && (changes.exportedIds || Object.keys(changes).some(k => k.startsWith('gemini_exported_')))) {
                if (typeof (window as any).__workbenchLoadStore === 'function') {
                    (window as any).__workbenchLoadStore();
                }
            }
        });
    }
}

export const OptionsSettings = {
    init,
    initLiveSaveSettings,
    handleLangChange,
    handleDevChange,
    exportDiagnostics,
    checkWalkthroughOnOpen,
    checkOnboardingTour
};

(OptionsSettings as any).OptionsSettings = OptionsSettings;
(OptionsSettings as any).default = OptionsSettings;

if (typeof globalThis !== 'undefined') {
    (globalThis as any).OptionsSettings = OptionsSettings;
}
if (typeof module === 'object' && module.exports) {
    module.exports = OptionsSettings;
}

export default OptionsSettings;
