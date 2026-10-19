import { getSettings, type GlobalSettings } from '../../core/application/settings/index.js';
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
export function labelPage(): void {
    document.querySelectorAll<HTMLElement>('[data-en][data-zh]').forEach(el => {
        el.textContent = text(el.dataset.en!, el.dataset.zh!);
    });
}
