import type { GlobalSettings } from '../../l2/settings.js';

export const EXPORT_FORMATS = ['markdown', 'html', 'pdf', 'docx', 'json'] as const satisfies readonly GlobalSettings['defaultFormat'][];

let language = 'en';
let developerMode = false;

export function useSettings(settings: GlobalSettings, applyDocumentLanguage = true): void {
    developerMode = settings.developerMode;
    language = settings.language ?? (typeof navigator !== 'undefined' && navigator.language.startsWith('zh') ? 'zh' : 'en');
    // Never change Gemini's host document theme when invoked by the content Badge.
    if (applyDocumentLanguage && typeof document !== 'undefined') {
        document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
        document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
    }
}

export const currentLanguage = (): 'zh' | 'en' => language === 'zh' ? 'zh' : 'en';
export const text = (en: string, zh: string): string => language === 'zh' ? zh : en;
export const englishCount = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;
export const uiLocale = (): string => language === 'zh' ? 'zh-CN' : 'en-US';
export const isDeveloperMode = (): boolean => developerMode;

export function labelThemeToggle(button: HTMLButtonElement, settings?: GlobalSettings): void {
    const light = settings?.theme === 'light';
    const label = light ? text('Switch to dark mode', '切换到深色模式')
        : text('Switch to light mode', '切换到浅色模式');
    button.textContent = light ? '☾' : '☀';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(light));
}

export function observeSettings(refresh: () => void): () => void {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
        if (area === 'local' && (changes.gemini_exporter_v2_settings || changes.gemini_suppress_direct_write_prompt)) refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
}
