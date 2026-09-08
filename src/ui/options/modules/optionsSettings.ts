// src/ui/options/modules/optionsSettings.ts - Language, dev mode, diagnostics, and storage cleanup
import type { OptionsSettingsOptions } from '../../../types/ui.js';
import { ConversationsStore as DefaultConversationsStore } from '../../state/conversationsStore.js';
import { ListView as DefaultListView } from '../../views/listView.js';
import { TourGuide as DefaultTourGuide } from '../../tour/tourGuide.js';

function $(id: string): HTMLElement | null {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

const t = (key: string, ...args: any[]): string => {
    if (typeof I18n !== 'undefined' && I18n.t) {
        return I18n.t(key, ...args);
    }
    return key;
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

const getFormats = () => {
    if (typeof FormatStore !== 'undefined') return FormatStore;
    if (typeof globalThis !== 'undefined' && (globalThis as any).FormatStore) return (globalThis as any).FormatStore;
    return null;
};

const getStorage = () => {
    if (typeof StorageService !== 'undefined') return StorageService;
    if (typeof globalThis !== 'undefined' && (globalThis as any).StorageService) return (globalThis as any).StorageService;
    return null;
};

const getTour = () => {
    if (typeof DefaultTourGuide !== 'undefined' && DefaultTourGuide) return DefaultTourGuide;
    if (typeof TourGuide !== 'undefined') return TourGuide;
    return null;
};

export const normId = (id?: string | null): string => {
    if (typeof GeminiUtils !== 'undefined' && typeof GeminiUtils.normId === 'function') return GeminiUtils.normId(id);
    return String(id || '').replace(/^c_/, '');
};

export const cleanTitle = (tStr?: string | null): string => {
    if (typeof GeminiUtils !== 'undefined' && typeof GeminiUtils.cleanTitle === 'function') return GeminiUtils.cleanTitle(tStr);
    return (tStr || '').trim();
};

export const resolveTitle = (chat: any): { title: string; source: string } => {
    if (typeof GeminiUtils !== 'undefined' && typeof GeminiUtils.resolveTitle === 'function') return GeminiUtils.resolveTitle(chat);
    return { title: cleanTitle(chat?.title) || '未命名对话', source: chat?.titleSource || 'legacy' };
};

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

    if (typeof I18n !== 'undefined' && I18n.setLang) {
        await I18n.setLang(targetLang);
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

    if (List && typeof List.setOnDelete === 'function') {
        List.setOnDelete(async (chatId: string) => {
            if (!chatId) return;
            const convs = Store ? Store.getConversations() : [];
            const targetChat = convs.find(c => normId(c.id) === normId(chatId));
            const chatTitle = targetChat ? (resolveTitle(targetChat).title || chatId) : chatId;
            const confirmMsg = typeof t === 'function'
                ? t('confirmDeleteChat', chatTitle)
                : `确定从本地列表中移除会话 "${chatTitle}" 吗？`;
            if (confirm(confirmMsg)) {
                if (Store) await Store.removeConversation(chatId);
                log(typeof t === 'function' ? t('logChatRemoved', chatTitle) : `[${chatTitle}] 已从本地列表移除`, 'info');
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
        if (typeof I18n !== 'undefined') {
            if (I18n.initLanguage) await I18n.initLanguage();
            if (I18n.applyI18n) I18n.applyI18n();
            if (I18n.applyLangToggleUI) I18n.applyLangToggleUI();
            if (I18n.onLanguageChange) I18n.onLanguageChange(() => {
                if (I18n.applyLangToggleUI) I18n.applyLangToggleUI();
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

export function checkOnboardingTour(): void {
    try {
        if (typeof window === 'undefined') return;
        const urlParams = new URLSearchParams(window.location.search);
        const isWelcome = urlParams.get('welcome') === '1' || urlParams.get('onboarding') === '1' || urlParams.get('tour') === '1';
        const isExplicitTour = urlParams.get('tour') === '1';

        if (isWelcome) {
            setTimeout(async () => {
                const Storage = getStorage();
                const Tour = getTour();
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
}

export const OptionsSettings = {
    init,
    handleLangChange,
    handleDevChange,
    exportDiagnostics,
    checkOnboardingTour
};

if (typeof module === 'object' && module.exports) {
    module.exports = OptionsSettings;
}
if (typeof globalThis !== 'undefined') {
    (globalThis as any).OptionsSettings = OptionsSettings;
}
