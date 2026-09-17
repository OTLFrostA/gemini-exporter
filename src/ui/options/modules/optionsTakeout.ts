// src/ui/options/modules/optionsTakeout.ts - Takeout archive import & Google limit detection
import type { OptionsTakeoutOptions } from '../../../types/ui.js';
import {
    getStore,
    getDialogs,
    getStorage,
    getTakeoutCtrl
} from '../optionsContext.js';
import { $ } from '../../uiCommon.js';
import { STORAGE_KEYS } from '../../../core/utils/constants.js';

let __loadStore: ((force?: boolean) => Promise<any> | void) | null = null;
let __log: ((msg: string, level?: 'info' | 'warn' | 'error') => void) | null = null;

export function log(msg: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (__log) __log(msg, level);
    else console.log(`[TAKEOUT ${level}]`, msg);
}

export async function isTakeoutPromptCompleted(): Promise<boolean> {
    try {
        const Storage = getStorage();
        return (Storage && Storage.isTakeoutPromptCompleted)
            ? await Storage.isTakeoutPromptCompleted()
            : false;
    } catch {
        return false;
    }
}

export async function maybePromptTakeout(count: number = 600, hitGoogleLimit: boolean = false): Promise<void> {
    try {
        const isCompleted = await isTakeoutPromptCompleted();
        const Store = getStore();
        const Storage = getStorage();
        const Dialogs = getDialogs();
        const hasTakeout = (Store && Store.hasTakeoutData && Store.hasTakeoutData()) ||
            (Storage && Storage.hasTakeoutData && await Storage.hasTakeoutData());
        if (!isCompleted && !hasTakeout && Dialogs && Dialogs.showTakeoutLimitPrompt) {
            Dialogs.showTakeoutLimitPrompt({
                count: count || 600,
                hitGoogleLimit: !!hitGoogleLimit,
                onImportTakeout: () => ($('takeoutFileInput') as HTMLInputElement | null)?.click()
            });
        }
    } catch (e) {
        console.debug('[workbench:takeout] maybePromptTakeout error', e);
    }
}

export async function checkPendingTakeoutPrompt(): Promise<void> {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([STORAGE_KEYS.PENDING_TAKEOUT_PROMPT]);
            if (data && data[STORAGE_KEYS.PENDING_TAKEOUT_PROMPT]) {
                const info = data[STORAGE_KEYS.PENDING_TAKEOUT_PROMPT];
                await chrome.storage.local.remove(STORAGE_KEYS.PENDING_TAKEOUT_PROMPT);
                await maybePromptTakeout((info as any).count || 600, !!(info as any).hitGoogleLimit);
            }
        }
    } catch (e) {
        console.debug('[workbench:takeout] checkPendingTakeoutPrompt error', e);
    }
}

export function init({ loadStore, log: logFn }: OptionsTakeoutOptions = {}): void {
    __loadStore = loadStore || null;
    __log = logFn || null;

    $('btnImportTakeout')?.addEventListener('click', () => {
        ($('takeoutFileInput') as HTMLInputElement | null)?.click();
    });

    $('takeoutFileInput')?.addEventListener('change', (e: Event) => {
        const input = e.target as HTMLInputElement;
        const f = input.files && input.files[0];
        const TakeoutCtrl = getTakeoutCtrl();
        if (f && TakeoutCtrl) {
            const progWrap = $('progWrap');
            const bar = $('bar');
            const progText = $('progText');
            if (progWrap) progWrap.style.display = 'block';
            if (bar) bar.style.width = '15%';

            TakeoutCtrl.handleTakeoutImport(f, {
                onProgress: (pct: number, txt: string) => {
                    if (bar) bar.style.width = `${pct}%`;
                    if (progText) progText.textContent = txt;
                },
                onLog: (txt: string, lvl?: 'info' | 'warn' | 'error') => log(txt, lvl || 'info'),
                onFinished: ({ message }: any) => {
                    if (progText) progText.textContent = message;
                    if (progWrap) progWrap.style.display = 'none';
                    try { input.value = ''; } catch { /* noop */ }
                    if (__loadStore) __loadStore();
                },
                onError: (err: any, errMsg?: string) => {
                    if (progText) progText.textContent = errMsg || err.message;
                    if (progWrap) progWrap.style.display = 'none';
                    try { input.value = ''; } catch { /* noop */ }
                }
            });
        }
    });
}

export const OptionsTakeout = {
    init,
    maybePromptTakeout,
    checkPendingTakeoutPrompt,
    isTakeoutPromptCompleted
};

(OptionsTakeout as any).OptionsTakeout = OptionsTakeout;
(OptionsTakeout as any).default = OptionsTakeout;

if (typeof globalThis !== 'undefined') {
    (globalThis as any).OptionsTakeout = OptionsTakeout;
}
if (typeof module === 'object' && module.exports) {
    module.exports = OptionsTakeout;
}

export default OptionsTakeout;
