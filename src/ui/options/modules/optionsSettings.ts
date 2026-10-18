import { getSettings, updateSettings, type ExportFormat } from '../../../core/application/index.js';
import { SETTINGS_KEY } from '../../../core/storage/settingsStore.js';
import type { OptionsSettingsOptions } from '../../../types/ui.js';
import {
    getI18n,
    t,
    getStore,
    getList,
    getStorage,
    getTour,
    getDirHandle as getDirHandleController,
    getProgressView,
    getExportCtrl,
    getLogView
} from '../optionsContext.js';
import { getLatestEligibleFeature } from '../../tour/featureReleases.js';
import { $ } from '../../uiCommon.js';
import { normId } from '../../state/conversationsStore.js';
import { cleanTitle, resolveTitle, getErrorMessage } from '../../../core/utils/utils.js';
import { getExtensionVersion } from '../../../core/utils/constants.js';
import { isLocalDevelopment } from '../../../core/utils/environment.js';
import { buildDiagnosticSnapshot } from '../../../core/diagnostics/diagnosticSnapshot.js';

export { normId, cleanTitle, resolveTitle };
let __log: ((msg: string, level?: 'info' | 'warn' | 'error') => void) | null = null;
let __clearLog: (() => void) | null = null;
let __renderLog: (() => void) | null = null;
let __updateZipUi: (() => void) | null = null;
let __checkExportSession: (() => Promise<void> | void) | null = null;
let __updateAccountSelector: (() => void) | null = null;
let __getSearchFilter: () => string = () => '';
let __getChatFilterType: () => string = () => {
    const sel = $('chatFilterSelect') as HTMLSelectElement | null;
    return (sel && sel.value) ? sel.value.trim() : 'all';
};

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
    document.documentElement.lang = targetLang === 'zh' ? 'zh-CN' : 'en';
    if (i18n && typeof i18n.applyI18n === 'function') {
        i18n.applyI18n();
    }

    const Progress = getProgressView();
    if (Progress && typeof Progress.reset === 'function') {
        Progress.reset();
    }

    if (__updateAccountSelector) __updateAccountSelector();
    const convs = Store ? Store.getConversations() : [];
    const expMap = Store ? Store.getExportedIds() : {};
    if (List) {
        List.render(convs, expMap, currentSelected, __getSearchFilter(), __getChatFilterType());
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

    const Store = getStore();
    if (Store) await Store.setDevMode(devOn);
}

export async function exportDiagnostics(): Promise<void> {
    try {
        const Store = getStore();
        const slot = Store ? Store.getCurrentAccountId() : '';
        const convs = Store ? Store.getConversations() : [];
        const expMap = Store ? Store.getExportedIds() : {};
        const LogView = getLogView();
        const logs = typeof LogView?.getBuffer === 'function' ? LogView.getBuffer() : [];

        const snapshot = await buildDiagnosticSnapshot({
            accountId: slot,
            conversations: convs,
            exportedIds: expMap,
            workbenchLogs: logs
        });

        const jsonStr = JSON.stringify(snapshot, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gemini_diagnostics_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        log(typeof t === 'function' ? t('diagExportSuccess') : '已生成诊断数据文件', 'info');
    } catch (e: unknown) {
        const errMessage = getErrorMessage(e);
        log(typeof t === 'function' ? t('diagExportFailed', errMessage) : ('导出诊断失败: ' + errMessage), 'error');
    }
}

function bindLanguageControls(): void {
    $('langToggle')?.addEventListener('change', (e: Event) => {
        void handleLangChange((e.target as HTMLInputElement).checked ? 'en' : 'zh');
    });
    $('labelLangZh')?.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const toggle = $('langToggle') as HTMLInputElement | null;
        if (toggle) toggle.checked = false;
        void handleLangChange('zh');
    });
    $('labelLangEn')?.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const toggle = $('langToggle') as HTMLInputElement | null;
        if (toggle) toggle.checked = true;
        void handleLangChange('en');
    });
}

