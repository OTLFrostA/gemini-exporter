import { getSettings, type GlobalSettings } from '../../application/settings/index.js';
import { UI_COPY } from './legacyLabels.js';
let language = 'en';
export function useSettings(settings: GlobalSettings, applyDocumentLanguage = true): void {
    language = settings.language ?? (typeof navigator !== 'undefined' && navigator.language.startsWith('zh') ? 'zh' : 'en');
    if (applyDocumentLanguage && typeof document !== 'undefined') document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
}
export const text = (en: string, zh: string): string => language === 'zh' ? zh : en;
export async function readSettings(): Promise<GlobalSettings> {
    const settings = await getSettings(); useSettings(settings); return settings;
}
export function observeSettings(refresh: () => void): () => void {
    const listener = (_changes: unknown, area: string) => { if (area === 'local') refresh(); };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
}
export const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
/** Translate static UI nodes only; dynamic titles, messages, paths and logs are rendered by their views. */
export function labelPage(): void {
    document.querySelectorAll<HTMLElement>('[data-en][data-zh], [data-ui-en][data-ui-zh]').forEach(el => {
        el.textContent = text(el.dataset.en ?? el.dataset.uiEn!, el.dataset.zh ?? el.dataset.uiZh!);
    });
    const copy = UI_COPY[language === 'zh' ? 'zh' : 'en'];
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
        if (el.id === 'currentChatTitle' || el.id === 'chatTurnBadge' || el.id === 'dirLabel' || el.id === 'log') continue;
        const label = copy[el.dataset.i18n!];
        if (label) el.textContent = label;
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
        const label = copy[el.dataset.i18nTitle!];
        if (label) el.title = label;
    }
    for (const el of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
        const label = copy[el.dataset.i18nPlaceholder!];
        if (label) el.placeholder = label;
    }
}
