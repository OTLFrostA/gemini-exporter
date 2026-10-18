import { renderArchiveNotice } from './optionsArchive.js';
import type { OptionsInitOptions } from '../../../types/ui.js';
import {
    t,
    getStore,
    getList,
    getLogView as getLog,
    getDialogs,
    getAccountView as getAccount,
    getExportCtrl as getController,
    getTour,
    getStorage
} from '../optionsContext.js';
import { $ } from '../../uiCommon.js';
import { normId } from '../../state/conversationsStore.js';
import {
    cleanTitle,
    isRealTitle,
    getEffectiveTimestamp,
    compareConversations
} from '../../../core/utils/utils.js';

export { normId, cleanTitle, isRealTitle, compareConversations };
export const getEffectiveTime = getEffectiveTimestamp;

let __lastRenderedSignature = '';
let __lastRenderTime = 0;
let __chatSearchFilter = '';
let __chatFilterType = 'all';
let __searchDebounceTimer: any = null;
let __pendingTakeoutChecker: (() => Promise<void> | void) | null = null;

export function getChatFilterType(): string {
    return __chatFilterType;
}

export function setChatFilterType(type: string): void {
    __chatFilterType = type || 'all';
    const sel = $('chatFilterSelect') as HTMLSelectElement | null;
    if (sel) sel.value = __chatFilterType;
}

function getFailedChatIds(): Set<string> {
    const ids = new Set<string>();
    const Dialogs = getDialogs();
    const failedList = (Dialogs?.getLastFailedChats?.()) ?? DialogView.getLastFailedChats();
    if (Array.isArray(failedList)) {
        for (const item of failedList) {
            const id = typeof item === 'string' ? item : (item?.id || item?.chatId);
            if (id) {
                ids.add(id);
                ids.add(normId(id));
            }
        }
    }
    return ids;
}

export function log(msg: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    console.log(`[LOG ${level}]`, msg);
    const Log = getLog();
    if (Log && Log.log) Log.log(msg, level);
}

export function clearLog(): void {
    const Log = getLog();
    if (Log && Log.clear) Log.clear();
}

export function renderLog(): void {
    const Log = getLog();
    if (Log && Log.render) Log.render();
}

export function getSearchFilter(): string {
    return __chatSearchFilter;
}

export function setSearchFilter(filter?: string): void {
    __chatSearchFilter = filter || '';
}

export function updateAccountSelector(): void {
    const Account = getAccount();
    const Store = getStore();
    if (Account && Account.render && Store) {
        Account.render(Store.getAccounts(), Store.getCurrentAccountId());
    }
}

export async function checkExportSession(): Promise<void> {
    // Export is invocation-scoped. Only the current page's failure list may be retried.
    const banner = $('exportSessionBanner');
    if (banner) banner.style.display = 'none';
}

export async function loadStore(force: boolean = false, customSelected?: Set<string>): Promise<void> {
    try {
        const Store = getStore();
        const List = getList();
        const Storage = getStorage();
        if (!Store) return;
        const slot = Store.getCurrentAccountId() || '';
        const hadExistingConvs = Store.getConversations().length > 0;
        const { conversations: incoming, exportedIds } = await Store.loadStore(slot);
        updateAccountSelector();

        const syncInfo = await Store.getLastSync(Store.getCurrentAccountId());
        const lastSyncVal = syncInfo.timestamp;

        const incomingSig = Store.getSignature(incoming);
        const currentList = Store.getConversations();
        const sameSig = (incomingSig === __lastRenderedSignature && incoming.length === currentList.length && currentList.length > 0);

        if (!force && sameSig && Date.now() - __lastRenderTime < 500) {
            const lastSyncElFast = $('lastSync');
            if (lastSyncElFast && lastSyncVal) {
                const syncFmtFast = typeof t === 'function'
                    ? t('lastSync', new Date(lastSyncVal).toLocaleString(), incoming.length)
                    : `Last sync: ${new Date(lastSyncVal).toLocaleString()} | Total: ${incoming.length}`;
                lastSyncElFast.textContent = syncFmtFast;
            }
            return;
        }

        const processed = incoming;

        const lastSyncEl = $('lastSync');
        if (lastSyncEl) {
            if (lastSyncVal) {
                lastSyncEl.textContent = typeof t === 'function'
                    ? t('lastSync', new Date(lastSyncVal).toLocaleString(), processed.length)
                    : `Last sync: ${new Date(lastSyncVal).toLocaleString()} | Total: ${processed.length}`;
            } else {
                lastSyncEl.textContent = processed.length ? (typeof t === 'function' ? t('selectedStat', 0, processed.length) : `${processed.length} total`) : '';
            }
        }

        const syncCountEl = $('syncCount');
        if (syncCountEl && processed.length) {
            syncCountEl.textContent = typeof t === 'function' ? t('syncedBadge', processed.length) : `Synced: ${processed.length}`;
        }

        if (List) {
            let prevSelected: Set<string> | null = null;
            if (customSelected instanceof Set) {
                prevSelected = customSelected;
            } else {
                try {
                    if (!force && hadExistingConvs) {
                        prevSelected = List.getSelectedIds();
                    }
                } catch {
                    prevSelected = null;
                }
            }
            const failedIds = getFailedChatIds();
            List.render(processed, exportedIds, prevSelected, __chatSearchFilter, __chatFilterType, failedIds);
            List.updateStat(processed);
        }

        await renderArchiveNotice(processed, Store.getCurrentAccountId(), () => loadStore(true));
        __lastRenderedSignature = Store.getSignature(processed);
        __lastRenderTime = Date.now();
        await checkExportSession();
        if (__pendingTakeoutChecker) {
            await __pendingTakeoutChecker();
        }
    } catch (e) {
        console.error('[workbench:init] loadStore error', e);
        try {
            const msg = e instanceof Error ? e.message : String(e);
            log(`${typeof t === 'function' ? t('loadStoreFailed', msg) : `加载会话列表失败: ${msg}`}`, 'error');
        } catch { /* log view not ready — console.error above already recorded it */ }
    }
}

