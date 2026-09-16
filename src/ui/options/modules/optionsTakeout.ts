// src/ui/options/modules/optionsTakeout.ts - Takeout archive import & Google limit detection
import type { OptionsTakeoutOptions } from '../../../types/ui.js';
import {
    getStore,
    getDialogs,
    getStorage,
    getTakeoutCtrl
} from '../optionsContext.js';
import { ProgressView } from '../../views/progressView.js';
import { $ } from '../../uiCommon.js';

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

export async function maybePromptTakeout(count?: number, hitLimit?: boolean): Promise<void> {
    const Dialogs = getDialogs();
    if (Dialogs && Dialogs.showTakeoutLimitPrompt) {
        await Dialogs.showTakeoutLimitPrompt({
            count,
            hitGoogleLimit: hitLimit,
            force: false,
            onImportTakeout: () => {
                const input = $('takeoutFileInput');
                if (input) input.click();
            }
        });
    }
}

export async function checkPendingTakeoutPrompt(): Promise<void> {
    const isCompleted = await isTakeoutPromptCompleted();
    if (isCompleted) return;
    const Store = getStore();
    if (Store && typeof Store.hasTakeoutData === 'function' && Store.hasTakeoutData()) return;
    const count = (Store && typeof Store.getConversations === 'function')
        ? Store.getConversations().length
        : 0;
    if (count >= 500) {
        await maybePromptTakeout(count, false);
    }
}

export function init(options: OptionsTakeoutOptions = {}): void {
    __loadStore = options.loadStore || null;
    __log = options.log || null;

    $('btnImportTakeout')?.addEventListener('click', () => {
        ($('takeoutFileInput') as HTMLInputElement | null)?.click();
    });

    $('takeoutFileInput')?.addEventListener('change', (e: Event) => {
        const input = e.target as HTMLInputElement;
        const f = input.files && input.files[0];
        const TakeoutCtrl = getTakeoutCtrl();
        if (f && TakeoutCtrl) {
            ProgressView.show(15);

            TakeoutCtrl.handleTakeoutImport(f, {
                onProgress: (pct: number, txt: string) => {
                    ProgressView.update(pct, txt);
                },
                onLog: (txt: string, lvl?: 'info' | 'warn' | 'error') => log(txt, lvl || 'info'),
                onFinished: ({ message }: any) => {
                    ProgressView.complete(message);
                    ProgressView.hide(2000);
                    if (__loadStore) __loadStore();
                },
                onError: (err: any, errMsg?: string) => {
                    ProgressView.update(0, errMsg || err.message);
                    ProgressView.hide(3000);
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
