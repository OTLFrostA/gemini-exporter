import type { OptionsSyncOptions } from '../../../types/ui.js';
import {
    t,
    getTabService,
    getStore,
    getStorage,
    getExportCtrl as getExportController,
    getSyncCtrl as getSyncController
} from '../optionsContext.js';
import { ProgressView } from '../../views/progressView.js';
import { $ } from '../../uiCommon.js';
import { isAccountId } from '../../../core/domain/accountRegistry.js';

let __loadStore: ((force?: boolean) => Promise<any> | void) | null = null;
let __log: ((msg: string, level?: 'info' | 'warn' | 'error') => void) | null = null;
let __maybePromptTakeout: ((count: number, hitLimit: boolean) => Promise<void> | void) | null = null;

async function checkAndPromptTakeoutLimit(count?: number, hitGoogleLimit?: boolean): Promise<void> {
    const isLimit = !!hitGoogleLimit;
    if (isLimit && __maybePromptTakeout) {
        await __maybePromptTakeout(count || 0, !!hitGoogleLimit);
    }
}

export function log(msg: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (__log) __log(msg, level);
    else console.log(`[SYNC ${level}]`, msg);
}

function bindSyncButtons(): void {
    const Store = getStore();
    const Controller = getExportController();
    const SyncCtrl = getSyncController();

    $('btnSyncAll')?.addEventListener('click', () => {
        if (Controller && Controller.isRunning()) return;
        const slot = Store ? Store.getCurrentAccountId() : '';

        if (SyncCtrl) {
            SyncCtrl.startSync(slot, {
                onStart: () => {
                    ProgressView.show(5, typeof t === 'function' ? t('syncingConversations') : '正在同步会话...');
                },
                onLog: (txt: string, lvl?: 'info' | 'warn' | 'error') => log(txt, lvl),
                onFinished: async ({ message, res, count, hitGoogleLimit }: any) => {
                    ProgressView.complete(message);
                    ProgressView.hide(2500);
                    if (__loadStore) void __loadStore();
                    const currentCount = count || res?.count || (Store && typeof (Store as any).getConversations === 'function' ? (Store as any).getConversations().length : 0);
                    await checkAndPromptTakeoutLimit(currentCount, hitGoogleLimit);
                },
                onError: async (err: any, errMsg?: string, details?: any) => {
                    ProgressView.update(0, errMsg);
                    if (__loadStore) await __loadStore();
                    const currentCount = (Store && typeof (Store as any).getConversations === 'function') ? (Store as any).getConversations().length : 0;
                    await checkAndPromptTakeoutLimit(currentCount || details?.res?.count, details?.hitGoogleLimit);
                }
            });
        }
    });

    $('btnStopScan')?.addEventListener('click', () => {
        const slot = Store ? Store.getCurrentAccountId() : '';
        if (SyncCtrl) {
            SyncCtrl.stopScan(slot, {
                onLog: (txt: string, lvl?: 'info' | 'warn' | 'error') => log(txt, lvl),
                onStopped: ({ message }: any) => {
                    ProgressView.update(0, message);
                }
            });
        }
    });
}

export function bindBroadcastListeners(): void {
    if (typeof chrome === 'undefined') return;
    chrome.storage?.onChanged?.addListener((changes, area) => {
        const slot = getStore()?.getCurrentAccountId() || '';
        const key = slot ? getStorage().getStorageKeys(slot).convKey : '';
        if (area === 'local' && changes[key] && __loadStore) void __loadStore(true);
    });
    if (!chrome.runtime?.onMessage) return;

    chrome.runtime.onMessage.addListener((msg: any) => {
        if (msg.action === 'accountsChanged') { if (__loadStore) void __loadStore(true); return; }
        if (msg.accountId && msg.accountId !== getStore()?.getCurrentAccountId()) return;
        if (msg.action === 'scanProgress') {
            let pct = typeof msg.percent === 'number' ? msg.percent : 50;
            const incomplete = msg.status && msg.status !== 'complete' && msg.status !== 'up_to_date';
            const clamped = incomplete ? 0 : Math.min(Math.max(pct, 5), 100);
            ProgressView.update(clamped, msg.title || '');
            if (msg.title) log(msg.title);

            if (msg.percent === 100 || msg.done === 1) {
                void checkAndPromptTakeoutLimit(msg.count, msg.hitGoogleLimit);
            }
        }

        if (msg.action === 'syncUpdate') {
            if (__loadStore) void __loadStore(true);
        }
    });
}

export async function autoDetectActiveAccount(): Promise<void> {
    try {
        const TabService = getTabService();
        const Store = getStore();
        if (TabService && TabService.getGeminiTab) {
            const tab = await TabService.getGeminiTab();
            if (tab && tab.url && Store) {
                if (tab.id == null) return;
                const result = await chrome.tabs.sendMessage(tab.id, { action: 'getAccountContext' });
                if (isAccountId(result?.accountContext?.accountId)) Store.setCurrentAccountId(result.accountContext.accountId);
            }
        }
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:optionsSync]', e);
    }
}

export async function init({ loadStore, log: logFn, maybePromptTakeout }: OptionsSyncOptions = {}): Promise<void> {
    __loadStore = loadStore || null;
    __log = logFn || null;
    __maybePromptTakeout = maybePromptTakeout || null;

    bindSyncButtons();
    bindBroadcastListeners();
    await autoDetectActiveAccount();
}

export const OptionsSync = {
    init,
    bindBroadcastListeners,
    autoDetectActiveAccount
};



export default OptionsSync;
