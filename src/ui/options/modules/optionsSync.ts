// src/ui/options/modules/optionsSync.ts - Cloud synchronization, background progress & pruning
import type { OptionsSyncOptions } from '../../../types/ui.js';
import {
    getI18n,
    t,
    getProtocol,
    getApiClient,
    getTabService,
    getStore,
    getExportCtrl as getExportController,
    getSyncCtrl as getSyncController
} from '../optionsContext.js';
import { $ } from '../../uiCommon.js';
import { detectSlotFromUrl } from '../../../core/utils/pathUtils.js';

let __loadStore: ((force?: boolean) => Promise<any> | void) | null = null;
let __log: ((msg: string, level?: 'info' | 'warn' | 'error') => void) | null = null;
let __maybePromptTakeout: ((count: number, hitLimit: boolean) => Promise<void> | void) | null = null;

async function checkAndPromptTakeoutLimit(count?: number, hitGoogleLimit?: boolean): Promise<void> {
    const protocol = getProtocol();
    const slidingLimit = (protocol && protocol.LIMITS?.SLIDING_WINDOW) || 500;
    const isLimit = !!hitGoogleLimit || ((count || 0) >= slidingLimit);
    if (isLimit && __maybePromptTakeout) {
        await __maybePromptTakeout(count || slidingLimit, !!hitGoogleLimit);
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
                    if (progText) progText.textContent = typeof t === 'function' ? t('syncingLatest') : '正在同步最新会话...';
                },
                onLog: (txt: string, lvl: 'info' | 'warn' | 'error') => log(txt, lvl),
                onFinished: ({ message }: any) => {
                    if (bar) bar.style.width = '100%';
                    if (progText) progText.textContent = message;
                    setTimeout(() => {
                        if (progWrap) progWrap.style.display = 'none';
                        if (bar) bar.style.width = '0%';
                        if (progText) progText.textContent = '';
                    }, 2500);
                    if (__loadStore) __loadStore();
                },
                onError: (err: any, errMsg: string) => {
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
                    if (progText) progText.textContent = typeof t === 'function' ? t('deepSyncing') : '正在全量扫描历史...';
                },
                onLog: (txt: string, lvl: 'info' | 'warn' | 'error') => log(txt, lvl),
                onFinished: async ({ message, res, count, hitGoogleLimit }: any) => {
                    if (bar) bar.style.width = '100%';
                    if (progText) progText.textContent = message;
                    setTimeout(() => {
                        if (progWrap) progWrap.style.display = 'none';
                        if (bar) bar.style.width = '0%';
                        if (progText) progText.textContent = '';
                    }, 2500);
                    if (__loadStore) __loadStore();
                    const currentCount = count || res?.count || (Store && typeof (Store as any).getConversations === 'function' ? (Store as any).getConversations().length : 0);
                    await checkAndPromptTakeoutLimit(currentCount, hitGoogleLimit);
                },
                onError: async (err: any, errMsg: string, details: any) => {
                    if (progText) progText.textContent = errMsg;
                    const currentCount = (Store && typeof (Store as any).getConversations === 'function') ? (Store as any).getConversations().length : 0;
                    await checkAndPromptTakeoutLimit(currentCount || details?.count, details?.hitGoogleLimit);
                }
            });
        }
    });

    $('btnStopScan')?.addEventListener('click', () => {
        const slot = Store ? Store.getCurrentSlot() : 'u0';
        if (SyncCtrl) {
            SyncCtrl.stopScan(slot, {
                onLog: (txt: string, lvl: 'info' | 'warn' | 'error') => log(txt, lvl),
                onStopped: ({ message }: any) => {
                    const progText = $('progText');
                    if (progText) progText.textContent = message;
                }
            });
        }
    });
}

export function bindBroadcastListeners(): void {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;

    chrome.runtime.onMessage.addListener((msg: any) => {
        if (msg.action === 'scanProgress') {
            const progWrap = $('progWrap');
            const bar = $('bar');
            const progText = $('progText');
            if (progWrap) progWrap.style.display = 'block';
            let pct = typeof msg.percent === 'number' ? msg.percent : 50;
            if (bar) bar.style.width = Math.min(Math.max(pct, 5), 100) + '%';
            if (progText && msg.title) progText.textContent = msg.title;
            if (msg.title) log(msg.title);

            if (msg.percent === 100 || msg.done === 1) {
                checkAndPromptTakeoutLimit(msg.count, msg.hitGoogleLimit);
            }
        }
        if (msg.action === 'syncUpdate') {
            if (__loadStore) __loadStore(true);
        }
    });
}

export async function autoDetectActiveSlot(): Promise<void> {
    try {
        const TabService = getTabService();
        const Store = getStore();
        if (TabService && TabService.getGeminiTab) {
            const tab = await TabService.getGeminiTab();
            if (tab && tab.url && Store) {
                Store.setCurrentSlot(detectSlotFromUrl(tab.url));
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
    await autoDetectActiveSlot();
}

export const OptionsSync = {
    init,
    bindBroadcastListeners,
    autoDetectActiveSlot
};

(OptionsSync as any).OptionsSync = OptionsSync;
(OptionsSync as any).default = OptionsSync;

if (typeof globalThis !== 'undefined') {
    (globalThis as any).OptionsSync = OptionsSync;
}
if (typeof module === 'object' && module.exports) {
    module.exports = OptionsSync;
}

export default OptionsSync;