function bindDevControls(): void {
    $('devToggle')?.addEventListener('change', (e: Event) => handleDevChange((e.target as HTMLInputElement).checked));
    $('labelDevMode')?.addEventListener('click', () => {
        const dt = $('devToggle') as HTMLInputElement | null;
        if (dt) {
            dt.checked = !dt.checked;
            void handleDevChange(dt.checked);
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

    $('btnClearExported')?.addEventListener('click', async (e?: Event) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        const slot = Store ? Store.getCurrentAccountId() : '';
        if (Store) await Store.clearExported(slot);
        const convs = Store ? Store.getConversations() : [];
        const expMap = Store ? Store.getExportedIds() : {};
        if (List) {
            if (typeof List.setSelectedIds === 'function') List.setSelectedIds(null);
            List.render(convs, expMap, null, __getSearchFilter(), __getChatFilterType());
            List.updateStat(convs);
        }
        log(typeof t === 'function' ? t('confirmClearExported') : '已清空已导出记录', 'info');
    });

    const btnClearAll = $('btnClearAll') as HTMLButtonElement | null;
    let clearAllTimeout: any = null;
    let isConfirmingClear = false;

    const resetClearBtn = () => {
        if (!btnClearAll) return;
        isConfirmingClear = false;
        if (clearAllTimeout) {
            clearTimeout(clearAllTimeout);
            clearAllTimeout = null;
        }
        btnClearAll.textContent = typeof t === 'function' ? t('btnClearAll') : '清空全部';
        btnClearAll.style.background = 'transparent';
        btnClearAll.style.color = '#ff8a8a';
        btnClearAll.style.borderColor = '#5a2a2a';
    };

    btnClearAll?.addEventListener('click', async () => {
        if (!isConfirmingClear) {
            isConfirmingClear = true;
            btnClearAll.textContent = typeof t === 'function' ? (t('confirmClearAllInPlace') || '⚠️ 确认清空? (3s)') : '⚠️ 确认清空? (3s)';
            btnClearAll.style.background = '#dc2626';
            btnClearAll.style.color = '#ffffff';
            btnClearAll.style.borderColor = '#ef4444';
            clearAllTimeout = setTimeout(resetClearBtn, 3500);
            return;
        }

        resetClearBtn();
        const slot = Store ? Store.getCurrentAccountId() : '';
        if (Store) await Store.clearAll(slot);
        const convs = Store ? Store.getConversations() : [];
        const expMap = Store ? Store.getExportedIds() : {};
        if (List) {
            if (typeof List.setSelectedIds === 'function') List.setSelectedIds(null);
            List.render(convs, expMap, null, __getSearchFilter(), __getChatFilterType());
            List.updateStat(convs);
        }
        log(typeof t === 'function' ? t('confirmClearAll') : '本地会话数据已清空');
    });

    document.addEventListener('click', (e) => {
        if (isConfirmingClear && e.target !== btnClearAll) {
            resetClearBtn();
        }
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
        const isDevEnv = isLocalDevelopment();
        const devWrapper = $('devModeWrapper');
        if (!isDevEnv) {
            if (devWrapper) {
                devWrapper.style.setProperty('display', 'none', 'important');
            }
            document.body.classList.remove('dev-mode');
            return;
        }

        if (devWrapper) {
            devWrapper.style.display = 'inline-flex';
        }
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
        if (urlParams.get('notour') === '1') return;

        setTimeout(async () => {
            const Storage = getStorage();
            const Tour = getTour();
            if (!Tour) return;

            const settings = await getSettings();
            const tourDone = settings.tourAutoHandled === true;

            if (isExplicitTour || !tourDone) {
                if (Tour.startTour) void Tour.startTour(0);
                return;
            }

            const currentAppVersion = getExtensionVersion();
            const lastSeenVersion = settings.lastSeenFeatureVersion || '';

            const eligibleFeature = getLatestEligibleFeature(lastSeenVersion, currentAppVersion);
            if (eligibleFeature && Tour.startFeatureSpotlight) {
                void Tour.startFeatureSpotlight(eligibleFeature.stepId, eligibleFeature.version);
            }
        }, 400);
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:optionsSettings]', e);
    }
}

export const checkOnboardingTour = checkWalkthroughOnOpen;

export async function init({
    log: logFn,
    clearLog: clearFn,
    renderLog: renderFn,
    updateZipUi: zipFn,
    checkExportSession: expSessFn,
    updateAccountSelector: slotSelFn,
    getSearchFilter: filterFn,
    getChatFilterType: filterTypeFn
}: OptionsSettingsOptions = {}): Promise<void> {
    __log = logFn || null;
    __clearLog = clearFn || null;
    __renderLog = renderFn || null;
    __updateZipUi = zipFn || null;
    __checkExportSession = expSessFn || null;
    __updateAccountSelector = slotSelFn || null;
    if (filterFn) __getSearchFilter = filterFn;
    if (filterTypeFn) __getChatFilterType = filterTypeFn;

    await initLanguage();
    await initDevMode();
    bindLanguageControls();
    bindDevControls();
    bindLogControls();
    bindStorageCleanup();
    await initLiveSaveSettings();
    if (__updateZipUi) __updateZipUi();
}

export function updateLiveSaveFormatAvailability(): void {
    const format = ($('format') as HTMLSelectElement | null)?.value || 'markdown';
    const toggle = $('liveSaveDiskToggle') as HTMLInputElement | null;
    if (!toggle) return;
    const disabled = format !== 'markdown';
    toggle.disabled = disabled;
    const label = toggle.closest?.('label');
    if (label) {
        label.style.opacity = disabled ? '0.45' : '';
        label.style.cursor = disabled ? 'not-allowed' : 'pointer';
        label.setAttribute('data-i18n-title', disabled ? 'liveSaveMarkdownOnly' : 'liveSaveDiskTip');
        label.title = t(disabled ? 'liveSaveMarkdownOnly' : 'liveSaveDiskTip');
    }
    if (__updateZipUi) __updateZipUi();
}

export async function initLiveSaveSettings(): Promise<void> {
    const toggle = $('liveSaveDiskToggle') as HTMLInputElement | null;
    const label = $('dirLabel');
    const directory = getDirHandleController();
    const settings = await getSettings();
    if (toggle) toggle.checked = settings.enabledDisk;
    const handle = await directory.restoreSavedDirHandle();
    if (label) {
        label.textContent = handle ? t('dirCurrent', handle.name) : t('dirNotFound');
        if (directory.getPendingPermissionHandle?.()) {
            label.textContent = t('dirPromptNeeded', directory.getPendingPermissionHandle?.()!.name);
            label.onclick = async () => {
                if (await directory.reauthorizeDirHandle?.()) {
                    label.textContent = t('dirCurrent', directory.getDirHandle()!.name);
                    label.onclick = null;
                }
            };
        }
    }
    updateLiveSaveFormatAvailability();
    $('format')?.addEventListener('change', updateLiveSaveFormatAvailability);
    toggle?.addEventListener('change', async () => {
        // This preference records user intent, even when format/permission pauses execution.
        await updateSettings({ enabledDisk: toggle.checked });
        if (toggle.checked && !directory.getDirHandle()) {
            try {
                const chosen = await directory.requestDirHandle();
                if (label) label.textContent = t('dirCurrent', chosen.name);
            } catch (error) { log(getErrorMessage(error), 'warn'); }
        }
        if (__updateZipUi) __updateZipUi();
    });
    chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== 'local' || !changes[SETTINGS_KEY]) return;
        void getSettings().then(next => {
            if (toggle) toggle.checked = next.enabledDisk;
            const format = $('format') as HTMLSelectElement | null;
            if (format) format.value = next.defaultFormat;
            for (const [id, field] of [['includeZip', 'useZip'], ['includeAssets', 'includeAssets'], ['skipExported', 'skipExported']] as const) {
                const control = $(id) as HTMLInputElement | null;
                if (control) control.checked = next[field];
            }
            const i18n = getI18n();
            if (next.language && i18n.getLang() !== next.language) {
                void i18n.initLanguage().then(() => { i18n.applyI18n?.(); i18n.applyLangToggleUI?.(); });
            }
            updateLiveSaveFormatAvailability();
        });
    });
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



export default OptionsSettings;
