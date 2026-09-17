// src/ui/uiCommon.ts - Shared UI helpers & SSoT utilities
import { normId, cleanTitle, isRealTitle } from '../core/utils/utils.js';
import { I18n as I18nStatic } from '../core/utils/i18n.js';
import { __resolveModule } from '../core/utils/moduleOverrides.js';

export const $ = (id: string): HTMLElement | null =>
    typeof document !== 'undefined' ? document.getElementById(id) : null;

export const getI18n = (): any => {
    return __resolveModule('I18n', I18nStatic);
};

export const t = (key: string, ...args: any[]): string => {
    const i18n = getI18n();
    return i18n && typeof i18n.t === 'function' ? i18n.t(key, ...args) : key;
};

export const getLang = (): string => {
    const i18n = getI18n();
    return i18n && typeof i18n.getLang === 'function' ? i18n.getLang() : 'en';
};

export const hasI18n = (): boolean => {
    const i18n = getI18n();
    return !!(i18n && typeof i18n.t === 'function');
};

export const WORKBENCH_ACTION_BUTTON_IDS = [
    'btnExport',
    'btnIncrementalScan',
    'btnDeepScan',
    'btnImportTakeout',
    'btnSetDir',
    'btnClearExported',
    'btnClearAll'
] as const;

export function setWorkbenchControlsDisabled(disabled: boolean): void {
    if (typeof document === 'undefined') return;
    for (const id of WORKBENCH_ACTION_BUTTON_IDS) {
        const el = document.getElementById(id) as HTMLButtonElement | null;
        if (el) el.disabled = !!disabled;
    }
}

export { normId, cleanTitle, isRealTitle };