function bindSearchAndSelection(): void {
    const searchInput = $('chatSearchInput') as HTMLInputElement | null;
    const filterSelect = $('chatFilterSelect') as HTMLSelectElement | null;

    const doFilter = () => {
        const Store = getStore();
        const List = getList();
        const convs = Store ? Store.getConversations() : [];
        const expMap = Store ? Store.getExportedIds() : {};
        const currentSelected = List ? List.getSelectedIds() : new Set<string>();
        const failedIds = getFailedChatIds();
        if (List) List.render(convs, expMap, currentSelected, __chatSearchFilter, __chatFilterType, failedIds);
    };

    filterSelect?.addEventListener('change', (e: Event) => {
        __chatFilterType = ((e.target as HTMLSelectElement).value || 'all').trim();
        doFilter();
    });

    searchInput?.addEventListener('input', (e: Event) => {
        __chatSearchFilter = ((e.target as HTMLInputElement).value || '').trim();
        const Store = getStore();
        const convs = Store ? Store.getConversations() : [];
        if (convs && convs.length > 100) {
            clearTimeout(__searchDebounceTimer);
            __searchDebounceTimer = setTimeout(doFilter, 100);
        } else {
            doFilter();
        }
    });

    $('btnSelectAll')?.addEventListener('click', () => {
        const Store = getStore();
        const List = getList();
        const convs = Store ? Store.getConversations() : [];
        if (List) List.selectAll(convs);
    });
    $('btnSelectNone')?.addEventListener('click', () => {
        const Store = getStore();
        const List = getList();
        const convs = Store ? Store.getConversations() : [];
        if (List) List.deselectAll(convs);
    });

    $('accountIdSelect')?.addEventListener('change', async (e: Event) => {
        const newSlot = (e.target as HTMLSelectElement).value;
        console.log('[workbench] Account slot changed to:', newSlot);
        const Store = getStore();
        if (Store) {
            Store.setCurrentAccountId(newSlot);
            getList()?.setSelectedIds?.(null);
            getDialogs()?.hideExportFailureBanner();
            await loadStore(true, new Set());
        }
    });

    $('btnTourGuide')?.addEventListener('click', () => {
        const Tour = getTour();
        if (Tour && Tour.startTour) {
            void Tour.startTour(0);
        }
    });
}

function initHeaderVersion(): void {
    const verEl = $('ver');
    if (verEl) {
        try {
            verEl.textContent = 'v' + (chrome.runtime.getManifest()?.version || (typeof __EXT_VERSION__ !== 'undefined' ? __EXT_VERSION__ : '1.4.3'));
        } catch (e) {
            if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:optionsInit]', e);
        }
    }
}

export function init({ onCheckPendingTakeout }: OptionsInitOptions = {}): void {
    if (typeof window !== 'undefined') {
        (window as any).__workbenchLoadStore = loadStore;
    }
    __pendingTakeoutChecker = onCheckPendingTakeout || null;
    initHeaderVersion();
    const Log = getLog();
    if (Log && Log.init) Log.init('log');
    bindSearchAndSelection();
}

export const OptionsInit = {
    init,
    loadStore,
    updateAccountSelector,
    checkExportSession,
    getSearchFilter,
    setSearchFilter,
    getChatFilterType,
    setChatFilterType,
    log,
    clearLog,
    renderLog,
    compareConversations,
    normId,
    cleanTitle,
    isRealTitle,
    getEffectiveTime
};



export default OptionsInit;
